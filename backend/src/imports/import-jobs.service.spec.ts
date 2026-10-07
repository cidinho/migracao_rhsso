import { BadRequestException } from '@nestjs/common';
import { FakeKeycloak } from '../../test/helpers/fake-keycloak.js';
import { GroupsService } from '../groups/groups.service.js';
import type { KeycloakAdminClient } from '../keycloak/keycloak-admin.client.js';
import type { AuditLogService } from './audit-log.service.js';
import { ImportJobsService, type ImportJobsOptions } from './import-jobs.service.js';
import { toReportCsv, toView } from './job-view.js';

const USER = 'g-user';
const ADMIN = 'g-admin';
const FIN = 'g-fin-consulta';
const P_USER = '/APP.PORTAL/ROLE_PORTAL_USER';
const P_ADMIN = '/APP.PORTAL/ROLE_PORTAL_ADMIN';
const P_FIN = '/APP.FINANCEIRO/ROLE_FIN_CONSULTA';

function setup(options: Partial<ImportJobsOptions> = {}) {
  const kc = new FakeKeycloak()
    .addGroup('g-ws', '/APP.PORTAL')
    .addGroup(USER, '/APP.PORTAL/ROLE_PORTAL_USER')
    .addGroup(ADMIN, '/APP.PORTAL/ROLE_PORTAL_ADMIN')
    .addGroup('g-fin', '/APP.FINANCEIRO')
    .addGroup(FIN, '/APP.FINANCEIRO/ROLE_FIN_CONSULTA');
  const client = kc as unknown as KeycloakAdminClient;
  const audit = { write: vi.fn(async () => undefined) };
  const groups = new GroupsService(client, 300);
  const svc = new ImportJobsService(client, groups, audit as unknown as AuditLogService, {
    realm: 'teste',
    maxConcurrency: 1,
    membersPageSize: 500,
    maxRows: 100,
    requiredActions: ['UPDATE_PROFILE'],
    emailVerified: true,
    retentionMinutes: 120,
    ...options,
  });
  return { kc, svc, audit, groups };
}

const row = (line: number, uid: string, nome = 'Maria da Silva', email = `${uid.toLowerCase()}@exemplo.com`) => ({
  line,
  uid,
  nome,
  email,
});

async function runJob(svc: ImportJobsService, rows: ReturnType<typeof row>[], groupIds = [USER, ADMIN]) {
  const job = await svc.create({ fileName: 'u.csv', rows, groupIds });
  await svc.idle(job.id);
  return job;
}

describe('ImportJobsService', () => {
  it('cria usuário inexistente com ações obrigatórias e todos os grupos', async () => {
    const { kc, svc, audit } = setup();
    const job = await runJob(svc, [row(2, 'T_ABC1234', 'Maria da Silva Santos')]);

    expect(job.status).toBe('CONCLUIDO');
    const [r] = job.results;
    expect(r).toMatchObject({
      status: 'CRIADO',
      username: 't_abc1234',
      firstName: 'Maria',
      lastName: 'da Silva Santos',
      usuarioCriado: true,
      acoesObrigatorias: ['UPDATE_PROFILE'],
    });
    expect(r.grupos.map((g) => g.status)).toEqual(['ADICIONADO', 'ADICIONADO']);
    const user = kc.byUsername('t_abc1234')!;
    expect(user.requiredActions).toEqual(['UPDATE_PROFILE']);
    expect(user.emailVerified).toBe(true);
    expect(kc.groupsOf(user.id).sort()).toEqual([ADMIN, USER]);
    expect(audit.write).toHaveBeenCalledTimes(1);
  });

  it('usuário existente recebe só os grupos faltantes e não ganha ações obrigatórias', async () => {
    const { kc, svc } = setup();
    const existing = kc.addUser('def5678', { requiredActions: ['VERIFY_EMAIL'] }, [USER]);
    const job = await runJob(svc, [row(2, 'def5678', 'Nome Existente', 'def5678@exemplo.com')]);

    const [r] = job.results;
    expect(r.status).toBe('GRUPOS_ADICIONADOS');
    expect(r.usuarioCriado).toBe(false);
    expect(r.acoesObrigatorias).toEqual([]);
    expect(r.grupos).toEqual([
      { id: USER, path: '/APP.PORTAL/ROLE_PORTAL_USER', status: 'JA_POSSUIA' },
      { id: ADMIN, path: '/APP.PORTAL/ROLE_PORTAL_ADMIN', status: 'ADICIONADO' },
    ]);
    expect(r.avisos).toEqual([]);
    expect(kc.users.get(existing.id)!.requiredActions).toEqual(['VERIFY_EMAIL']);
    const puts = kc.calls.filter((c) => c.op === 'addUserToGroup').map((c) => c.args[1]);
    expect(puts).toEqual([ADMIN]);
  });

  it('usuário existente com todos os grupos fica SEM_ALTERACAO, sem nenhuma escrita', async () => {
    const { kc, svc } = setup();
    kc.addUser('ghi9012', {}, [USER, ADMIN]);
    const job = await runJob(svc, [row(2, 'GHI9012', 'Nome Existente', 'ghi9012@exemplo.com')]);
    expect(job.results[0].status).toBe('SEM_ALTERACAO');
    expect(job.results[0].grupos.every((g) => g.status === 'JA_POSSUIA')).toBe(true);
    expect(kc.writes()).toBe(0);
  });

  it('registra aviso quando os dados do usuário existente divergem, sem alterá-los', async () => {
    const { kc, svc } = setup();
    kc.addUser('jkl3456', { email: 'antigo@exemplo.com' }, [USER, ADMIN]);
    const job = await runJob(svc, [row(2, 'jkl3456', 'Outro Nome', 'novo@exemplo.com')]);
    expect(job.results[0].avisos).toHaveLength(2);
    expect(job.results[0].avisos[0]).toContain('antigo@exemplo.com');
    expect(kc.byUsername('jkl3456')!.email).toBe('antigo@exemplo.com');
  });

  it('409 na criação segue como usuário existente, sem ações obrigatórias', async () => {
    const { kc, svc } = setup();
    kc.conflictOnCreate.add('mno7890');
    const job = await runJob(svc, [row(2, 'mno7890')]);
    const [r] = job.results;
    expect(r.status).toBe('GRUPOS_ADICIONADOS');
    expect(r.usuarioCriado).toBe(false);
    expect(kc.byUsername('mno7890')!.requiredActions).toEqual([]);
  });

  it('falha em um grupo marca a linha como ERRO e segue para a próxima', async () => {
    const { kc, svc } = setup();
    kc.failAddGroupWhen = (userId, groupId) => groupId === ADMIN && kc.users.get(userId)!.username === 'falha1';
    const job = await runJob(svc, [row(2, 'falha1'), row(3, 'ok1')]);

    expect(job.status).toBe('CONCLUIDO');
    expect(job.results[0]).toMatchObject({ status: 'ERRO', usuarioCriado: true });
    expect(job.results[0].grupos.map((g) => g.status)).toEqual(['ADICIONADO', 'FALHOU']);
    expect(job.results[0].erro).toContain('o usuário foi criado');
    expect(job.results[1].status).toBe('CRIADO');
  });

  it('reprocessar erros atribui só o grupo que faltou', async () => {
    const { kc, svc } = setup();
    kc.failAddGroupWhen = (_u, groupId) => groupId === ADMIN;
    const first = await runJob(svc, [row(2, 'falha1'), row(3, 'falha2')]);
    expect(toView(first).counts.ERRO).toBe(2);

    kc.failAddGroupWhen = undefined;
    const retry = await svc.retryErrors(first.id);
    await svc.idle(retry.id);
    expect(retry.sourceJobId).toBe(first.id);
    expect(retry.results.map((r) => r.status)).toEqual(['GRUPOS_ADICIONADOS', 'GRUPOS_ADICIONADOS']);
    expect(retry.results[0].grupos.map((g) => g.status)).toEqual(['JA_POSSUIA', 'ADICIONADO']);
    expect(kc.calls.filter((c) => c.op === 'createUser')).toHaveLength(2);
  });

  it('pausa no bloqueio do WAF sem marcar a linha como erro e retoma sem perder o progresso', async () => {
    const { kc, svc } = setup();
    let blocked = false;
    kc.wafWhen = (op, args) => {
      if (blocked || op !== 'addUserToGroup' || args[1] !== ADMIN) return false;
      const user = kc.users.get(args[0] as string)!;
      if (user.username !== 'linha3') return false;
      blocked = true;
      return true;
    };
    const job = await runJob(svc, [row(2, 'linha2'), row(3, 'linha3'), row(4, 'linha4')]);

    expect(job.status).toBe('PAUSADO');
    expect(job.pauseReason).toBe('WAF');
    expect(job.results.map((r) => r.linha)).toEqual([2]);
    expect(job.pending).toEqual([1, 2]);

    svc.resume(job.id);
    await svc.idle(job.id);
    expect(job.status).toBe('CONCLUIDO');
    expect(job.results.map((r) => [r.linha, r.status])).toEqual([
      [2, 'CRIADO'],
      [3, 'CRIADO'],
      [4, 'CRIADO'],
    ]);
    expect(job.results[1].acoesObrigatorias).toEqual(['UPDATE_PROFILE']);
    expect(kc.calls.filter((c) => c.op === 'createUser')).toHaveLength(3);
  });

  it('pausa no WAF durante a preparação e retoma depois', async () => {
    const { kc, svc } = setup();
    kc.wafWhen = (op) => op === 'listGroupMembers';
    const job = await runJob(svc, [row(2, 'a1')]);
    expect(job.status).toBe('PAUSADO');
    expect(job.prepared).toBe(false);

    kc.wafWhen = undefined;
    svc.resume(job.id);
    await svc.idle(job.id);
    expect(job.status).toBe('CONCLUIDO');
  });

  it('cancelar um job pausado marca as linhas restantes como NAO_PROCESSADO', async () => {
    const { kc, svc } = setup();
    kc.wafWhen = (op, args) => op === 'findUserByUsername' && args[0] === 'b2';
    const job = await runJob(svc, [row(2, 'b1'), row(3, 'b2'), row(4, 'b3')]);
    expect(job.status).toBe('PAUSADO');

    svc.cancel(job.id);
    await svc.idle(job.id);
    expect(job.status).toBe('CANCELADO');
    expect(toView(job).counts).toMatchObject({ CRIADO: 1, NAO_PROCESSADO: 2 });
  });

  it('pausa manual interrompe após a linha atual', async () => {
    const { kc, svc } = setup();
    const job = await svc.create({ fileName: 'u.csv', rows: [row(2, 'c1'), row(3, 'c2'), row(4, 'c3')], groupIds: [USER] });
    kc.wafWhen = (op) => {
      if (op === 'addUserToGroup') svc.pause(job.id);
      return false;
    };
    await svc.idle(job.id);
    expect(job.status).toBe('PAUSADO');
    expect(job.pauseReason).toBe('MANUAL');
    expect(job.results).toHaveLength(1);
  });

  it('não atribui grupos a quem já é membro (usa o levantamento prévio de membros)', async () => {
    const { kc, svc } = setup();
    kc.addUser('d1', {}, [USER]);
    await runJob(svc, [row(2, 'd1', 'Nome Existente', 'd1@exemplo.com')], [USER]);
    expect(kc.calls.filter((c) => c.op === 'listGroupMembers')).toHaveLength(1);
    expect(kc.calls.filter((c) => c.op === 'addUserToGroup')).toHaveLength(0);
  });

  it('cria usuários sem ações obrigatórias quando a configuração está vazia', async () => {
    const { kc, svc } = setup({ requiredActions: [] });
    const job = await runJob(svc, [row(2, 'e1')]);
    expect(job.results[0].acoesObrigatorias).toEqual([]);
    expect(kc.byUsername('e1')!.requiredActions).toEqual([]);
  });

  it('respeita a concorrência configurada processando todas as linhas', async () => {
    const { svc } = setup({ maxConcurrency: 3 });
    const job = await runJob(svc, Array.from({ length: 10 }, (_, i) => row(i + 2, `p${i}`)));
    expect(job.status).toBe('CONCLUIDO');
    expect(job.results).toHaveLength(10);
  });

  it('rejeita grupo inexistente sem criar o job', async () => {
    const { svc } = setup();
    await expect(svc.create({ fileName: 'u.csv', rows: [row(2, 'x')], groupIds: ['nao-existe'] })).rejects.toThrow(
      /nao-existe/,
    );
  });

  it('revalida as linhas no servidor', async () => {
    const { svc } = setup();
    await expect(
      svc.create({ fileName: 'u.csv', rows: [row(2, 'x', 'Nome', 'invalido')], groupIds: [USER] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gera o relatório CSV ordenado por linha', async () => {
    const { kc, svc } = setup();
    kc.addUser('r2', {}, [USER, ADMIN]);
    const job = await runJob(svc, [row(5, 'r1'), row(3, 'r2', 'Nome Existente', 'r2@exemplo.com')]);
    const lines = toReportCsv(job).replace('\uFEFF', '').trim().split('\r\n');
    expect(lines[0]).toContain('Linha;UID;Username;Nome;Sobrenome;Email;Status;Ações obrigatórias');
    expect(lines[1]).toMatch(/^3;r2;r2;.*SEM_ALTERACAO/);
    expect(lines[2]).toMatch(/^5;r1;r1;Maria;da Silva;.*CRIADO;UPDATE_PROFILE;/);
  });

  it('registra linhas inválidas e removidas como IGNORADO e importa as válidas', async () => {
    const { kc, svc } = setup();
    const job = await svc.create({
      fileName: 'u.csv',
      groupIds: [USER],
      rows: [row(2, 'ok1'), row(3, 'x', 'Nome', 'invalido'), { ...row(4, 'rem1'), removed: true }],
    });
    await svc.idle(job.id);
    const view = toView(job);
    expect(view).toMatchObject({ total: 1, processed: 1, mode: 'simples' });
    expect(view.counts).toMatchObject({ CRIADO: 1, IGNORADO: 2 });
    expect(job.results.filter((r) => r.status === 'IGNORADO').map((r) => [r.linha, r.erro])).toEqual([
      [3, 'E-mail com formato inválido'],
      [4, 'Removida na revisão'],
    ]);
    expect(kc.byUsername('x')).toBeUndefined();
    expect(kc.byUsername('rem1')).toBeUndefined();
    const report = toReportCsv(job);
    expect(report).toMatch(/\r\n3;x;x;.*;IGNORADO;.*E-mail com formato inválido/);
  });

  it('removida na revisão não conta como UID duplicado', async () => {
    const { svc } = setup();
    const job = await svc.create({
      fileName: 'u.csv',
      groupIds: [USER],
      rows: [{ ...row(2, 'dup'), removed: true }, row(3, 'DUP')],
    });
    await svc.idle(job.id);
    expect(job.results.map((r) => [r.linha, r.status])).toEqual([
      [2, 'IGNORADO'],
      [3, 'CRIADO'],
    ]);
  });

  describe('importação completa', () => {
    const full = (line: number, uid: string, groups: string[], nome?: string, email?: string) => ({
      ...row(line, uid, nome, email),
      groups,
    });

    async function runFull(svc: ImportJobsService, rows: (ReturnType<typeof row> & { groups?: string[] })[]) {
      const job = await svc.create({ fileName: 'u.csv', mode: 'completa', rows });
      await svc.idle(job.id);
      return job;
    }

    it('atribui a cada usuário só os grupos da própria linha', async () => {
      const { kc, svc } = setup();
      const job = await runFull(svc, [full(2, 'a1', [P_USER, P_ADMIN]), full(3, 'b2', [P_FIN])]);
      expect(job.status).toBe('CONCLUIDO');
      expect(job.groups.map((g) => g.id).sort()).toEqual([ADMIN, FIN, USER].sort());
      expect(kc.groupsOf(kc.byUsername('a1')!.id).sort()).toEqual([ADMIN, USER]);
      expect(kc.groupsOf(kc.byUsername('b2')!.id)).toEqual([FIN]);
      expect(job.results.map((r) => r.status)).toEqual(['CRIADO', 'CRIADO']);
      expect(toView(job).mode).toBe('completa');
    });

    it('grupo inexistente não é atribuído, vira INEXISTENTE com aviso e não torna a linha ERRO', async () => {
      const { kc, svc } = setup();
      const job = await runFull(svc, [full(2, 'a1', [P_USER, '/APP.PORTAL/ROLE_NAO_EXISTE'])]);
      const [r] = job.results;
      expect(r.status).toBe('CRIADO');
      expect(r.grupos).toEqual([
        { id: USER, path: P_USER, status: 'ADICIONADO' },
        { id: '/APP.PORTAL/ROLE_NAO_EXISTE', path: '/APP.PORTAL/ROLE_NAO_EXISTE', status: 'INEXISTENTE', erro: 'Grupo não existe no realm' },
      ]);
      expect(r.avisos).toEqual(['Grupo /APP.PORTAL/ROLE_NAO_EXISTE não foi atribuído: Grupo não existe no realm.']);
      expect(kc.groupsOf(kc.byUsername('a1')!.id)).toEqual([USER]);
    });

    it('usuário que já tem todos os grupos válidos fica SEM_ALTERACAO com aviso do inexistente', async () => {
      const { kc, svc } = setup();
      kc.addUser('c1', {}, [USER]);
      const job = await runFull(svc, [full(2, 'c1', [P_USER, '/APP.PORTAL/ROLE_X'], 'Nome Existente', 'c1@exemplo.com')]);
      expect(job.results[0].status).toBe('SEM_ALTERACAO');
      expect(job.results[0].grupos.map((g) => g.status)).toEqual(['JA_POSSUIA', 'INEXISTENTE']);
      expect(job.results[0].avisos).toHaveLength(1);
      expect(kc.writes()).toBe(0);
    });

    it('linha sem grupo ou só com grupos inexistentes fica IGNORADO', async () => {
      const { kc, svc } = setup();
      const job = await runFull(svc, [full(2, 'a1', [P_USER]), full(3, 'b2', []), full(4, 'c3', ['/APP.PORTAL/NADA'])]);
      expect(job.results.map((r) => [r.linha, r.status, r.erro])).toEqual([
        [3, 'IGNORADO', 'Nenhum grupo informado'],
        [4, 'IGNORADO', 'Nenhum grupo válido'],
        [2, 'CRIADO', undefined],
      ]);
      expect(job.results[1].grupos.map((g) => g.status)).toEqual(['INEXISTENTE']);
      expect(kc.byUsername('b2')).toBeUndefined();
      expect(kc.byUsername('c3')).toBeUndefined();
      expect(toView(job)).toMatchObject({ total: 1, processed: 1 });
    });

    it('recusa o job quando nenhuma linha tem grupo válido', async () => {
      const { svc } = setup();
      await expect(svc.create({ fileName: 'u.csv', mode: 'completa', rows: [full(2, 'a1', ['/APP.PORTAL/NADA'])] })).rejects.toThrow(
        /Nenhuma linha válida/,
      );
    });

    it('grupo apagado depois da revisão vira INEXISTENTE', async () => {
      const { kc, svc, groups } = setup();
      await groups.resolvePaths([P_USER, P_ADMIN]);
      const portal = kc.groups.find((g) => g.path === '/APP.PORTAL')!;
      portal.subGroups = portal.subGroups!.filter((g) => g.id !== ADMIN);
      const job = await runFull(svc, [full(2, 'a1', [P_USER, P_ADMIN])]);
      expect(job.results[0].status).toBe('CRIADO');
      expect(job.results[0].grupos.map((g) => [g.path, g.status])).toEqual([
        [P_USER, 'ADICIONADO'],
        [P_ADMIN, 'INEXISTENTE'],
      ]);
      expect(kc.calls.filter((c) => c.op === 'addUserToGroup')).toHaveLength(1);
    });

    it('levanta os membros da união dos grupos uma vez por grupo', async () => {
      const { kc, svc } = setup();
      await runFull(svc, [full(2, 'a1', [P_USER]), full(3, 'b2', [P_USER, P_FIN])]);
      expect(kc.calls.filter((c) => c.op === 'listGroupMembers').map((c) => c.args[0]).sort()).toEqual([FIN, USER].sort());
    });

    it('reprocessa os erros com os grupos de cada linha, sem as ignoradas', async () => {
      const { kc, svc } = setup();
      kc.failAddGroupWhen = (_u, groupId) => groupId === FIN;
      const first = await runFull(svc, [
        full(2, 'a1', [P_USER]),
        full(3, 'b2', [P_FIN, '/APP.PORTAL/NADA']),
        full(4, 'c3', []),
      ]);
      expect(toView(first).counts).toMatchObject({ CRIADO: 1, ERRO: 1, IGNORADO: 1 });

      kc.failAddGroupWhen = undefined;
      const retry = await svc.retryErrors(first.id);
      await svc.idle(retry.id);
      expect(retry.mode).toBe('completa');
      expect(retry.rows.map((r) => r.line)).toEqual([3]);
      expect(retry.results).toHaveLength(1);
      expect(retry.results[0].status).toBe('GRUPOS_ADICIONADOS');
      expect(retry.results[0].grupos.map((g) => [g.path, g.status])).toEqual([
        [P_FIN, 'ADICIONADO'],
        ['/APP.PORTAL/NADA', 'INEXISTENTE'],
      ]);
    });

    it('relatório traz a coluna de grupos inexistentes com o motivo', async () => {
      const { svc } = setup();
      const job = await runFull(svc, [full(2, 'a1', [P_USER, '/APP.PORTAL/NADA'])]);
      const [header, line] = toReportCsv(job).replace('\uFEFF', '').trim().split('\r\n');
      expect(header).toContain('Grupos com falha;Grupos inexistentes;Avisos');
      expect(line).toContain(';/APP.PORTAL/NADA: Grupo não existe no realm;');
    });
  });
});
