import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { EnvService } from './config/env';
import { configureApp } from './setup';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get(EnvService);

  configureApp(app, env);

  if (!env.isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Legal Platform API')
      .setDescription('Legal practice platform REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on port ${port} (${env.nodeEnv})`);
}

bootstrap().catch((error: unknown) => {
  logger.error('Failed to start API', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
