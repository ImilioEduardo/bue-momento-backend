import Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .empty('')
    .default('production'),
  PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_GUEST_SECRET: Joi.string().min(32).required(),
  WEB_URL: Joi.string().uri().required(),
  PUBLIC_WEB_URL: Joi.string().uri().required(),
  CF_ACCOUNT_ID: Joi.string().default(''),
  CF_STREAM_API_TOKEN: Joi.string().default(''),
  CF_STREAM_CUSTOMER_SUBDOMAIN: Joi.string().default(''),
  STREAM_WEBHOOK_SECRET: Joi.string().default(''),
  // Vídeos privados por omissão: reprodução/download só com token assinado de curta duração
  STREAM_REQUIRE_SIGNED: Joi.boolean().default(true),
  R2_ACCOUNT_ID: Joi.string().default(''),
  R2_ACCESS_KEY_ID: Joi.string().default(''),
  R2_SECRET_ACCESS_KEY: Joi.string().default(''),
  R2_BUCKET: Joi.string().default(''),
  R2_ENDPOINT: Joi.string().default(''),
  PAYMENT_PROVIDER: Joi.string().valid('proxypay', 'manual').default('manual'),
  PROXYPAY_API_KEY: Joi.string().default(''),
  PROXYPAY_WEBHOOK_SECRET: Joi.string().default(''),
  // console (dev: OTP no terminal) | evolution (WhatsApp via Evolution API self-hosted)
  SMS_PROVIDER: Joi.string().valid('console', 'evolution').default('console'),
  SMS_API_KEY: Joi.string().default(''),
  // Evolution API (WhatsApp). EVOLUTION_API_KEY = token da instância, NÃO a chave global.
  EVOLUTION_API_URL: Joi.string().allow('').default(''),
  EVOLUTION_API_KEY: Joi.string().allow('').default(''),
  EVOLUTION_INSTANCE: Joi.string().allow('').default('bue-momentos'),
  // Indicativo usado quando o telefone guardado não o tem (944916156 → 244944916156)
  PHONE_DEFAULT_COUNTRY_CODE: Joi.string().pattern(/^\d{1,3}$/).default('244'),
  EMAIL_PROVIDER: Joi.string().valid('console').default('console'),
  EMAIL_API_KEY: Joi.string().default(''),
  SENTRY_DSN: Joi.string().default(''),
  ADMIN_PHONE: Joi.string().allow('').default(''),
  ADMIN_SECRET: Joi.string().allow('').default(''),
  ADMIN_PASSWORD: Joi.string().allow('').default(''),
}).custom((env: Record<string, unknown>, helpers) => {
  // Em produção, os segredos de que dependem as proteções têm de existir e ser fortes.
  // Antes, todos tinham default '' e as proteções desligavam-se sem aviso.
  // NB: NODE_ENV vazio conta como produção (default acima), por segurança.
  const problems: string[] = [];
  const str = (key: string) => String(env[key] ?? '');
  const need = (key: string, min: number) => {
    if (str(key).length < min) problems.push(`${key} (mínimo ${min} caracteres)`);
  };

  // Evolution: se foi escolhida, tem de estar completa (em qualquer ambiente)
  if (env['SMS_PROVIDER'] === 'evolution') {
    let url: URL | null = null;
    try {
      url = new URL(str('EVOLUTION_API_URL'));
    } catch {
      problems.push('EVOLUTION_API_URL (URL válido, ex. http://localhost:8080)');
    }
    if (url && env['NODE_ENV'] === 'production') {
      // A API key viaja em cada pedido: em produção só HTTPS ou rede privada (ex. *.railway.internal)
      const privateHost = url.hostname.endsWith('.internal') || url.hostname === 'localhost';
      if (url.protocol !== 'https:' && !privateHost) {
        problems.push('EVOLUTION_API_URL tem de ser https:// em produção (ou um host privado *.internal)');
      }
    }
    if (str('EVOLUTION_API_KEY').length < 16) problems.push('EVOLUTION_API_KEY (token da instância, mínimo 16 caracteres)');
    if (!/^[\w-]{1,64}$/.test(str('EVOLUTION_INSTANCE'))) problems.push('EVOLUTION_INSTANCE (letras, números, - e _)');
  }

  if (env['NODE_ENV'] !== 'production') {
    return problems.length > 0
      ? helpers.message({ custom: `Configuração inválida — corrige: ${problems.join('; ')}` })
      : env;
  }

  // Sem fornecedor real de SMS ninguém consegue fazer login em produção
  if (env['SMS_PROVIDER'] === 'console') problems.push('SMS_PROVIDER tem de ser "evolution" em produção');

  need('ADMIN_SECRET', 32);
  need('ADMIN_PASSWORD', 12);
  if (str('ADMIN_SECRET') && str('ADMIN_SECRET') === str('ADMIN_PASSWORD')) {
    problems.push('ADMIN_SECRET tem de ser diferente de ADMIN_PASSWORD');
  }
  // O webhook ProxyPay é assinado com PROXYPAY_WEBHOOK_SECRET ou, na falta deste, com a API key
  if (env['PAYMENT_PROVIDER'] === 'proxypay') need('PROXYPAY_API_KEY', 8);
  // Se o Stream está configurado, os webhooks dele têm de ser assinados
  if (str('CF_STREAM_API_TOKEN')) need('STREAM_WEBHOOK_SECRET', 16);

  if (problems.length > 0) {
    return helpers.message({ custom: `Configuração insegura para produção — corrige: ${problems.join('; ')}` });
  }
  return env;
});
