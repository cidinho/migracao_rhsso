import { sendJson, startServer, type TestServer } from '../../test/helpers/test-servers.js';
import { KeycloakAuthError, KeycloakForbiddenError } from './errors.js';
import { KeycloakHttpClient } from './http-client.js';
import { KeycloakAdminClient } from './keycloak-admin.client.js';
import { TokenService } from './token.service.js';

describe('TokenService e KeycloakAdminClient', () => {
  let server: TestServer;
  let http: KeycloakHttpClient;
  let clock: number;
  let tokenCount: number;
  let rejectTokens: Set<string>;

  beforeEach(async () => {
    clock = 1_000_000;
    tokenCount = 0;
    rejectTokens = new Set();
    server = await startServer((req, res) => {
      if (req.url.endsWith('/protocol/openid-connect/token')) {
        const form = new URLSearchParams(req.body);
        if (form.get('client_secret') !== 'segredo') {
          sendJson(res, 401, { error: 'unauthorized_client', error_description: 'Invalid client secret' });
          return;
        }
        tokenCount++;
        sendJson(res, 200, { access_token: `token-${tokenCount}`, expires_in: 300 });
        return;
      }
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      if (rejectTokens.has(token)) {
        sendJson(res, 401, { error: 'invalid token' });
        return;
      }
      if (req.url.startsWith('/auth/admin/realms/teste/users/count')) {
        sendJson(res, 200, 42);
        return;
      }
      if (req.url.startsWith('/auth/admin/realms/teste/groups')) {
        sendJson(res, 403, { error: 'unknown_error' });
        return;
      }
      sendJson(res, 404, {});
    });
    http = new KeycloakHttpClient({ maxConcurrency: 1, minIntervalMs: 0, maxRetries: 0, retryBaseDelayMs: 1, requestTimeoutMs: 5000 });
  });

  afterEach(async () => {
    await http.close();
    await server.close();
  });

  const tokens = (secret = 'segredo') =>
    new TokenService(http, { baseUrl: `${server.url}/auth`, realm: 'teste', clientId: 'importador', clientSecret: secret, now: () => clock });

  it('reutiliza o token dentro da validade', async () => {
    const svc = tokens();
    expect(await svc.getToken()).toBe('token-1');
    expect(await svc.getToken()).toBe('token-1');
    expect(tokenCount).toBe(1);
  });

  it('renova o token antes da expiração', async () => {
    const svc = tokens();
    await svc.getToken();
    clock += 271_000;
    expect(await svc.getToken()).toBe('token-2');
  });

  it('falha com mensagem clara quando as credenciais são inválidas', async () => {
    await expect(tokens('errado').getToken()).rejects.toBeInstanceOf(KeycloakAuthError);
    await expect(tokens('errado').getToken()).rejects.toThrow(/Invalid client secret/);
  });

  it('em 401 descarta o token, obtém outro e repete uma única vez', async () => {
    const svc = tokens();
    const admin = new KeycloakAdminClient(http, svc, `${server.url}/auth`, 'teste');
    await svc.getToken();
    rejectTokens.add('token-1');
    expect(await admin.countUsers()).toBe(42);
    expect(tokenCount).toBe(2);
  });

  it('traduz 403 com JSON em permissão insuficiente', async () => {
    const admin = new KeycloakAdminClient(http, tokens(), `${server.url}/auth`, 'teste');
    await expect(admin.getGroupTree()).rejects.toBeInstanceOf(KeycloakForbiddenError);
  });
});
