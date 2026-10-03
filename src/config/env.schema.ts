import Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_GUEST_SECRET: Joi.string().min(32).default('dev_guest_secret_change_in_production_32ch'),
  WEB_URL: Joi.string().uri().required(),
  PUBLIC_WEB_URL: Joi.string().uri().required(),
  CF_ACCOUNT_ID: Joi.string().default(''),
  CF_STREAM_API_TOKEN: Joi.string().default(''),
  STREAM_WEBHOOK_SECRET: Joi.string().default(''),
  STREAM_REQUIRE_SIGNED: Joi.boolean().default(false),
  R2_ACCOUNT_ID: Joi.string().default(''),
  R2_ACCESS_KEY_ID: Joi.string().default(''),
  R2_SECRET_ACCESS_KEY: Joi.string().default(''),
  R2_BUCKET: Joi.string().default(''),
  PAYMENT_PROVIDER: Joi.string().valid('proxypay', 'manual').default('manual'),
  PROXYPAY_API_KEY: Joi.string().default(''),
  PROXYPAY_WEBHOOK_SECRET: Joi.string().default(''),
  SMS_PROVIDER: Joi.string().valid('console').default('console'),
  SMS_API_KEY: Joi.string().default(''),
  EMAIL_PROVIDER: Joi.string().valid('console').default('console'),
  EMAIL_API_KEY: Joi.string().default(''),
  SENTRY_DSN: Joi.string().default(''),
  ADMIN_SECRET: Joi.string().default(''),
});
