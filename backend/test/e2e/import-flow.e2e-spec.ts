import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PreviewResult } from '../../src/csv/csv-import.js';
import type { GroupNode } from '../../src/groups/groups.service.js';
import type { JobView, RowResult } from '../../src/imports/import.types.js';
import { csvForm, startHarness, type Harness } from './harness.js';
import type { KeycloakSimulator } from './keycloak-simulator.js';

const USER = '/APP.PORTAL/ROLE_PORTAL_USER';
const ADMIN = '/APP.PORTAL/ROLE_PORTAL_ADMIN';

function seed(sim: KeycloakSimulator): void {
  sim.addGroup('/APP.PORTAL');
  sim.addGroup(USER);
  sim.addGroup(ADMIN);
  sim.addGroup('/Outros');
  sim.addUser('bsilva', { email: 'bruno.silva@exemplo.com', firstName: 'Bruno', lastName: 'Silva' });
  sim.addUser('csouza', { email: 'carla.souza@exemplo.com', firstName: 'Carla', lastName: 'Souza' }, [USER]);
  sim.addUser(
    'dlima',
    { email: 'daniel.lima@exemplo.com', firstName: 'Daniel', lastName: 'Lima', requiredActions: ['CONFIGURE_TOTP'] },
    [USER, ADMIN],
  );
  // Membros extras para exercitar a paginação dos membros (KC_MEMBERS_PAGE_SIZE=2).
  for (const u of ['m1', 'm2', 'm3']) sim.addUser(u, {}, [USER]);
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness(seed);
});

afterAll(async () => {
  await h?.close();
});

async function preview(csv: string): Promise<PreviewResult> {
  const res = await h.api<PreviewResult>('POST', '/imports/preview', csvForm(csv));
  expect(res.status).toBe(200);
  return res.body;
}

async function startImport(csv: string, groupPaths: string[]): Promise<JobView> {
  const p = await preview(csv);
  const rows = p.rows.filter((r) => !r.errors.length).map(({ line, uid, nome, email }) => ({ line, uid, nome, email }));
  const res = await h.api<JobView>('POST', '/imports', {
    fileName: p.fileName,
    groupIds: groupPaths.map((g) => h.sim.groupId(g)),
    rows,
  });
  expect(res.status, res.text).toBe(201);
  return res.body;
}

async function waitFor(id: string, done: (v: JobView) => boolean, timeoutMs = 20_000): Promise<JobView> {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const view = (await h.api<JobView>('GET', `/imports/${id}`)).body;
    if (done(view)) return view;
    if (Date.now() > limit) throw new Error(`Timeout aguardando o job ${id}: ${JSON.stringify(view.status)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const finished = (v: JobView) => ['CONCLUIDO', 'CANCELADO', 'FALHOU'].includes(v.status);
const byUser = (view: JobView) => new Map<string, RowResult>(view.results.map((r) => [r.username, r]));

const MIXED_CSV = [
  'UID;NOME;Email',
  'ANOVO;Ana Maria Novo;ana.novo@exemplo.com',
  'bsilva;Bruno Silva;bruno.silva@exemplo.com',
  'csouza;Carla Souza;carla.souza@exemplo.com',
  'dlima;Daniel Lima;daniel.lima@exemplo.com',
  'enovo;Eduardo;ana.novo@exemplo.com',
  ';Sem Login;semlogin@exemplo.com',
].join('\r\n');

describe('importação ponta a ponta contra o Keycloak 16 simulado', () => {
  let firstJob: JobView;

  it('informa a conexão e lista a árvore de grupos', async () => {
    const health = await h.api<{ status: string; realm: string }>('GET', '/health?refresh=true');
    expect(health.body).toMatchObject({ status: 'ok', realm: 'teste' });

    const groups = await h.api<GroupNode[]>('GET', '/groups');
    const portal = groups.body.find((g) => g.path === '/APP.PORTAL');
    expect(portal?.subGroups.map((g) => g.path)).toEqual([ADMIN, USER]);
  });

  it('9.2 planilha mista: cria, acrescenta só os grupos que faltam e não altera quem já tem tudo', async () => {
    const p = await preview(MIXED_CSV);
    expect(p).toMatchObject({ total: 6, validCount: 5, invalidCount: 1 });

    const writesBefore = h.sim.countRequests('PUT', /\/groups\//);
    const job = await startImport(MIXED_CSV, [USER, ADMIN]);
    firstJob = await waitFor(job.id, finished);

    expect(firstJob.status).toBe('CONCLUIDO');
    expect(firstJob.counts).toEqual({
      CRIADO: 2,
      GRUPOS_ADICIONADOS: 2,
      SEM_ALTERACAO: 1,
      ERRO: 0,
      NAO_PROCESSADO: 0,
      IGNORADO: 0,
    });

    const rows = byUser(firstJob);
    expect(rows.get('anovo')).toMatchObject({ status: 'CRIADO', usuarioCriado: true, firstName: 'Ana', lastName: 'Maria Novo' });
    expect(rows.get('bsilva')?.grupos.map((g) => g.status)).toEqual(['ADICIONADO', 'ADICIONADO']);
    expect(rows.get('csouza')).toMatchObject({ status: 'GRUPOS_ADICIONADOS' });
    expect(rows.get('csouza')?.grupos.map((g) => [g.path, g.status])).toEqual([
      [USER, 'JA_POSSUIA'],
      [ADMIN, 'ADICIONADO'],
    ]);
    expect(rows.get('dlima')).toMatchObject({ status: 'SEM_ALTERACAO', usuarioCriado: false, acoesObrigatorias: [] });
    expect(rows.get('dlima')?.grupos.every((g) => g.status === 'JA_POSSUIA')).toBe(true);

    // Estado no "console": grupos efetivamente atribuídos.
    expect(h.sim.groupsOf('anovo')).toEqual([ADMIN, USER]);
    expect(h.sim.groupsOf('enovo')).toEqual([ADMIN, USER]);
    expect(h.sim.groupsOf('bsilva')).toEqual([ADMIN, USER]);
    expect(h.sim.groupsOf('csouza')).toEqual([ADMIN, USER]);
    // anovo e enovo (2 grupos cada) + bsilva (2) + csouza (1); dlima não gera escrita.
    expect(h.sim.countRequests('PUT', /\/groups\//) - writesBefore).toBe(7);
    // E-mail duplicado aceito pelo realm.
    expect(h.sim.user('enovo')?.email).toBe('ana.novo@exemplo.com');
  });

  it('9.4 só os usuários criados recebem UPDATE_PROFILE; os existentes mantêm suas ações', () => {
    expect(h.sim.user('anovo')).toMatchObject({ requiredActions: ['UPDATE_PROFILE'], enabled: true, emailVerified: true });
    expect(h.sim.user('enovo')).toMatchObject({ requiredActions: ['UPDATE_PROFILE'], firstName: 'Eduardo' });
    expect(h.sim.user('bsilva')?.requiredActions).toEqual([]);
    expect(h.sim.user('csouza')?.requiredActions).toEqual([]);
    expect(h.sim.user('dlima')?.requiredActions).toEqual(['CONFIGURE_TOTP']);
    expect(byUser(firstJob).get('anovo')?.acoesObrigatorias).toEqual(['UPDATE_PROFILE']);
  });

  it('9.3 reexecutar a mesma planilha deixa todas as linhas SEM_ALTERACAO, sem escritas', async () => {
    const posts = h.sim.countRequests('POST', /\/users$/);
    const puts = h.sim.countRequests('PUT', /\/groups\//);
    const job = await startImport(MIXED_CSV, [USER, ADMIN]);
    const view = await waitFor(job.id, finished);

    expect(view.counts.SEM_ALTERACAO).toBe(5);
    expect(view.results.every((r) => r.status === 'SEM_ALTERACAO')).toBe(true);
    expect(h.sim.countRequests('POST', /\/users$/)).toBe(posts);
    expect(h.sim.countRequests('PUT', /\/groups\//)).toBe(puts);
  });

  it('9.8 relatório CSV com BOM, separador ";" e uma linha por usuário', async () => {
    const res = await h.api<string>('GET', `/imports/${firstJob.id}/report.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="relatorio-importacao-.+\.csv"/);
    const raw = Buffer.from(await (await fetch(`${h.url}/api/imports/${firstJob.id}/report.csv`)).arrayBuffer());
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = res.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'Linha;UID;Username;Nome;Sobrenome;Email;Status;Ações obrigatórias;Grupos adicionados;Grupos que já possuía;Grupos com falha;Grupos inexistentes;Avisos;Mensagem',
    );
    expect(lines).toHaveLength(6);
    expect(lines.find((l) => l.includes(';dlima;'))).toContain(`${USER} | ${ADMIN}`);
  });

  it('9.6 bloqueio do WAF pausa o job e a retomada conclui sem perda nem duplicidade', async () => {
    const csv = ['UID;NOME;Email', 'f1;Fabio Um;f1@exemplo.com', 'f2;Fabio Dois;f2@exemplo.com', 'f3;Fabio Tres;f3@exemplo.com'].join('\n');
    const created = () => h.sim.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/users') && r.status === 201).length;
    const createdBefore = created();

    // Bloqueia logo após criar f1, no PUT do grupo: a linha fica pela metade.
    h.sim.wafWhen = (method, path) => method === 'PUT' && path.includes(`/users/${h.sim.user('f1')?.id}/`);
    const job = await startImport(csv, [USER]);
    const paused = await waitFor(job.id, (v) => v.status === 'PAUSADO' || finished(v));

    expect(paused).toMatchObject({ status: 'PAUSADO', pauseReason: 'WAF' });
    expect(paused.message).toBeTruthy();
    expect(paused.processed).toBeLessThan(3);
    expect(h.sim.user('f1')).toBeDefined();
    expect(h.sim.groupsOf('f1')).toEqual([]);

    h.sim.wafActive = false;
    const resumed = await h.api<JobView>('POST', `/imports/${job.id}/resume`);
    expect(resumed.status).toBe(200);
    const view = await waitFor(job.id, finished);

    expect(view.status).toBe('CONCLUIDO');
    expect(view.counts.CRIADO).toBe(3);
    expect(created() - createdBefore).toBe(3);
    expect(h.sim.requests.some((r) => r.status === 409)).toBe(false);
    for (const u of ['f1', 'f2', 'f3']) expect(h.sim.groupsOf(u)).toEqual([USER]);
  });

  it('9.8 reprocessar erros cria um novo job apenas com as linhas que falharam', async () => {
    const csv = ['UID;NOME;Email', 'g1;Gabriel Um;g1@exemplo.com', 'g2;Gabriel Dois;g2@exemplo.com'].join('\n');
    h.sim.failGroupFor.add('g2');
    const job = await startImport(csv, [USER]);
    const view = await waitFor(job.id, finished);

    expect(view.counts).toMatchObject({ CRIADO: 1, ERRO: 1 });
    const failedRow = byUser(view).get('g2')!;
    expect(failedRow).toMatchObject({ status: 'ERRO', usuarioCriado: true });
    expect(failedRow.grupos[0]).toMatchObject({ path: USER, status: 'FALHOU' });

    const report = await h.api<string>('GET', `/imports/${job.id}/report.csv`);
    const g2Line = report.text.split(/\r?\n/).find((l) => l.includes(';g2;'))!;
    expect(g2Line).toContain(USER);
    expect(g2Line).toContain('o usuário foi criado');

    h.sim.failGroupFor.clear();
    const retry = await h.api<JobView>('POST', `/imports/${job.id}/retry-errors`);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ sourceJobId: job.id, total: 1 });
    const retried = await waitFor(retry.body.id, finished);

    expect(retried.results).toHaveLength(1);
    expect(retried.results[0]).toMatchObject({ username: 'g2', status: 'GRUPOS_ADICIONADOS', usuarioCriado: false });
    expect(h.sim.groupsOf('g2')).toEqual([USER]);
  });

  it('registra cada importação concluída no log de auditoria', () => {
    const files = readdirSync(h.auditDir).filter((f) => /^importacoes-\d{4}-\d{2}\.jsonl$/.test(f));
    expect(files).toHaveLength(1);
    const entries = readFileSync(join(h.auditDir, files[0]!), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(entries[0]).toMatchObject({ realm: 'teste' });
  });

  it('rejeita arquivos que não são CSV com mensagem em português', async () => {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'planilha.pdf');
    const res = await h.api<{ code: string; message: string }>('POST', '/imports/preview', form);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_CSV');
  });
});
