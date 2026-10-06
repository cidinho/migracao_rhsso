import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { HealthController } from './health/health.controller.js';
import { ImportsModule } from './imports/imports.module.js';
import { KeycloakModule } from './keycloak/keycloak.module.js';

@Module({
  imports: [AppConfigModule, KeycloakModule, GroupsModule, ImportsModule],
  controllers: [HealthController],
})
export class AppModule {}
