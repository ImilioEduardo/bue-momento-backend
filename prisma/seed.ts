import { PrismaClient, MediaType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.upsert({
    where: { id: 'basico' },
    update: {},
    create: {
      id: 'basico',
      name: 'Básico',
      maxGuests: 50,
      maxVideosPerGuest: 3,
      maxVideoSeconds: 15,
      retentionDays: 30,
      priceKz: 15000,
    },
  });

  await prisma.plan.upsert({
    where: { id: 'festa' },
    update: {},
    create: {
      id: 'festa',
      name: 'Festa',
      maxGuests: 150,
      maxVideosPerGuest: 5,
      maxVideoSeconds: 30,
      retentionDays: 90,
      priceKz: 45000,
    },
  });

  await prisma.plan.upsert({
    where: { id: 'premium' },
    update: {},
    create: {
      id: 'premium',
      name: 'Premium',
      maxGuests: 400,
      maxVideosPerGuest: 7,
      maxVideoSeconds: 30,
      retentionDays: 90,
      priceKz: 120000,
    },
  });

  await prisma.challengeTemplate.deleteMany();

  const templates = [
    // Casamento (10)
    { category: 'casamento', text: 'Grava um vídeo com a mãe do noivo', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Conta uma memória especial com o casal', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Dança com alguém que não conhecias antes de hoje e filma o momento', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Tira uma selfie com 3 pessoas diferentes e apresenta-te a cada uma', mediaType: MediaType.PHOTO },
    { category: 'casamento', text: 'Deixa uma mensagem de conselho para o casal', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Imita o noivo ou a noiva durante 15 segundos', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Canta um trecho da música favorita do casal', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Faz uma previsão para o casal daqui a 10 anos', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Conta algo engraçado que aconteceu durante a preparação do casamento', mediaType: MediaType.VIDEO },
    { category: 'casamento', text: 'Convida alguém que não conheces para dançar e filma o momento', mediaType: MediaType.VIDEO },

    // Aniversário (10)
    { category: 'aniversario', text: 'Conta o momento mais engraçado que viveste com o/a aniversariante', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Grava uma mensagem de parabéns especial e criativa', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Faz uma previsão para o próximo ano da vida do/a aniversariante', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Desafia alguém a fazer um discurso improvisado sobre o/a aniversariante', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Imita o/a aniversariante com carinho', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Canta os parabéns com uma voz e estilo completamente diferente', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Tira uma foto especial com o/a aniversariante', mediaType: MediaType.PHOTO },
    { category: 'aniversario', text: 'Conta como conheceste o/a aniversariante pela primeira vez', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Deixa um conselho sábio para o próximo ano', mediaType: MediaType.VIDEO },
    { category: 'aniversario', text: 'Faz um desejo especial em voz alta para o/a aniversariante', mediaType: MediaType.VIDEO },

    // Empresa (10)
    { category: 'empresa', text: 'Apresenta-te à câmara como se fosses o herói de um filme de acção', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Conta o melhor projecto em que trabalhaste nesta empresa', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Desafia um colega para um duelo de conhecimentos sobre a história da empresa', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Faz uma previsão ousada para o futuro da empresa', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Conta a história mais caricata que viveste no trabalho', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Agradece publicamente a um colega que te ajudou muito', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Imita o teu chefe com muito carinho e respeito', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Explica o teu trabalho como se estivesses a falar com uma criança de 5 anos', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Conta como foi o teu primeiro dia nesta empresa', mediaType: MediaType.VIDEO },
    { category: 'empresa', text: 'Deixa uma mensagem de inspiração para toda a equipa', mediaType: MediaType.VIDEO },
  ];

  await prisma.challengeTemplate.createMany({ data: templates });

  console.log('Seed concluído: 3 planos e 30 modelos de desafios criados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
