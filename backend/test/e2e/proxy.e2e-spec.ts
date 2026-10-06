import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobView } from '../../src/imports/import.types.js';
import { startProxy, type TestProxy } from '../helpers/test-servers.js';
import { csvForm, startHarness, type Harness } from './harness.js';

const GROUP = '/APP.PORTAL/ROLE_PORTAL_USER';

let h: Harness;
let proxy: TestProxy;

beforeAll(async () => {
  proxy = await startProxy();
  h = await startHarness(
    (sim) => {
      sim.addGroup('/APP.PORTAL');
      sim.addGroup(GROUP);
    },
    { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, NO_PROXY: '' },
  );
});

afterAll(async () => {
  await h?.close();
  await proxy?.close();
});

describe('9.7 execução através de proxy HTTP', () => {
  it('encaminha token, consultas e escritas ao Keycloak pelo proxy', async () => {
    const kcHost = new URL(process.env.KEYCLOAK_BASE_URL!).host;

    const health = await h.api<{ status: string }>('GET', '/health?refresh=true');
    expect(health.body.status).toBe('ok');

    const preview = await h.api<{ rows: Array<{ line: number; uid: string; nome: string; email: string }> }>(
      'POST',
      '/imports/preview',
      csvForm('UID;NOME;Email\npx1;Paula Proxy;px1@exemplo.com\n'),
    );
    const job = await h.api<JobView>('POST', '/imports', {
      fileName: 'proxy.csv',
      groupIds: [h.sim.groupId(GROUP)],
      rows: preview.body.rows.map(({ line, uid, nome, email }) => ({ line, uid, nome, email })),
    });
    expect(job.status).toBe(201);

    let view = job.body;
    while (!['CONCLUIDO', 'CANCELADO', 'FALHOU'].includes(view.status)) {
      await new Promise((r) => setTimeout(r, 25));
      view = (await h.api<JobView>('GET', `/imports/${view.id}`)).body;
    }

    expect(view.results[0]).toMatchObject({ username: 'px1', status: 'CRIADO' });
    expect(h.sim.groupsOf('px1')).toEqual([GROUP]);
    expect(proxy.hits.filter((hit) => hit.includes(kcHost)).length).toBeGreaterThan(0);
  });
});
