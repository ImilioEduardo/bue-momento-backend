import * as Sentry from '@sentry/nestjs';

const dsn = process.env['SENTRY_DSN'];
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 1.0,
  });
}
