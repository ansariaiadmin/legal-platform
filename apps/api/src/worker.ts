import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Worker context - no HTTP listener
  await NestFactory.createApplicationContext(AppModule);
  console.log('worker ready');
}

bootstrap();
