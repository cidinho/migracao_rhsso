import { KeycloakHttpError, UserAlreadyExistsError, WafBlockedError } from '../../src/keycloak/errors.js';
import type { KcGroup, KcUser, NewUser } from '../../src/keycloak/keycloak-admin.client.js';

export interface StoredUser extends KcUser {
  requiredActions: string[];
  emailVerified?: boolean;
}

type Op = 'findUserByUsername' | 'createUser' | 'addUserToGroup' | 'listGroupMembers' | 'getGroupTree';

/** Keycloak em memória com o mesmo contrato de KeycloakAdminClient, para testes. */
export class FakeKeycloak {
  users = new Map<string, StoredUser>();
  groups: KcGroup[] = [];
  membership = new Map<string, Set<string>>();
  calls: Array<{ op: Op; args: unknown[] }> = [];
  wafWhen?: (op: Op, args: unknown[]) => boolean;
  failAddGroupWhen?: (userId: string, groupId: string) => boolean;
  conflictOnCreate = new Set<string>();
  private seq = 0;

  addGroup(id: string, path: string): this {
    const name = path.split('/').pop()!;
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    const group: KcGroup = { id, name, path, subGroups: [] };
    const parent = parentPath ? this.findGroup(parentPath, this.groups) : undefined;
    (parent ? parent.subGroups! : this.groups).push(group);
    this.membership.set(id, new Set());
    return this;
  }

  addUser(username: string, data: Partial<StoredUser> = {}, groupIds: string[] = []): StoredUser {
    const user: StoredUser = {
      id: `u-${++this.seq}`,
      username,
      email: `${username}@exemplo.com`,
      firstName: 'Nome',
      lastName: 'Existente',
      requiredActions: [],
      ...data,
    };
    this.users.set(user.id, user);
    for (const g of groupIds) this.membership.get(g)!.add(user.id);
    return user;
  }

  byUsername(username: string): StoredUser | undefined {
    return [...this.users.values()].find((u) => u.username === username);
  }

  groupsOf(userId: string): string[] {
    return [...this.membership.entries()].filter(([, m]) => m.has(userId)).map(([g]) => g);
  }

  writes(): number {
    return this.calls.filter((c) => c.op === 'createUser' || c.op === 'addUserToGroup').length;
  }

  async getGroupTree(): Promise<KcGroup[]> {
    this.record('getGroupTree', []);
    return structuredClone(this.groups);
  }

  async listGroupMembers(groupId: string, _pageSize: number): Promise<KcUser[]> {
    this.record('listGroupMembers', [groupId]);
    return [...(this.membership.get(groupId) ?? [])].map((id) => this.users.get(id)!);
  }

  async findUserByUsername(username: string): Promise<KcUser | undefined> {
    this.record('findUserByUsername', [username]);
    const user = this.byUsername(username);
    return user ? { ...user } : undefined;
  }

  async createUser(user: NewUser): Promise<string> {
    this.record('createUser', [user]);
    if (this.conflictOnCreate.delete(user.username)) {
      this.addUser(user.username, { email: user.email, firstName: user.firstName, lastName: user.lastName });
      throw new UserAlreadyExistsError();
    }
    if (this.byUsername(user.username)) throw new UserAlreadyExistsError();
    const created = this.addUser(user.username, { ...user });
    return created.id;
  }

  async addUserToGroup(userId: string, groupId: string): Promise<void> {
    this.record('addUserToGroup', [userId, groupId]);
    if (this.failAddGroupWhen?.(userId, groupId)) throw new KeycloakHttpError(500, '{"error":"falha simulada"}');
    this.membership.get(groupId)!.add(userId);
  }

  private record(op: Op, args: unknown[]): void {
    this.calls.push({ op, args });
    if (this.wafWhen?.(op, args)) throw new WafBlockedError(403, '<html>blocked</html>');
  }

  private findGroup(path: string, list: KcGroup[]): KcGroup | undefined {
    for (const g of list) {
      if (g.path === path) return g;
      const found = this.findGroup(path, g.subGroups ?? []);
      if (found) return found;
    }
    return undefined;
  }
}
