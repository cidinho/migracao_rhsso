import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { KeycloakError, errorMessage } from '../keycloak/errors.js';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';

const CACHE_MS = 15_000;

export interface HealthResponse {
  status: 'ok' | 'erro';
  realm: string;
  keycloakUrl: string;
  checkedAt: string;
  error?: { type: string; message: string };
  settings: {
    maxConcurrency: number;
    minIntervalMs: number;
    newUserRequiredActions: string[];
    uploadMaxBytes: number;
    uploadMaxRows: number;
  };
}

@Controller('health')
export class HealthController {
  private cached?: { at: number; value: HealthResponse };

  constructor(
    @Inject(KeycloakAdminClient) private readonly kc: KeycloakAdminClient,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get()
  async check(@Query('refresh') refresh?: string): Promise<HealthResponse> {
    if (this.cached && refresh !== 'true' && Date.now() - this.cached.at < CACHE_MS) {
      return this.cached.value;
    }
    const env = this.config.values;
    const value: HealthResponse = {
      status: 'ok',
      realm: env.KEYCLOAK_REALM,
      keycloakUrl: env.KEYCLOAK_BASE_URL,
      checkedAt: new Date().toISOString(),
      settings: {
        maxConcurrency: env.KC_MAX_CONCURRENCY,
        minIntervalMs: env.KC_MIN_INTERVAL_MS,
        newUserRequiredActions: env.KC_NEW_USER_REQUIRED_ACTIONS,
        uploadMaxBytes: env.UPLOAD_MAX_BYTES,
        uploadMaxRows: env.UPLOAD_MAX_ROWS,
      },
    };
    try {
      await this.kc.countUsers();
    } catch (err) {
      value.status = 'erro';
      value.error = {
        type: err instanceof KeycloakError ? err.type : 'UNKNOWN',
        message: errorMessage(err),
      };
    }
    this.cached = { at: Date.now(), value };
    return value;
  }
}
