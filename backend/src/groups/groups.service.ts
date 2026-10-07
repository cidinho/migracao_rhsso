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

export type PathResolution = { ref: GroupRef; motivo?: undefined } | { ref?: undefined; motivo: string };

interface Cache {
  tree: GroupNode[];
  byId: Map<string, GroupRef>;
  byPath: Map<string, GroupRef>;
  byLowerPath: Map<string, GroupRef[]>;
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

  /**
   * Resolve paths `/<raiz>/<subgrupo>` da importação completa: path exato ou, se não houver,
   * um único path igual sem diferenciar maiúsculas. Paths não encontrados são reconsultados uma vez sem cache.
   */
  async resolvePaths(paths: string[], refresh = false): Promise<Map<string, PathResolution>> {
    const unique = [...new Set(paths)];
    let cache = await this.load(refresh);
    let result = resolveAll(cache, unique);
    if (!refresh && [...result.values()].some((r) => !r.ref)) {
      cache = await this.load(true);
      result = resolveAll(cache, unique);
    }
    return result;
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
    const byPath = new Map<string, GroupRef>();
    const byLowerPath = new Map<string, GroupRef[]>();
    const map = (g: KcGroup, parentPath: string): GroupNode => {
      const path = g.path || `${parentPath}/${g.name}`;
      const ref = { id: g.id, name: g.name, path };
      byId.set(g.id, ref);
      byPath.set(path, ref);
      byLowerPath.set(path.toLowerCase(), [...(byLowerPath.get(path.toLowerCase()) ?? []), ref]);
      return {
        id: g.id,
        name: g.name,
        path,
        subGroups: (g.subGroups ?? []).map((s) => map(s, path)).sort(byName),
      };
    };
    const tree = raw.map((g) => map(g, '')).sort(byName);
    this.cache = { tree, byId, byPath, byLowerPath, fetchedAt: this.now() };
    return this.cache;
  }
}

function resolveAll(cache: Cache, paths: string[]): Map<string, PathResolution> {
  return new Map(paths.map((path) => [path, resolveOne(cache, path)]));
}

function resolveOne(cache: Cache, path: string): PathResolution {
  const [, root, ...rest] = path.split('/');
  if (rest.length !== 1) return { motivo: 'Apenas um nível de subgrupo abaixo da raiz é aceito' };
  if (!root || !rest[0]) return { motivo: 'Nome de grupo vazio' };
  const exact = cache.byPath.get(path);
  if (exact) return { ref: exact };
  const candidates = cache.byLowerPath.get(path.toLowerCase()) ?? [];
  if (candidates.length === 1) return { ref: candidates[0] };
  if (candidates.length > 1) {
    return { motivo: `Corresponde a mais de um grupo (${candidates.map((c) => c.path).join(', ')}); use as maiúsculas exatas` };
  }
  return { motivo: 'Grupo não existe no realm' };
}

function byName(a: GroupNode, b: GroupNode): number {
  return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
}
