import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { KeycloakAdminClient } from './keycloak-admin.client.js';
import { KeycloakHttpClient } from './http-client.js';
import { TokenService } from './token.service.js';

@Module({
  providers: [
    {
      provide: KeycloakHttpClient,
      inject: [AppConfigService],
      useFactory: ({ values: env }: AppConfigService) =>
        new KeycloakHttpClient({
          maxConcurrency: env.KC_MAX_CONCURRENCY,
          minIntervalMs: env.KC_MIN_INTERVAL_MS,
          maxRetries: env.KC_MAX_RETRIES,
          retryBaseDelayMs: env.KC_RETRY_BASE_DELAY_MS,
          requestTimeoutMs: env.KC_REQUEST_TIMEOUT_MS,
          httpsProxy: env.HTTPS_PROXY,
          httpProxy: env.HTTP_PROXY,
          noProxy: env.NO_PROXY,
        }),
    },
    {
      provide: TokenService,
      inject: [KeycloakHttpClient, AppConfigService],
      useFactory: (http: KeycloakHttpClient, { values: env }: AppConfigService) =>
        new TokenService(http, {
          baseUrl: env.KEYCLOAK_BASE_URL,
          realm: env.KEYCLOAK_REALM,
          clientId: env.KEYCLOAK_CLIENT_ID,
          clientSecret: env.KEYCLOAK_CLIENT_SECRET,
        }),
    },
    {
      provide: KeycloakAdminClient,
      inject: [KeycloakHttpClient, TokenService, AppConfigService],
      useFactory: (http: KeycloakHttpClient, tokens: TokenService, { values: env }: AppConfigService) =>
        new KeycloakAdminClient(http, tokens, env.KEYCLOAK_BASE_URL, env.KEYCLOAK_REALM),
    },
  ],
  exports: [KeycloakAdminClient, TokenService, KeycloakHttpClient],
})
export class KeycloakModule implements OnApplicationShutdown {
  constructor(@Inject(KeycloakHttpClient) private readonly http: KeycloakHttpClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.http.close();
  }
}
