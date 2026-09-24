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

  // P11 boot summary — the deployer reads ONE line per dependency and knows
  // the field-trial verdict before anyone touches the UI. Never lies by
  // omission: if Postgres is missing, the line says what breaks.
  const hasDb = Boolean(env.get('DATABASE_URL'));
  const storageDriver = env.get('STORAGE_DRIVER') || (env.isProduction && hasDb ? 'pg' : 'local');
  logger.log(
    [
      `[preflight] db=${hasDb ? 'configured' : 'MISSING (auth OTP/session will answer AUTH_DEPENDENCY_DOWN)'}`,
      `storage=${storageDriver}`,
      `rateFloor=${env.get('RATE_LIMIT_DRIVER') === 'redis' && env.get('REDIS_URL') ? 'redis-shared' : 'in-process'}`,
      `eventBus=${env.get('DEPLOYMENT_MODE') === 'multi' && env.get('REDIS_URL') ? 'redis-pubsub' : 'in-process'}`,
      `email=${env.get('EMAIL_DRIVER') === 'smtp' ? 'smtp' : 'mock-outbox'}`,
    ].join(' · '),
  );
}

bootstrap().catch((error: unknown) => {
  logger.error('Failed to start API', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
