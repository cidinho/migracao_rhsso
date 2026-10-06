import type { KcGroup, KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';
import { GroupsService } from './groups.service.js';

const tree: KcGroup[] = [
  {
    id: 'g1',
    name: 'APP.PORTAL',
    path: '/APP.PORTAL',
    subGroups: [
      { id: 'g2', name: 'ROLE_PORTAL_USER', path: '/APP.PORTAL/ROLE_PORTAL_USER', subGroups: [] },
      { id: 'g3', name: 'ROLE_PORTAL_ADMIN', path: '/APP.PORTAL/ROLE_PORTAL_ADMIN' },
    ],
  },
  { id: 'g0', name: 'Administrativo', path: '/Administrativo' },
];

function setup(ttlSeconds = 300) {
  let clock = 0;
  const kc = { getGroupTree: vi.fn(async () => tree) };
  const svc = new GroupsService(kc as unknown as KeycloakAdminClient, ttlSeconds, () => clock);
  return { svc, kc, advance: (ms: number) => (clock += ms) };
}

describe('GroupsService', () => {
  it('mapeia a árvore com subgrupos, paths e ordenação por nome', async () => {
    const { svc } = setup();
    const result = await svc.getTree();
    expect(result.map((g) => g.name)).toEqual(['Administrativo', 'APP.PORTAL']);
    const ws = result[1];
    expect(ws.subGroups.map((g) => g.path)).toEqual([
      '/APP.PORTAL/ROLE_PORTAL_ADMIN',
      '/APP.PORTAL/ROLE_PORTAL_USER',
    ]);
    expect(ws.subGroups[0].subGroups).toEqual([]);
  });

  it('consulta o RH-SSO uma vez dentro do TTL', async () => {
    const { svc, kc, advance } = setup(300);
    await svc.getTree();
    advance(299_000);
    await svc.getTree();
    expect(kc.getGroupTree).toHaveBeenCalledTimes(1);
    advance(2_000);
    await svc.getTree();
    expect(kc.getGroupTree).toHaveBeenCalledTimes(2);
  });

  it('ignora o cache quando refresh=true', async () => {
    const { svc, kc } = setup();
    await svc.getTree();
    await svc.getTree(true);
    expect(kc.getGroupTree).toHaveBeenCalledTimes(2);
  });

  it('resolve IDs e indica os inexistentes', async () => {
    const { svc } = setup();
    const { found, missing } = await svc.resolve(['g2', 'nao-existe']);
    expect(found).toEqual([{ id: 'g2', name: 'ROLE_PORTAL_USER', path: '/APP.PORTAL/ROLE_PORTAL_USER' }]);
    expect(missing).toEqual(['nao-existe']);
  });
});
