import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NormalizedRow, PreviewResult } from '../../src/csv/csv-import.js';
import type { JobView, RowResult } from '../../src/imports/import.types.js';
import { csvForm, startHarness, type Harness } from './harness.js';
import type { KeycloakSimulator } from './keycloak-simulator.js';

const USER = '/APP.PORTAL/ROLE_PORTAL_USER';
const ADMIN = '/APP.PORTAL/ROLE_PORTAL_ADMIN';
const FIN = '/APP.FINANCEIRO/ROLE_FIN_CONSULTA';

function seed(sim: KeycloakSimulator): void {
  sim.addGroup('/APP.PORTAL');
  sim.addGroup(USER);
  sim.addGroup(ADMIN);
  sim.addGroup('/APP.FINANCEIRO');
  sim.addGroup(FIN);
  sim.addUser('bsilva', { email: 'bruno.silva@exemplo.com', firstName: 'Bruno', lastName: 'Silva' }, [USER]);
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness(seed);
});

afterAll(async () => {
  await h?.close();
});

async function preview(csv: string): Promise<PreviewResult> {
  const res = await h.api<PreviewResult>('POST', '/imports/preview?mode=completa', csvForm(csv));
  expect(res.status, res.text).toBe(200);
  return res.body;
}

const toInput = ({ line, uid, nome, email, groups }: NormalizedRow) => ({ line, uid, nome, email, groups });

async function waitFor(id: string): Promise<JobView> {
  const limit = Date.now() + 20_000;
  for (;;) {
    const view = (await h.api<JobView>('GET', `/imports/${id}`)).body;
    if (['CONCLUIDO', 'CANCELADO', 'FALHOU'].includes(view.status)) return view;
    if (Date.now() > limit) throw new Error(`Timeout aguardando o job ${id}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const byUser = (view: JobView) => new Map<string, RowResult>(view.results.map((r) => [r.username, r]));

const CSV = [
  'UID;NOME;Email;APP.PORTAL;APP.FINANCEIRO',
  't_ana;Ana Lima;ana@exemplo.com;ROLE_PORTAL_USER|role_portal_admin;',
  'bsilva;Bruno Silva;bruno.silva@exemplo.com;ROLE_PORTAL_USER|ROLE_NAO_EXISTE;ROLE_FIN_CONSULTA',
  't_caio;Caio Reis;caio@exemplo.com;;',
  't_davi;Davi Souza;davi@exemplo.com;ROLE_X;',
  't_eva;Eva Prado;eva@exemplo.com;;ROLE_FIN_CONSULTA',
].join('\r\n');

describe('importação completa ponta a ponta contra o Keycloak 16 simulado', () => {
  let p: PreviewResult;

  it('baixa o modelo da importação completa', async () => {
    const res = await h.api<string>('GET', '/imports/template.csv?mode=completa');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('modelo-importacao-completa.csv');
    expect(res.text).toContain('UID;NOME;Email;APP.PORTAL');
    expect(res.text).toContain('ROLE_PORTAL_USER|ROLE_PORTAL_ADMIN');
  });

  it('a prévia valida os grupos de cada linha contra o realm', async () => {
    p = await preview(CSV);
    expect(p).toMatchObject({ mode: 'completa', groupColumns: ['APP.PORTAL', 'APP.FINANCEIRO'], validCount: 3, invalidCount: 2 });
    const [ana, bruno, caio, davi] = p.rows;
    expect(ana.groupChecks?.map((g) => [g.path, g.status])).toEqual([
      [USER, 'OK'],
      [ADMIN, 'OK'],
    ]);
    expect(bruno.errors).toEqual([]);
    expect(bruno.groupChecks?.map((g) => [g.path, g.status])).toEqual([
      [USER, 'OK'],
      ['/APP.PORTAL/ROLE_NAO_EXISTE', 'INEXISTENTE'],
      [FIN, 'OK'],
    ]);
    expect(caio.errors).toEqual(['Nenhum grupo informado']);
    expect(davi.errors).toEqual(['Nenhum grupo válido']);
  });

  it('rejeita planilha sem coluna de grupo', async () => {
    const res = await h.api<{ code: string }>('POST', '/imports/preview?mode=completa', csvForm('UID;NOME;Email\na;Ana;a@exemplo.com\n'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_COLUMNS');
  });

  it('atribui os grupos de cada linha, ignora as inválidas e as removidas', async () => {
    const rows = p.rows.map((r) => ({ ...toInput(r), ...(r.uid === 't_eva' && { removed: true }) }));
    const res = await h.api<JobView>('POST', '/imports', { fileName: p.fileName, mode: 'completa', rows });
    expect(res.status, res.text).toBe(201);
    const view = await waitFor(res.body.id);

    expect(view).toMatchObject({ status: 'CONCLUIDO', mode: 'completa', total: 2, processed: 2 });
    expect(view.counts).toMatchObject({ CRIADO: 1, GRUPOS_ADICIONADOS: 1, IGNORADO: 3 });
    const rowsByUser = byUser(view);
    expect(rowsByUser.get('t_caio')).toMatchObject({ status: 'IGNORADO', erro: 'Nenhum grupo informado' });
    expect(rowsByUser.get('t_davi')).toMatchObject({ status: 'IGNORADO', erro: 'Nenhum grupo válido' });
    expect(rowsByUser.get('t_eva')).toMatchObject({ status: 'IGNORADO', erro: 'Removida na revisão' });
    expect(rowsByUser.get('bsilva')?.grupos.map((g) => [g.path, g.status])).toEqual([
      [USER, 'JA_POSSUIA'],
      [FIN, 'ADICIONADO'],
      ['/APP.PORTAL/ROLE_NAO_EXISTE', 'INEXISTENTE'],
    ]);
    expect(rowsByUser.get('bsilva')?.avisos[0]).toContain('ROLE_NAO_EXISTE');

    expect(h.sim.groupsOf('t_ana')).toEqual([ADMIN, USER]);
    expect(h.sim.groupsOf('bsilva')).toEqual([FIN, USER]);
    for (const u of ['t_caio', 't_davi', 't_eva']) expect(h.sim.user(u)).toBeUndefined();

    const report = await h.api<string>('GET', `/imports/${view.id}/report.csv`);
    const lines = report.text.trim().split(/\r?\n/);
    expect(lines).toHaveLength(6);
    expect(lines.find((l) => l.includes(';bsilva;'))).toContain('/APP.PORTAL/ROLE_NAO_EXISTE: Grupo não existe no realm');
    expect(lines.find((l) => l.includes(';t_caio;'))).toContain(';IGNORADO;');
  });

  it('reexecutar a mesma planilha não remove grupos e deixa as linhas SEM_ALTERACAO', async () => {
    const rows = p.rows.filter((r) => !r.errors.length).map(toInput);
    const puts = h.sim.countRequests('PUT', /\/groups\//);
    const res = await h.api<JobView>('POST', '/imports', { fileName: p.fileName, mode: 'completa', rows });
    const view = await waitFor(res.body.id);
    expect(view.results.map((r) => [r.username, r.status])).toEqual([
      ['t_ana', 'SEM_ALTERACAO'],
      ['bsilva', 'SEM_ALTERACAO'],
      ['t_eva', 'CRIADO'],
    ]);
    expect(h.sim.countRequests('PUT', /\/groups\//) - puts).toBe(1);
    expect(h.sim.groupsOf('bsilva')).toEqual([FIN, USER]);
  });

  it('recusa a criação do job sem nenhuma linha válida', async () => {
    const res = await h.api<{ message: string }>('POST', '/imports', {
      mode: 'completa',
      rows: [{ line: 2, uid: 'x', nome: 'X', email: 'x@exemplo.com', groups: ['/APP.PORTAL/NADA'] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Nenhuma linha válida');
  });
});
