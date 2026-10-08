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
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_GUEST_SECRET: Joi.string().min(32).required(),
  WEB_URL: Joi.string().uri().required(),
  PUBLIC_WEB_URL: Joi.string().uri().required(),
  CF_ACCOUNT_ID: Joi.string().default(''),
  CF_STREAM_API_TOKEN: Joi.string().default(''),
  CF_STREAM_CUSTOMER_SUBDOMAIN: Joi.string().default(''),
  STREAM_WEBHOOK_SECRET: Joi.string().default(''),
  STREAM_REQUIRE_SIGNED: Joi.boolean().default(false),
  R2_ACCOUNT_ID: Joi.string().default(''),
  R2_ACCESS_KEY_ID: Joi.string().default(''),
  R2_SECRET_ACCESS_KEY: Joi.string().default(''),
  R2_BUCKET: Joi.string().default(''),
  R2_ENDPOINT: Joi.string().default(''),
  PAYMENT_PROVIDER: Joi.string().valid('proxypay', 'manual').default('manual'),
  PROXYPAY_API_KEY: Joi.string().default(''),
  PROXYPAY_WEBHOOK_SECRET: Joi.string().default(''),
  SMS_PROVIDER: Joi.string().valid('console', 'twilio').default('console'),
  SMS_API_KEY: Joi.string().default(''),
  // Twilio (SMS). Autenticação: API Key SID+Secret (recomendado) ou Auth Token.
  TWILIO_ACCOUNT_SID: Joi.string().allow('').default(''),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').default(''),
  TWILIO_API_KEY_SID: Joi.string().allow('').default(''),
  TWILIO_API_KEY_SECRET: Joi.string().allow('').default(''),
  // Remetente: Messaging Service (recomendado) ou número/ID alfanumérico (ex. +17372508034 ou BueMoments)
  TWILIO_MESSAGING_SERVICE_SID: Joi.string().allow('').default(''),
  TWILIO_SMS_FROM: Joi.string().allow('').default(''),
  TWILIO_DEFAULT_COUNTRY_CODE: Joi.string().pattern(/^\d{1,3}$/).default('244'),
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

  // Twilio: se foi escolhido, tem de estar completo (em qualquer ambiente)
  if (env['SMS_PROVIDER'] === 'twilio') {
    if (!/^AC[0-9a-f]{32}$/i.test(str('TWILIO_ACCOUNT_SID'))) problems.push('TWILIO_ACCOUNT_SID (formato AC + 32 hex)');
    const hasApiKey = !!str('TWILIO_API_KEY_SID') && !!str('TWILIO_API_KEY_SECRET');
    if (!hasApiKey && !str('TWILIO_AUTH_TOKEN')) problems.push('TWILIO_AUTH_TOKEN ou TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET');
    if (!str('TWILIO_MESSAGING_SERVICE_SID') && !str('TWILIO_SMS_FROM')) problems.push('TWILIO_MESSAGING_SERVICE_SID ou TWILIO_SMS_FROM');
  }

  if (env['NODE_ENV'] !== 'production') {
    return problems.length > 0
      ? helpers.message({ custom: `Configuração inválida — corrige: ${problems.join('; ')}` })
      : env;
  }

  // Sem fornecedor real de SMS ninguém consegue fazer login em produção
  if (env['SMS_PROVIDER'] === 'console') problems.push('SMS_PROVIDER tem de ser "twilio" em produção');

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
