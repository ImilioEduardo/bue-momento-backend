import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // BullMQ workers registados aqui nas fases seguintes
  const logger = app.get(Logger);
  logger.log('Worker iniciado', 'Worker');
}

await bootstrap();
