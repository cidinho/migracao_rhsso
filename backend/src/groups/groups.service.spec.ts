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

  describe('resolvePaths', () => {
    it('resolve o path exato e, sem ele, o único igual sem diferenciar maiúsculas', async () => {
      const { svc } = setup();
      const result = await svc.resolvePaths(['/APP.PORTAL/ROLE_PORTAL_USER', '/app.portal/role_portal_admin']);
      expect(result.get('/APP.PORTAL/ROLE_PORTAL_USER')?.ref?.id).toBe('g2');
      expect(result.get('/app.portal/role_portal_admin')?.ref).toEqual({
        id: 'g3',
        name: 'ROLE_PORTAL_ADMIN',
        path: '/APP.PORTAL/ROLE_PORTAL_ADMIN',
      });
    });

    it('indica inexistente, mais de um nível e ambiguidade de maiúsculas', async () => {
      const ambiguous: KcGroup[] = [
        ...tree,
        { id: 'g4', name: 'APP.X', path: '/APP.X', subGroups: [{ id: 'g5', name: 'Role', path: '/APP.X/Role' }] },
        { id: 'g6', name: 'app.x', path: '/app.x', subGroups: [{ id: 'g7', name: 'ROLE', path: '/app.x/ROLE' }] },
      ];
      const kc = { getGroupTree: vi.fn(async () => ambiguous) };
      const svc = new GroupsService(kc as unknown as KeycloakAdminClient, 300, () => 0);
      const result = await svc.resolvePaths(['/APP.PORTAL/NAO_EXISTE', '/APP.PORTAL/A/B', '/App.X/role', '/APP.PORTAL']);
      expect(result.get('/APP.PORTAL/NAO_EXISTE')?.motivo).toBe('Grupo não existe no realm');
      expect(result.get('/APP.PORTAL/A/B')?.motivo).toContain('Apenas um nível');
      expect(result.get('/App.X/role')?.motivo).toContain('mais de um grupo');
      expect(result.get('/APP.PORTAL')?.motivo).toContain('Apenas um nível');
    });

    it('recarrega o cache uma vez quando algum path não é encontrado', async () => {
      const { svc, kc } = setup();
      await svc.getTree();
      await svc.resolvePaths(['/APP.PORTAL/ROLE_PORTAL_USER']);
      expect(kc.getGroupTree).toHaveBeenCalledTimes(1);
      await svc.resolvePaths(['/APP.PORTAL/NOVO']);
      expect(kc.getGroupTree).toHaveBeenCalledTimes(2);
    });
  });
});
