import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfigService } from '../config/app-config.service.js';
import { GroupsModule } from '../groups/groups.module.js';
import { GroupsService } from '../groups/groups.service.js';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';
import { KeycloakModule } from '../keycloak/keycloak.module.js';
import { AuditLogService } from './audit-log.service.js';
import { ImportJobsService } from './import-jobs.service.js';
import { ImportsController } from './imports.controller.js';

@Module({
  imports: [
    KeycloakModule,
    GroupsModule,
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        limits: { fileSize: config.values.UPLOAD_MAX_BYTES, files: 1 },
      }),
    }),
  ],
  controllers: [ImportsController],
  providers: [
    {
      provide: AuditLogService,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new AuditLogService(config.values.AUDIT_LOG_DIR),
    },
    {
      provide: ImportJobsService,
      inject: [KeycloakAdminClient, GroupsService, AuditLogService, AppConfigService],
      useFactory: (kc: KeycloakAdminClient, groups: GroupsService, audit: AuditLogService, { values: env }: AppConfigService) =>
        new ImportJobsService(kc, groups, audit, {
          realm: env.KEYCLOAK_REALM,
          maxConcurrency: env.KC_MAX_CONCURRENCY,
          membersPageSize: env.KC_MEMBERS_PAGE_SIZE,
          maxRows: env.UPLOAD_MAX_ROWS,
          requiredActions: env.KC_NEW_USER_REQUIRED_ACTIONS,
          emailVerified: env.KC_EMAIL_VERIFIED,
          retentionMinutes: env.JOB_RETENTION_MINUTES,
        }),
    },
  ],
})
export class ImportsModule {}
