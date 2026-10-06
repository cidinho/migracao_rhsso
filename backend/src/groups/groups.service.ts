import type { KcGroup, KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';

export interface GroupNode {
  id: string;
  name: string;
  path: string;
  subGroups: GroupNode[];
}

export interface GroupRef {
  id: string;
  name: string;
  path: string;
}

interface Cache {
  tree: GroupNode[];
  byId: Map<string, GroupRef>;
  fetchedAt: number;
}

export class GroupsService {
  private cache?: Cache;
  private inflight?: Promise<Cache>;

  constructor(
    private readonly kc: KeycloakAdminClient,
    private readonly ttlSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getTree(refresh = false): Promise<GroupNode[]> {
    return (await this.load(refresh)).tree;
  }

  /** Resolve IDs de grupos; IDs desconhecidos são reconsultados uma vez sem cache. */
  async resolve(ids: string[]): Promise<{ found: GroupRef[]; missing: string[] }> {
    let cache = await this.load(false);
    if (ids.some((id) => !cache.byId.has(id))) cache = await this.load(true);
    const found: GroupRef[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const ref = cache.byId.get(id);
      if (ref) found.push(ref);
      else missing.push(id);
    }
    return { found, missing };
  }

  private async load(refresh: boolean): Promise<Cache> {
    const fresh = this.cache && this.now() - this.cache.fetchedAt < this.ttlSeconds * 1000;
    if (!refresh && fresh) return this.cache!;
    this.inflight ??= this.fetch().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetch(): Promise<Cache> {
    const raw = await this.kc.getGroupTree();
    const byId = new Map<string, GroupRef>();
    const map = (g: KcGroup, parentPath: string): GroupNode => {
      const path = g.path || `${parentPath}/${g.name}`;
      byId.set(g.id, { id: g.id, name: g.name, path });
      return {
        id: g.id,
        name: g.name,
        path,
        subGroups: (g.subGroups ?? []).map((s) => map(s, path)).sort(byName),
      };
    };
    const tree = raw.map((g) => map(g, '')).sort(byName);
    this.cache = { tree, byId, fetchedAt: this.now() };
    return this.cache;
  }
}

function byName(a: GroupNode, b: GroupNode): number {
  return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
}
