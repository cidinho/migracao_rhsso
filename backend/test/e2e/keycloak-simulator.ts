import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

/**
 * Simulador HTTP da Admin REST API do Keycloak 16 (contexto /auth), restrito aos
 * endpoints usados pelo importador. Reproduz os códigos de status e formatos de
 * resposta do Keycloak real, além de um modo "WAF" que devolve 403 em HTML.
 *
 * Execução avulsa (para testar a interface): `node test/e2e/keycloak-simulator.ts`
 */

export interface SimUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  requiredActions: string[];
  createdTimestamp: number;
}

export interface SimGroup {
  id: string;
  name: string;
  path: string;
  subGroups: SimGroup[];
}

export interface SimRequest {
  method: string;
  path: string;
  status: number;
}

export interface SimulatorOptions {
  realm?: string;
  clientId?: string;
  clientSecret?: string;
  tokenTtlSeconds?: number;
  duplicateEmailsAllowed?: boolean;
}

const WAF_PAGE = '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected.</body></html>';

export class KeycloakSimulator {
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenTtlSeconds: number;
  readonly duplicateEmailsAllowed: boolean;

  users = new Map<string, SimUser>();
  groups: SimGroup[] = [];
  membership = new Map<string, Set<string>>();
  requests: SimRequest[] = [];
  /** Enquanto ativo, toda chamada à Admin API recebe 403 em HTML. */
  wafActive = false;
  /** Ativa o WAF (e mantém ativo) na primeira chamada à Admin API que satisfizer o predicado. */
  wafWhen?: (method: string, path: string) => boolean;
  /** Usernames cujo PUT de grupo devolve 500. */
  failGroupFor = new Set<string>();

  private tokens = new Map<string, number>();
  private server?: Server;
  private baseUrl = '';

  constructor(options: SimulatorOptions = {}) {
    this.realm = options.realm ?? 'teste';
    this.clientId = options.clientId ?? 'importador';
    this.clientSecret = options.clientSecret ?? 'segredo';
    this.tokenTtlSeconds = options.tokenTtlSeconds ?? 300;
    this.duplicateEmailsAllowed = options.duplicateEmailsAllowed ?? true;
  }

  async start(port = 0, host = '127.0.0.1'): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          this.handle(req, res, Buffer.concat(chunks).toString('utf8'));
        } catch (err) {
          this.send(res, req, 500, { error: String(err) });
        }
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(port, host, resolve));
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://${host}:${address.port}/auth`;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  addGroup(path: string): string {
    const name = path.split('/').pop()!;
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    const parent = parentPath ? this.groupByPath(parentPath) : undefined;
    if (parentPath && !parent) throw new Error(`Grupo pai inexistente: ${parentPath}`);
    const group: SimGroup = { id: randomUUID(), name, path, subGroups: [] };
    (parent ? parent.subGroups : this.groups).push(group);
    this.membership.set(group.id, new Set());
    return group.id;
  }

  addUser(username: string, data: Partial<Omit<SimUser, 'id' | 'username'>> = {}, groupPaths: string[] = []): SimUser {
    const user: SimUser = {
      id: randomUUID(),
      username: username.toLowerCase(),
      enabled: true,
      emailVerified: false,
      requiredActions: [],
      createdTimestamp: Date.now(),
      ...data,
    };
    this.users.set(user.id, user);
    for (const path of groupPaths) this.membership.get(this.groupId(path))!.add(user.id);
    return user;
  }

  groupId(path: string): string {
    const group = this.groupByPath(path);
    if (!group) throw new Error(`Grupo inexistente: ${path}`);
    return group.id;
  }

  user(username: string): SimUser | undefined {
    const target = username.toLowerCase();
    return [...this.users.values()].find((u) => u.username === target);
  }

  groupsOf(username: string): string[] {
    const user = this.user(username);
    if (!user) return [];
    return this.allGroups()
      .filter((g) => this.membership.get(g.id)!.has(user.id))
      .map((g) => g.path)
      .sort();
  }

  countRequests(method: string, pathPattern: RegExp): number {
    return this.requests.filter((r) => r.method === method && pathPattern.test(r.path)).length;
  }

  private handle(req: IncomingMessage, res: ServerResponse, body: string): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (path.startsWith('/__sim/')) return this.handleControl(req, res, url);

    const tokenMatch = path.match(/^\/auth\/realms\/([^/]+)\/protocol\/openid-connect\/token$/);
    if (tokenMatch && method === 'POST') return this.handleToken(req, res, decodeURIComponent(tokenMatch[1]!), body);

    const adminMatch = path.match(/^\/auth\/admin\/realms\/([^/]+)(\/.*)?$/);
    if (!adminMatch) return this.send(res, req, 404, { error: 'RESTEASY003210: Could not find resource for full path' });

    if (this.wafWhen?.(method, path)) {
      this.wafActive = true;
      this.wafWhen = undefined;
    }
    if (this.wafActive) return this.send(res, req, 403, WAF_PAGE, 'text/html');

    if (!this.authorized(req)) return this.send(res, req, 401, { error: 'HTTP 401 Unauthorized' });
    if (decodeURIComponent(adminMatch[1]!) !== this.realm) return this.send(res, req, 404, { error: 'Realm not found.' });

    return this.handleAdmin(req, res, method, adminMatch[2] ?? '/', url.searchParams, body);
  }

  private handleToken(req: IncomingMessage, res: ServerResponse, realm: string, body: string): void {
    if (realm !== this.realm) return this.send(res, req, 404, { error: 'Realm does not exist' });
    const form = new URLSearchParams(body);
    if (form.get('grant_type') !== 'client_credentials') {
      return this.send(res, req, 400, { error: 'unsupported_grant_type', error_description: 'Unsupported grant_type' });
    }
    if (form.get('client_id') !== this.clientId) {
      return this.send(res, req, 401, { error: 'invalid_client', error_description: 'Invalid client credentials' });
    }
    if (form.get('client_secret') !== this.clientSecret) {
      return this.send(res, req, 401, { error: 'unauthorized_client', error_description: 'Invalid client secret' });
    }
    const token = randomUUID();
    this.tokens.set(token, Date.now() + this.tokenTtlSeconds * 1000);
    return this.send(res, req, 200, {
      access_token: token,
      expires_in: this.tokenTtlSeconds,
      refresh_expires_in: 0,
      token_type: 'Bearer',
      'not-before-policy': 0,
      scope: 'profile email',
    });
  }

  private handleAdmin(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    path: string,
    query: URLSearchParams,
    body: string,
  ): void {
    let m: RegExpMatchArray | null;

    if (method === 'GET' && path === '/groups') return this.send(res, req, 200, this.groups);

    if (method === 'GET' && (m = path.match(/^\/groups\/([^/]+)\/members$/))) {
      const members = this.membership.get(decodeURIComponent(m[1]!));
      if (!members) return this.send(res, req, 404, { error: 'Could not find group by id' });
      const first = Number(query.get('first') ?? 0);
      const max = Number(query.get('max') ?? 100);
      const page = [...members]
        .map((id) => this.users.get(id)!)
        .sort((a, b) => a.username.localeCompare(b.username))
        .slice(first, first + max)
        .map((u) => this.representation(u, true));
      return this.send(res, req, 200, page);
    }

    if (method === 'GET' && path === '/users/count') return this.send(res, req, 200, this.users.size);

    if (method === 'GET' && path === '/users') {
      const username = query.get('username')?.toLowerCase();
      const exact = query.get('exact') === 'true';
      const brief = query.get('briefRepresentation') === 'true';
      const found = [...this.users.values()]
        .filter((u) => !username || (exact ? u.username === username : u.username.includes(username)))
        .map((u) => this.representation(u, brief));
      return this.send(res, req, 200, found);
    }

    if (method === 'GET' && (m = path.match(/^\/users\/([^/]+)$/))) {
      const user = this.users.get(decodeURIComponent(m[1]!));
      if (!user) return this.send(res, req, 404, { error: 'User not found' });
      return this.send(res, req, 200, this.representation(user, false));
    }

    if (method === 'POST' && path === '/users') {
      const rep = JSON.parse(body || '{}') as Partial<SimUser>;
      if (!rep.username) return this.send(res, req, 400, { errorMessage: 'User name is missing' });
      if (this.user(rep.username)) return this.send(res, req, 409, { errorMessage: 'User exists with same username' });
      if (
        !this.duplicateEmailsAllowed &&
        rep.email &&
        [...this.users.values()].some((u) => u.email?.toLowerCase() === rep.email!.toLowerCase())
      ) {
        return this.send(res, req, 409, { errorMessage: 'User exists with same email' });
      }
      const user = this.addUser(rep.username, {
        email: rep.email?.toLowerCase(),
        firstName: rep.firstName,
        lastName: rep.lastName,
        enabled: rep.enabled ?? false,
        emailVerified: rep.emailVerified ?? false,
        requiredActions: rep.requiredActions ?? [],
      });
      res.setHeader('location', `${this.baseUrl}/admin/realms/${this.realm}/users/${user.id}`);
      return this.send(res, req, 201, undefined);
    }

    if (method === 'PUT' && (m = path.match(/^\/users\/([^/]+)\/groups\/([^/]+)$/))) {
      const user = this.users.get(decodeURIComponent(m[1]!));
      if (!user) return this.send(res, req, 404, { error: 'User not found' });
      const members = this.membership.get(decodeURIComponent(m[2]!));
      if (!members) return this.send(res, req, 404, { error: 'Group not found' });
      if (this.failGroupFor.has(user.username)) return this.send(res, req, 500, { error: 'unknown_error' });
      members.add(user.id);
      return this.send(res, req, 204, undefined);
    }

    return this.send(res, req, 404, { error: 'RESTEASY003210: Could not find resource for full path' });
  }

  /** Endpoints de controle para testes manuais: estado, WAF e falha de grupo. */
  private handleControl(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const flag = url.searchParams.get('active') !== 'false';
    if (url.pathname === '/__sim/state') {
      const users = [...this.users.values()].map((u) => ({ ...u, groups: this.groupsOf(u.username) }));
      return this.send(res, req, 200, { wafActive: this.wafActive, users }, 'application/json', false);
    }
    if (url.pathname === '/__sim/waf' && req.method === 'POST') {
      this.wafActive = flag;
      return this.send(res, req, 200, { wafActive: this.wafActive }, 'application/json', false);
    }
    if (url.pathname === '/__sim/fail-group' && req.method === 'POST') {
      const username = (url.searchParams.get('username') ?? '').toLowerCase();
      if (flag) this.failGroupFor.add(username);
      else this.failGroupFor.delete(username);
      return this.send(res, req, 200, { failGroupFor: [...this.failGroupFor] }, 'application/json', false);
    }
    return this.send(res, req, 404, { error: 'not found' }, 'application/json', false);
  }

  private authorized(req: IncomingMessage): boolean {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const expiresAt = token ? this.tokens.get(token) : undefined;
    return expiresAt !== undefined && Date.now() < expiresAt;
  }

  private representation(user: SimUser, brief: boolean): Record<string, unknown> {
    const { requiredActions, ...base } = user;
    return brief ? base : { ...base, requiredActions, totp: false, disableableCredentialTypes: [], notBefore: 0 };
  }

  private send(
    res: ServerResponse,
    req: IncomingMessage,
    status: number,
    body: unknown,
    contentType = 'application/json',
    record = true,
  ): void {
    if (record) this.requests.push({ method: req.method ?? 'GET', path: new URL(req.url ?? '/', 'http://x').pathname, status });
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    res.writeHead(status, { 'content-type': contentType });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }

  private groupByPath(path: string): SimGroup | undefined {
    return this.allGroups().find((g) => g.path === path);
  }

  private allGroups(list = this.groups): SimGroup[] {
    return list.flatMap((g) => [g, ...this.allGroups(g.subGroups)]);
  }
}

/** Dados de demonstração usados na execução avulsa. */
export function seedDemo(sim: KeycloakSimulator): void {
  for (const path of [
    '/APP.PORTAL',
    '/APP.PORTAL/ROLE_PORTAL_USER',
    '/APP.PORTAL/ROLE_PORTAL_ADMIN',
    '/APP.PORTAL/ROLE_PORTAL_ADMIN/ROLE_PORTAL_AUDITOR',
    '/APP.FINANCEIRO',
    '/APP.FINANCEIRO/ROLE_FIN_CONSULTA',
    '/APP.FINANCEIRO/ROLE_FIN_APROVADOR',
    '/Colaboradores',
  ]) {
    sim.addGroup(path);
  }
  sim.addUser('bsilva', { email: 'bruno.silva@exemplo.com', firstName: 'Bruno', lastName: 'Silva' });
  sim.addUser('csouza', { email: 'carla.souza@exemplo.com', firstName: 'Carla', lastName: 'Souza' }, [
    '/APP.PORTAL/ROLE_PORTAL_USER',
  ]);
  sim.addUser(
    'dlima',
    { email: 'daniel.lima@exemplo.com', firstName: 'Daniel', lastName: 'Lima', requiredActions: ['CONFIGURE_TOTP'] },
    ['/APP.PORTAL/ROLE_PORTAL_USER', '/APP.PORTAL/ROLE_PORTAL_ADMIN'],
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const sim = new KeycloakSimulator();
  seedDemo(sim);
  const url = await sim.start(Number(process.env.KC_SIM_PORT ?? 8180));
  console.log(`Keycloak 16 simulado em ${url} (realm "${sim.realm}", client "${sim.clientId}" / "${sim.clientSecret}")`);
  console.log('Controle: GET /__sim/state · POST /__sim/waf?active=true|false · POST /__sim/fail-group?username=x&active=true|false');
}
