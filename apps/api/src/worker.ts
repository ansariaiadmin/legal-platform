import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Worker');
  // Application context without an HTTP listener.
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  logger.log('worker ready');
}

bootstrap().catch((error: unknown) => {
  new Logger('Worker').error(`worker failed to start: ${(error as Error)?.stack ?? String(error)}`);
  process.exit(1);
});
