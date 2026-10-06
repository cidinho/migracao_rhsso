import {
  KeycloakForbiddenError,
  KeycloakHttpError,
  UserAlreadyExistsError,
} from './errors.js';
import { header, type HttpResponse, type KeycloakHttpClient } from './http-client.js';
import type { TokenService } from './token.service.js';

export interface KcGroup {
  id: string;
  name: string;
  path: string;
  subGroups?: KcGroup[];
}

export interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface NewUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  requiredActions: string[];
}

type Query = Record<string, string | number | boolean | undefined>;

/** Endpoints da Admin REST API do Keycloak 16 usados pela aplicação. */
export class KeycloakAdminClient {
  constructor(
    private readonly http: KeycloakHttpClient,
    private readonly tokens: TokenService,
    private readonly baseUrl: string,
    private readonly realm: string,
  ) {}

  async getGroupTree(): Promise<KcGroup[]> {
    const res = await this.call('GET', '/groups', { briefRepresentation: true });
    return this.json<KcGroup[]>(res, 200);
  }

  async listGroupMembers(groupId: string, pageSize: number): Promise<KcUser[]> {
    const members: KcUser[] = [];
    for (let first = 0; ; first += pageSize) {
      const res = await this.call('GET', `/groups/${encodeURIComponent(groupId)}/members`, {
        first,
        max: pageSize,
        briefRepresentation: true,
      });
      const page = this.json<KcUser[]>(res, 200);
      members.push(...page);
      if (page.length < pageSize) return members;
    }
  }

  async findUserByUsername(username: string): Promise<KcUser | undefined> {
    const res = await this.call('GET', '/users', {
      username,
      exact: true,
      briefRepresentation: true,
    });
    const target = username.toLowerCase();
    return this.json<KcUser[]>(res, 200).find((u) => u.username.toLowerCase() === target);
  }

  async createUser(user: NewUser): Promise<string> {
    const res = await this.call('POST', '/users', undefined, { ...user, enabled: true });
    if (res.status === 409) throw new UserAlreadyExistsError(res.body);
    this.expect(res, 201);
    const location = header(res, 'location') ?? '';
    const id = location.split('/').filter(Boolean).pop();
    if (id) return id;
    const created = await this.findUserByUsername(user.username);
    if (!created) throw new KeycloakHttpError(res.status, 'Usuário criado, mas o ID não foi retornado.');
    return created.id;
  }

  async addUserToGroup(userId: string, groupId: string): Promise<void> {
    const res = await this.call(
      'PUT',
      `/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`,
    );
    this.expect(res, 204);
  }

  async countUsers(): Promise<number> {
    const res = await this.call('GET', '/users/count');
    return this.json<number>(res, 200);
  }

  private async call(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query?: Query,
    body?: unknown,
  ): Promise<HttpResponse> {
    const url = new URL(`${this.baseUrl}/admin/realms/${encodeURIComponent(this.realm)}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.getToken();
      const res = await this.http.send({
        method,
        url: url.toString(),
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 && attempt === 0) {
        this.tokens.invalidate();
        continue;
      }
      if (res.status === 403) throw new KeycloakForbiddenError(res.body);
      return res;
    }
  }

  private expect(res: HttpResponse, status: number): void {
    if (res.status !== status) throw new KeycloakHttpError(res.status, res.body);
  }

  private json<T>(res: HttpResponse, status: number): T {
    this.expect(res, status);
    return JSON.parse(res.body) as T;
  }
}
