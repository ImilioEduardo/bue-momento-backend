// Importado ANTES de tudo em main.ts/worker.ts.
// Sem NODE_ENV, o código que testa `NODE_ENV === 'production'` (cookies Secure, Swagger, rotas /dev,
// logs do notifier) comportava-se como desenvolvimento. Por segurança, ausência = produção.
if (!process.env['NODE_ENV']) {
  process.env['NODE_ENV'] = 'production';
}
export {};
