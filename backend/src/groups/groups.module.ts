import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';
import { KeycloakModule } from '../keycloak/keycloak.module.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';

@Module({
  imports: [KeycloakModule],
  controllers: [GroupsController],
  providers: [
    {
      provide: GroupsService,
      inject: [KeycloakAdminClient, AppConfigService],
      useFactory: (kc: KeycloakAdminClient, config: AppConfigService) =>
        new GroupsService(kc, config.values.GROUPS_CACHE_TTL_SECONDS),
    },
  ],
  exports: [GroupsService],
})
export class GroupsModule {}
