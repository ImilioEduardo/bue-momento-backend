import './config/node-env.js';
import './instrument.js';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // AppModule registers BullModule.forRoot and JobsModule which includes ZipExportProcessor.
  // NestJS BullMQ automatically starts the worker when the ApplicationContext is created.
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);
  logger.log('Worker iniciado (exports queue activa)', 'Worker');
}

await bootstrap();
