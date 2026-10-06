import { sendJson, startProxy, startServer, type TestProxy, type TestServer } from '../../test/helpers/test-servers.js';
import { KeycloakHttpError, KeycloakNetworkError, WafBlockedError } from './errors.js';
import { KeycloakHttpClient, type HttpClientOptions } from './http-client.js';

const defaults: HttpClientOptions = {
  maxConcurrency: 1,
  minIntervalMs: 0,
  maxRetries: 2,
  retryBaseDelayMs: 10,
  requestTimeoutMs: 5000,
};

describe('KeycloakHttpClient', () => {
  let server: TestServer | undefined;
  let proxy: TestProxy | undefined;
  let client: KeycloakHttpClient | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    await proxy?.close();
    client = server = proxy = undefined;
  });

  it('respeita Retry-After em respostas 429', async () => {
    let calls = 0;
    server = await startServer((_req, res) => {
      calls++;
      if (calls === 1) sendJson(res, 429, { error: 'too many' }, { 'retry-after': '1' });
      else sendJson(res, 200, { ok: true });
    });
    client = new KeycloakHttpClient(defaults);
    const res = await client.send({ method: 'GET', url: `${server.url}/x` });
    expect(res.status).toBe(200);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].at - server.requests[0].at).toBeGreaterThanOrEqual(950);
  });

  it('desiste após esgotar as retentativas em 503', async () => {
    server = await startServer((_req, res) => sendJson(res, 503, { error: 'indisponível' }));
    client = new KeycloakHttpClient(defaults);
    await expect(client.send({ method: 'GET', url: `${server.url}/x` })).rejects.toBeInstanceOf(KeycloakHttpError);
    expect(server.requests).toHaveLength(3);
  });

  it('identifica 403 com HTML como bloqueio do WAF, sem repetir', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('<html><body>Request blocked</body></html>');
    });
    client = new KeycloakHttpClient(defaults);
    await expect(client.send({ method: 'GET', url: `${server.url}/x` })).rejects.toBeInstanceOf(WafBlockedError);
    expect(server.requests).toHaveLength(1);
  });

  it('devolve 403 com JSON para tratamento como permissão insuficiente', async () => {
    server = await startServer((_req, res) => sendJson(res, 403, { error: 'unknown_error' }));
    client = new KeycloakHttpClient(defaults);
    const res = await client.send({ method: 'GET', url: `${server.url}/x` });
    expect(res.status).toBe(403);
  });

  it('repete em erro de rede e depois falha com KeycloakNetworkError', async () => {
    client = new KeycloakHttpClient({ ...defaults, maxRetries: 1 });
    await expect(client.send({ method: 'GET', url: 'http://127.0.0.1:1/x' })).rejects.toBeInstanceOf(KeycloakNetworkError);
  });

  it('roteia as requisições pelo proxy configurado', async () => {
    server = await startServer((_req, res) => sendJson(res, 200, { ok: true }));
    proxy = await startProxy();
    client = new KeycloakHttpClient({ ...defaults, httpProxy: proxy.url, httpsProxy: proxy.url, noProxy: 'exemplo.invalid' });
    const res = await client.send({ method: 'GET', url: `${server.url}/via-proxy` });
    expect(res.status).toBe(200);
    expect(proxy.hits.length).toBeGreaterThan(0);
    expect(proxy.hits[0]).toContain(new URL(server.url).port);
  });

  it('não usa o proxy para hosts em NO_PROXY', async () => {
    server = await startServer((_req, res) => sendJson(res, 200, { ok: true }));
    proxy = await startProxy();
    client = new KeycloakHttpClient({ ...defaults, httpProxy: proxy.url, httpsProxy: proxy.url, noProxy: '127.0.0.1' });
    const res = await client.send({ method: 'GET', url: `${server.url}/direto` });
    expect(res.status).toBe(200);
    expect(proxy.hits).toHaveLength(0);
  });
});
