import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '20mb' });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const env = app.get(AppConfigService).values;
  await app.listen(env.PORT, env.HOST);
  Logger.log(
    `Backend ouvindo em http://${env.HOST}:${env.PORT}/api — realm "${env.KEYCLOAK_REALM}" em ${env.KEYCLOAK_BASE_URL}`,
    'Bootstrap',
  );
}

await bootstrap();
