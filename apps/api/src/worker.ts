import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Worker');
  // Worker context - no HTTP listener
  await NestFactory.createApplicationContext(AppModule);
  logger.log('worker ready');
}

bootstrap();
