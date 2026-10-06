import { KeycloakAuthError, KeycloakHttpError } from './errors.js';
import type { KeycloakHttpClient } from './http-client.js';

export interface TokenServiceOptions {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  now?: () => number;
}

interface CachedToken {
  value: string;
  refreshAt: number;
}

export class TokenService {
  private cached?: CachedToken;
  private inflight?: Promise<string>;
  private readonly now: () => number;

  constructor(
    private readonly http: KeycloakHttpClient,
    private readonly options: TokenServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.refreshAt) return this.cached.value;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<string> {
    const { baseUrl, realm, clientId, clientSecret } = this.options;
    const res = await this.http.send({
      method: 'POST',
      url: `${baseUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new KeycloakAuthError(
        `Falha na autenticação do client "${clientId}" no realm "${realm}"${authDetail(res.body)}. Verifique KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET e se a service account está habilitada.`,
        res.status,
      );
    }
    if (res.status === 404) {
      throw new KeycloakAuthError(
        `Realm "${realm}" não encontrado em ${baseUrl}. Verifique KEYCLOAK_BASE_URL (o Keycloak 16 usa o contexto /auth) e KEYCLOAK_REALM.`,
        404,
      );
    }
    if (res.status !== 200) throw new KeycloakHttpError(res.status, res.body);

    const json = JSON.parse(res.body) as { access_token: string; expires_in?: number };
    const expiresInSec = json.expires_in ?? 60;
    const marginSec = Math.min(30, expiresInSec / 2);
    this.cached = {
      value: json.access_token,
      refreshAt: this.now() + (expiresInSec - marginSec) * 1000,
    };
    return json.access_token;
  }
}

function authDetail(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: string; error_description?: string };
    const detail = json.error_description ?? json.error;
    return detail ? ` (${detail})` : '';
  } catch {
    return '';
  }
}
