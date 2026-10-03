# BACKEND.md — API NestJS do MVP "Desafios em Vídeo para Eventos"

> Ficheiro de contexto para o Claude Code. Coloca-o na raiz do repositório do backend
> (podes renomeá-lo para `CLAUDE.md`). Lê-o inteiro antes de escrever código.

---

## 1. O produto em 30 segundos

SaaS para festas (casamentos, aniversários, eventos de empresa).

1. O **organizador** (cliente pagante) cria um evento, escreve **desafios** ("Grava um vídeo com a mãe do noivo"), escolhe um **plano** e paga.
2. O sistema gera um **QR code**. Os **convidados** leem-no no telemóvel, abrem uma página web (sem instalar nada), põem o nome e o telefone, recebem os seus desafios e gravam vídeos ou tiram fotos.
3. O organizador vê tudo numa galeria, modera e descarrega (individual ou ZIP).

Cobra-se por **número de convidados** e **número de vídeos por convidado**, através de planos fixos + extras.

Mercado inicial: **Angola** (moeda Kz, pagamento por referência Multicaixa, língua pt-AO).

O maior risco técnico: **a internet nas festas é fraca**. Envio retomável e tolerância a falhas são requisitos, não extras.

---

## 2. Stack (decidida — não trocar sem perguntar)

| Camada | Tecnologia |
| --- | --- |
| Framework | NestJS 10+ com TypeScript (strict) |
| Base de dados | PostgreSQL (Neon) |
| ORM | Prisma |
| Vídeo | Cloudflare Stream (Direct Creator Upload via tus, webhooks, MP4 downloads) |
| Fotos e ZIPs | Cloudflare R2 (API S3 via `@aws-sdk/client-s3` + URLs pré-assinadas) |
| Filas | BullMQ + Redis (Upstash, plano fixo — **não** pay-per-command) |
| Autenticação | JWT próprio. Organizador: OTP por SMS ou email. Convidado: token de sessão por evento |
| Validação | `class-validator` + `class-transformer` (ou `zod` com pipe, mas escolher um e manter) |
| Documentação API | `@nestjs/swagger` em `/docs` |
| Logs / erros | `nestjs-pino` + Sentry |
| Rate limiting | `@nestjs/throttler` |
| Testes | Jest (unitários) + Supertest (e2e) com base de dados de teste |
| Alojamento | Railway (serviço `api` + serviço `worker`, mesma imagem) |

Gestor de pacotes: **pnpm**. Node 20 LTS.

---

## 3. Convenções

- Código, nomes de tabelas, campos e endpoints em **inglês**. Mensagens para o utilizador em **português (pt-AO)**.
- Valores monetários em **Kz inteiros** (`priceKz: Int`). Nunca `float` para dinheiro.
- Datas em UTC na base de dados; o fuso do evento (`Africa/Luanda` por omissão) guarda-se no evento.
- Todas as regras de limite são aplicadas **no servidor**. O frontend só mostra.
- Cada módulo: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, testes `*.spec.ts`.
- Erros de negócio com códigos estáveis, ex.: `{ "code": "EVENT_GUEST_LIMIT_REACHED", "message": "..." }`.
- Sem segredos no código. Tudo por variáveis de ambiente validadas no arranque (`@nestjs/config` + schema).
- Commits pequenos, um por tarefa.

---

## 4. Estrutura de pastas

```
src/
  main.ts
  app.module.ts
  config/                 # schema das env vars
  prisma/                 # PrismaService
  common/                 # guards, decorators, filtros de erro, interceptors
  modules/
    auth/                 # OTP do organizador, JWT, guard do convidado
    organizers/
    plans/
    events/               # CRUD, estados, QR, PDF do cartão de mesa
    challenges/
    guests/               # entrada pelo QR, atribuição de desafios
    submissions/          # criar envio (URL tus / URL R2), estado, moderação
    media/                # clientes Cloudflare Stream e R2
    webhooks/             # Stream + pagamentos
    payments/             # interface PaymentProvider + adaptadores
    gallery/              # listagens e downloads para o organizador
    exports/              # ZIP
    admin/                # painel do dono da plataforma
    notifications/        # SMS e email
  jobs/                   # processadores BullMQ (worker)
  worker.ts               # arranque só dos processadores
prisma/
  schema.prisma
  seed.ts                 # planos + modelos de desafios
test/
```

---

## 5. Modelo de dados (Prisma)

Ponto de partida. Ajustar nomes se necessário, mas manter as relações.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum EventStatus {
  DRAFT            // a ser configurado
  PENDING_PAYMENT  // referência emitida, à espera
  ACTIVE           // pago; QR funciona dentro da janela
  CLOSED           // fim da janela; galeria disponível
  EXPIRED          // retenção terminou; media apagada
}
enum Distribution { FIXED RANDOM }
enum MediaType { VIDEO PHOTO }
enum AssignmentStatus { PENDING DONE }
enum SubmissionStatus { UPLOADING PROCESSING READY HIDDEN FAILED }
enum PaymentStatus { PENDING PAID EXPIRED FAILED }
enum PaymentKind { PLAN EXTRA }

model Organizer {
  id        String   @id @default(cuid())
  name      String
  email     String?  @unique
  phone     String?  @unique
  isAdmin   Boolean  @default(false)
  createdAt DateTime @default(now())
  events    Event[]
}

model Plan {
  id                   String  @id            // "basico" | "festa" | "premium"
  name                 String
  maxGuests            Int
  maxVideosPerGuest    Int
  maxVideoSeconds      Int
  retentionDays        Int
  priceKz              Int
  active               Boolean @default(true)
  events               Event[]
}

model Event {
  id                  String       @id @default(cuid())
  organizerId         String
  organizer           Organizer    @relation(fields: [organizerId], references: [id])
  planId              String?
  plan                Plan?        @relation(fields: [planId], references: [id])
  name                String
  coverUrl            String?
  timezone            String       @default("Africa/Luanda")
  startsAt            DateTime
  endsAt              DateTime
  graceHours          Int          @default(24)   // envios aceites até endsAt + graceHours
  publicCode          String       @unique        // curto, usado no URL do QR
  distribution        Distribution @default(RANDOM)
  challengesPerGuest  Int          @default(3)
  moderation          Boolean      @default(false)
  status              EventStatus  @default(DRAFT)
  // limites efectivos = plano + extras comprados
  extraGuests         Int          @default(0)
  extraVideosPerGuest Int          @default(0)
  extraRetentionDays  Int          @default(0)
  extendedMaxSeconds  Int?         // se comprou "vídeos até 60 s"
  expiresAt           DateTime?    // calculado no pagamento
  createdAt           DateTime     @default(now())
  challenges          Challenge[]
  guests              Guest[]
  payments            Payment[]
  exports             Export[]
}

model Challenge {
  id          String       @id @default(cuid())
  eventId     String
  event       Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  text        String
  mediaType   MediaType    @default(VIDEO)
  order       Int
  active      Boolean      @default(true)
  assignments Assignment[]
}

model Guest {
  id          String       @id @default(cuid())
  eventId     String
  event       Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  name        String
  phone       String
  deviceId    String
  blocked     Boolean      @default(false)
  consentAt   DateTime
  createdAt   DateTime     @default(now())
  assignments Assignment[]
  @@unique([eventId, deviceId])
  @@unique([eventId, phone])
}

model Assignment {
  id          String           @id @default(cuid())
  guestId     String
  guest       Guest            @relation(fields: [guestId], references: [id], onDelete: Cascade)
  challengeId String
  challenge   Challenge        @relation(fields: [challengeId], references: [id], onDelete: Cascade)
  status      AssignmentStatus @default(PENDING)
  submissions Submission[]
  @@unique([guestId, challengeId])
}

model Submission {
  id            String           @id @default(cuid())
  assignmentId  String
  assignment    Assignment       @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  mediaType     MediaType
  streamUid     String?          @unique   // Cloudflare Stream (vídeo)
  r2Key         String?          @unique   // R2 (foto)
  durationSec   Float?
  sizeBytes     BigInt?
  thumbnailUrl  String?
  status        SubmissionStatus @default(UPLOADING)
  createdAt     DateTime         @default(now())
  readyAt       DateTime?
}

model Payment {
  id          String        @id @default(cuid())
  eventId     String
  event       Event         @relation(fields: [eventId], references: [id])
  kind        PaymentKind
  description String        // ex.: "Plano Festa", "+50 convidados"
  amountKz    Int
  provider    String        // "proxypay" | "manual"
  reference   String?       // referência Multicaixa
  entity      String?
  status      PaymentStatus @default(PENDING)
  payload     Json?         // extras comprados, p/ aplicar ao confirmar
  paidAt      DateTime?
  createdAt   DateTime      @default(now())
}

model Export {
  id        String   @id @default(cuid())
  eventId   String
  event     Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  status    String   // QUEUED | RUNNING | READY | FAILED
  r2Key     String?
  createdAt DateTime @default(now())
}

model OtpCode {
  id         String   @id @default(cuid())
  target     String   // email ou telefone
  codeHash   String
  attempts   Int      @default(0)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
}

model ChallengeTemplate {
  id       String    @id @default(cuid())
  category String    // "casamento" | "aniversario" | "empresa"
  text     String
  mediaType MediaType @default(VIDEO)
}
```

### Seed obrigatório (`prisma/seed.ts`)

| id | name | maxGuests | maxVideosPerGuest | maxVideoSeconds | retentionDays | priceKz |
| --- | --- | --- | --- | --- | --- | --- |
| basico | Básico | 50 | 3 | 15 | 30 | 15000 |
| festa | Festa | 150 | 5 | 30 | 90 | 45000 |
| premium | Premium | 400 | 7 | 30 | 90 | 120000 |

Extras (constantes em `plans/extras.ts`, não tabela por agora):

| código | descrição | preço Kz | efeito |
| --- | --- | --- | --- |
| `GUESTS_50` | +50 convidados | 10000 | `extraGuests += 50` |
| `VIDEOS_2_FESTA` | +2 vídeos/convidado (Festa) | 10000 | `extraVideosPerGuest += 2` |
| `VIDEOS_2_PREMIUM` | +2 vídeos/convidado (Premium) | 20000 | `extraVideosPerGuest += 2` |
| `RETENTION_6M` | +6 meses de retenção | 15000 | `extraRetentionDays += 180`, recalcula `expiresAt` |
| `LONG_VIDEO_60` | vídeos até 60 s | 15000 | `extendedMaxSeconds = 60` |

Também ~30 modelos de desafios em pt-AO (10 casamento, 10 aniversário, 10 empresa).

---

## 6. Regras de negócio (implementar num `EventLimitsService` testado)

Limites efectivos de um evento:

```
maxGuests         = plan.maxGuests + extraGuests
maxVideosPerGuest = plan.maxVideosPerGuest + extraVideosPerGuest
maxVideoSeconds   = extendedMaxSeconds ?? plan.maxVideoSeconds
expiresAt         = endsAt + (plan.retentionDays + extraRetentionDays) dias
```

1. **Entrada de convidado** só se `status = ACTIVE` e `now` entre `startsAt - 2h` e `endsAt + graceHours`.
2. **Limite de convidados**: se `count(guests) >= maxGuests` → `EVENT_GUEST_LIMIT_REACHED` (HTTP 409) e notificar o organizador (uma vez por hora no máximo) com oferta de comprar `GUESTS_50`.
3. **Um convidado por dispositivo e por telefone** no mesmo evento. Se o mesmo `deviceId` voltar, devolve o convidado existente (re-login), não cria outro.
4. **Atribuição** ao entrar (transacção):
   - `FIXED`: os primeiros `challengesPerGuest` desafios activos por `order`.
   - `RANDOM`: escolher `challengesPerGuest` desafios activos, **equilibrando a cobertura** (preferir desafios com menos atribuições; desempate aleatório). Não usar só `Math.random()`.
   - `challengesPerGuest` nunca pode ser maior que `maxVideosPerGuest` (validar ao configurar o evento).
5. **Envio**: só para uma `Assignment` do próprio convidado; no máximo 1 envio `READY/PROCESSING/UPLOADING` por atribuição (re-envio substitui o anterior, apagando-o no Stream/R2); total de envios activos do convidado ≤ `maxVideosPerGuest`.
6. **Duração**: o URL de envio do Stream é criado com `maxDurationSeconds = maxVideoSeconds`. No webhook, se `duration > maxVideoSeconds + 1` → marcar `FAILED` e apagar.
7. **Moderação**: se `moderation = true`, envios novos ficam visíveis só para o organizador até aprovação (usar `HIDDEN` vs `READY` + campo `approved` se for preciso; decidir e documentar).
8. **Convidado bloqueado** pelo organizador: não envia mais, os seus envios ficam ocultos.
9. **Expiração** (job diário): eventos com `expiresAt < now` → apagar todos os vídeos no Stream, objectos no R2, ZIPs; `status = EXPIRED`. Avisar o organizador 7 dias antes.
10. **Estados do evento**: `DRAFT → PENDING_PAYMENT → ACTIVE → CLOSED → EXPIRED`. Só se edita o plano em `DRAFT`. Desafios podem ser editados até `endsAt`.

---

## 7. API (prefixo `/api/v1`)

### Auth do organizador
| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/auth/otp/request` | `{ target }` (email ou telefone +244). Envia código de 6 dígitos, válido 10 min. Throttle 3/10 min por alvo. |
| POST | `/auth/otp/verify` | `{ target, code }` → `{ accessToken, refreshToken, organizer }`. Cria o organizador se não existir (pede `name` depois). Máx. 5 tentativas. |
| POST | `/auth/refresh` | Novo access token. |
| GET/PATCH | `/me` | Perfil. |

Access token 15 min, refresh 30 dias (rotação, guardado com hash).

### Planos e modelos
| GET | `/plans` | Planos activos + extras (público). |
| GET | `/challenge-templates?category=` | Modelos de desafios. |

### Eventos (organizador autenticado, só os seus)
| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/events` | Criar em `DRAFT`. |
| GET | `/events` | Lista com contadores (convidados, envios, estado). |
| GET/PATCH/DELETE | `/events/:id` | Detalhe / editar (respeitando estado) / apagar só em `DRAFT`. |
| POST | `/events/:id/challenges` | Criar desafio. Também `PATCH`, `DELETE`, `POST /reorder`. |
| POST | `/events/:id/challenges/from-templates` | `{ templateIds[] }`. |
| POST | `/events/:id/checkout` | `{ planId, extras[] }` → cria `Payment`, devolve referência Multicaixa. |
| POST | `/events/:id/extras` | Comprar extras com o evento já activo. |
| GET | `/events/:id/qr.png` e `/events/:id/qr-card.pdf` | QR do URL `${PUBLIC_WEB_URL}/e/${publicCode}`; PDF A6 com nome do evento e instruções. Só se `ACTIVE`. |
| GET | `/events/:id/stats` | Convidados, % participação, envios por desafio, minutos usados. |

### Galeria (organizador)
| GET | `/events/:id/submissions?challengeId=&guestId=&status=&cursor=` | Paginação por cursor. URLs de reprodução do Stream (assinadas se `STREAM_REQUIRE_SIGNED=true`) e URL de foto pré-assinada (1 h). |
| PATCH | `/events/:id/submissions/:sid` | `{ approved | hidden }`. |
| GET | `/events/:id/submissions/:sid/download` | Redirect para MP4 do Stream ou URL pré-assinada do R2. |
| POST | `/events/:id/exports` | Enfileira ZIP. Máx. 1 em curso por evento. |
| GET | `/events/:id/exports/:eid` | Estado + URL pré-assinada (24 h) quando `READY`. |
| PATCH | `/events/:id/guests/:gid` | `{ blocked }`. |

### Convidado (público, por `publicCode`)
| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/public/events/:code` | Nome, capa, janela, se aceita entradas, texto de consentimento. Nada sensível. |
| POST | `/public/events/:code/join` | `{ name, phone, deviceId, consent: true }` → `{ guestToken, guest, assignments[] }`. |
| GET | `/public/me` | (guestToken) As minhas atribuições + estado + limites (`maxVideoSeconds`). |
| POST | `/public/assignments/:aid/uploads` | Vídeo: `{ mediaType: "VIDEO", uploadLength }` → `{ submissionId, tusUploadUrl }`. Foto: `{ mediaType: "PHOTO", contentType, size }` → `{ submissionId, putUrl }`. |
| POST | `/public/submissions/:sid/complete` | Foto: confirma o PUT no R2 (verificar com `HeadObject`). Vídeo: opcional, o webhook é a fonte da verdade. |
| GET | `/public/submissions/:sid` | Estado (para o frontend sondar). |

`guestToken`: JWT com `{ guestId, eventId, scope: "guest" }`, validade até `expiresAt` do evento. Throttle no `join` por IP e por `deviceId`.

### Webhooks
| POST | `/webhooks/stream` | Verificar assinatura (`Webhook-Signature`, segredo `STREAM_WEBHOOK_SECRET`). Ao `readyToStream`: `status = READY` (ou oculto se moderação), guardar `duration`, `thumbnail`, pedir MP4 download, marcar `Assignment.DONE`. Ao erro: `FAILED`. Idempotente. |
| POST | `/webhooks/payments/:provider` | Validar assinatura do fornecedor. Ao pagamento: `Payment.PAID`, aplicar plano/extras, `status = ACTIVE`, calcular `expiresAt`, notificar organizador. Idempotente. |

### Admin (`isAdmin = true`)
| GET | `/admin/events`, `/admin/organizers`, `/admin/payments` | Listas com filtros. |
| POST | `/admin/payments/:id/confirm` | Confirmação manual (plano B do pagamento). |
| GET | `/admin/usage` | Minutos no Stream, GB no R2, envios falhados por dia. |

---

## 8. Integrações

### 8.1 Cloudflare Stream (vídeo)
- Criar URL de envio **tus** do lado do servidor (Direct Creator Upload):
  `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/stream?direct_user=true`
  com headers `Tus-Resumable: 1.0.0`, `Upload-Length`, `Upload-Metadata` (incluir `maxdurationseconds`, `expiry` ~6 h, e `name` = submissionId). O header `Location` da resposta é o `tusUploadUrl`; o header `stream-media-id` é o `streamUid`.
- O convidado envia **directamente** para o Stream (o vídeo nunca passa pelo NestJS).
- Webhook configurado na conta para `/api/v1/webhooks/stream`.
- Depois de pronto: `POST /stream/{uid}/downloads` para gerar MP4 (usado na descarga e no ZIP).
- Apagar: `DELETE /stream/{uid}`.
- Consultar a documentação oficial antes de implementar; os nomes exactos dos headers/metadata devem ser confirmados lá.
- Encapsular tudo num `StreamClient` com interface, para poder trocar por FFmpeg próprio no futuro.

### 8.2 Cloudflare R2 (fotos e ZIPs)
- Bucket privado. URLs pré-assinadas `PUT` (15 min, `Content-Type` e `Content-Length` fixos, máx. 15 MB, só `image/jpeg|png|heic|webp`) e `GET` (1 h).
- Chaves: `events/{eventId}/photos/{submissionId}.{ext}`, `events/{eventId}/exports/{exportId}.zip`.
- Encapsular num `StorageClient`.

### 8.3 Pagamentos
- Interface `PaymentProvider { createReference(payment): {entity, reference, expiresAt}; verifyWebhook(req): PaymentEvent }`.
- Adaptador `ProxyPayProvider` (referências Multicaixa) — **consultar a documentação do fornecedor**; se as credenciais não existirem, deixar o adaptador com testes de contrato e usar `ManualProvider` (gera instruções de transferência; o admin confirma em `/admin/payments/:id/confirm`).
- Configurável por `PAYMENT_PROVIDER=proxypay|manual`.
- Referência expira em 72 h → job marca `EXPIRED`.

### 8.4 SMS / email
- Interface `Notifier { sendSms(to, text); sendEmail(to, subject, html) }`. Adaptador de consola em dev; fornecedor real por env.
- Mensagens: OTP, pagamento confirmado, limite de convidados atingido, ZIP pronto, evento a expirar em 7 dias.

---

## 9. Jobs (BullMQ, processo `worker`)

| Fila | Job | Quando |
| --- | --- | --- |
| `exports` | `build-zip` | A pedido. Fazer stream dos MP4 (Stream) e fotos (R2) para um ZIP com pastas por desafio (`01 - Mãe do noivo/Ana_Silva_1.mp4`), multipart upload para R2. Nunca carregar tudo em memória. |
| `maintenance` | `close-events` | A cada 15 min: `ACTIVE` com `endsAt + graceHours < now` → `CLOSED`. |
| `maintenance` | `expire-events` | Diário 03:00 Luanda. Ver regra 9. |
| `maintenance` | `warn-expiry` | Diário. Aviso 7 dias antes. |
| `maintenance` | `cleanup-stale-uploads` | A cada hora: `UPLOADING` há > 12 h → apagar no Stream/R2, `FAILED`. |
| `payments` | `expire-references` | A cada hora. |
| `notifications` | `send` | Envio assíncrono de SMS/email com retries. |

Todos os jobs idempotentes, com retries exponenciais e logs com `eventId`.

---

## 10. Segurança e privacidade

- CORS só para `WEB_URL`.
- Helmet, limites de tamanho do body (1 MB — media nunca passa pela API).
- Guards: `OrganizerGuard` (JWT + dono do evento), `GuestGuard` (guestToken + evento activo + não bloqueado), `AdminGuard`.
- Telefones normalizados para E.164 (`+244...`). Validar formato angolano por omissão, aceitar internacionais.
- OTP guardado com hash (argon2/bcrypt), nunca em claro nos logs.
- Consentimento obrigatório no `join` (`consentAt`). Texto versionado.
- Lei 22/11 (Protecção de Dados, Angola): permitir ao organizador apagar um convidado e todos os envios; registar apagamentos.
- URLs de media sempre temporárias.

---

## 11. Variáveis de ambiente

```
NODE_ENV=
PORT=3001
DATABASE_URL=
REDIS_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
WEB_URL=                 # https://app.dominio.ao (CORS)
PUBLIC_WEB_URL=          # base do link do QR
CF_ACCOUNT_ID=
CF_STREAM_API_TOKEN=
STREAM_WEBHOOK_SECRET=
STREAM_REQUIRE_SIGNED=false
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
PAYMENT_PROVIDER=manual
PROXYPAY_API_KEY=
PROXYPAY_WEBHOOK_SECRET=
SMS_PROVIDER=console
SMS_API_KEY=
EMAIL_PROVIDER=console
EMAIL_API_KEY=
SENTRY_DSN=
```

Criar `.env.example` com todas, e falhar no arranque se faltar alguma obrigatória.

---

## 12. Plano de implementação (seguir por ordem; cada passo termina com testes a passar)

### Fase 1 — Fundação (semanas 2–4)
- [ ] Scaffold NestJS, Prisma, config validada, pino, Sentry, Swagger, health check `/health`.
- [ ] Schema Prisma + migração + seed (planos e modelos).
- [ ] Módulo `auth` com OTP (Notifier de consola) + JWT + refresh.
- [ ] CRUD de eventos e desafios com validação de estados.
- [ ] `EventLimitsService` + testes unitários de todas as regras da secção 6.
- [ ] QR (`qrcode`) e PDF do cartão (`pdfkit` ou `@react-pdf/renderer`).
- **Critério:** um organizador cria um evento com desafios via Swagger e obtém o PDF do QR (pagamento simulado em dev).

### Fase 2 — Convidado e envio (semanas 5–7) — **fase crítica**
- [ ] `public/events/:code`, `join` com atribuição equilibrada (testes com 150 convidados simulados: cobertura de desafios com desvio ≤ 1).
- [ ] `StreamClient`: criar URL tus, webhook com verificação de assinatura, MP4 download, delete.
- [ ] `StorageClient` R2 para fotos.
- [ ] Endpoints de envio + estado; regras de limite e duração.
- [ ] Job `cleanup-stale-uploads`.
- **Critério:** teste e2e de ponta a ponta com um vídeo real de teste no Stream (ambiente de staging).

### Fase 3 — Galeria e pagamentos (semanas 8–10)
- [ ] Galeria com filtros e paginação; moderação; bloqueio de convidado.
- [ ] Exports ZIP em streaming no worker.
- [ ] `PaymentProvider` + `ManualProvider` + `ProxyPayProvider`; checkout, extras, webhooks idempotentes.
- [ ] Notificações reais (SMS/email).
- [ ] Endpoints de admin + `/admin/usage`.
- **Critério:** evento pago por referência → `ACTIVE` automaticamente; ZIP de 1.000 ficheiros gerado sem exceder 512 MB de RAM.

### Fase 4 — Lançamento (semanas 11–12)
- [ ] Jobs de fecho, expiração e aviso.
- [ ] Apagamento de convidado (privacidade).
- [ ] Testes de carga simples: 400 `join` em 5 min, 2.800 pedidos de URL de envio.
- [ ] Dockerfile único, `api` e `worker` no Railway, migrações no deploy.

---

## 13. Comandos

```
pnpm install
pnpm prisma migrate dev
pnpm prisma db seed
pnpm start:dev          # API
pnpm worker:dev         # filas
pnpm test               # unitários
pnpm test:e2e
pnpm lint && pnpm typecheck
```

---

## 14. Como o Claude Code deve trabalhar neste repositório

- Antes de cada fase, propõe um plano curto e espera confirmação se houver ambiguidade.
- Escreve primeiro os testes das regras de negócio da secção 6.
- Não inventes APIs de fornecedores: lê a documentação oficial (Cloudflare Stream, R2, fornecedor de pagamento) e cita no código o link usado.
- Nunca faças o vídeo passar pelo servidor NestJS.
- Mantém este ficheiro actualizado quando uma decisão mudar.
