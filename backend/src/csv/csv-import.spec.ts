import iconv from 'iconv-lite';
import { CsvFileError, parseCsv, splitName, TEMPLATE_CSV } from './csv-import.js';

const limits = { maxBytes: 5 * 1024 * 1024, maxRows: 10_000 };

function expectFileError(fn: () => unknown, code: CsvFileError['code']) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CsvFileError);
    expect((err as CsvFileError).code).toBe(code);
    return err as CsvFileError;
  }
  throw new Error('esperava CsvFileError');
}

describe('parseCsv', () => {
  it('lê CSV do Excel em português: ";" e Windows-1252 com acentos', () => {
    const text = 'uid;nome;EMAIL\r\nJOA001;João Conceição;joao@exemplo.com\r\n';
    const result = parseCsv(iconv.encode(text, 'win1252'), 'usuarios.csv', limits);
    expect(result.encoding).toBe('windows-1252');
    expect(result.delimiter).toBe(';');
    expect(result.rows[0]).toMatchObject({
      line: 2,
      uid: 'JOA001',
      username: 'joa001',
      nome: 'João Conceição',
      firstName: 'João',
      lastName: 'Conceição',
      errors: [],
    });
  });

  it('lê UTF-8 com BOM e separador ","', () => {
    const buf = Buffer.from('\uFEFFUID,NOME,Email,Extra\nabc,Maria,maria@exemplo.com,x\n', 'utf8');
    const result = parseCsv(buf, 'u.CSV', limits);
    expect(result.encoding).toBe('utf-8-bom');
    expect(result.delimiter).toBe(',');
    expect(result.rows[0]).toMatchObject({ uid: 'abc', firstName: 'Maria', lastName: '' });
  });

  it('aceita o modelo de planilha', () => {
    const result = parseCsv(Buffer.from(TEMPLATE_CSV, 'utf8'), 'modelo.csv', limits);
    expect(result.validCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ uid: 't_abc1234', username: 't_abc1234' });
  });

  it('converte o UID para minúsculas e não exige o prefixo t_ do exemplo', () => {
    const csv = 'UID;NOME;Email\nT_ABC1234;Maria;maria@exemplo.com\nabc1234;Ana;ana@exemplo.com\n';
    const result = parseCsv(Buffer.from(csv), 'u.csv', limits);
    expect(result.invalidCount).toBe(0);
    expect(result.rows.map((r) => r.username)).toEqual(['t_abc1234', 'abc1234']);
  });

  it('rejeita coluna obrigatória ausente', () => {
    const err = expectFileError(() => parseCsv(Buffer.from('UID;NOME\na;b\n'), 'u.csv', limits), 'MISSING_COLUMNS');
    expect(err.message).toContain('Email');
  });

  it('rejeita arquivo .xlsx', () => {
    expectFileError(() => parseCsv(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'u.xlsx', limits), 'NOT_CSV');
  });

  it('rejeita arquivo só com cabeçalho', () => {
    const err = expectFileError(() => parseCsv(Buffer.from('UID;NOME;Email\n;;\n'), 'u.csv', limits), 'EMPTY');
    expect(err.message).toMatch(/não há usuários/i);
  });

  it('rejeita arquivo acima do limite de tamanho', () => {
    expectFileError(() => parseCsv(Buffer.alloc(11, 'a'), 'u.csv', { maxBytes: 10, maxRows: 10 }), 'TOO_LARGE');
  });

  it('rejeita arquivo acima do limite de linhas', () => {
    const csv = 'UID;NOME;Email\n' + Array.from({ length: 3 }, (_, i) => `u${i};N;u${i}@e.com`).join('\n');
    expectFileError(() => parseCsv(Buffer.from(csv), 'u.csv', { maxBytes: 1000, maxRows: 2 }), 'TOO_MANY_ROWS');
  });

  it('valida as linhas individualmente e detecta UID duplicado sem diferenciar caixa', () => {
    const csv = [
      'UID;NOME;Email',
      'T_ABC1234;Ana Lima;ana@exemplo.com',
      ';Sem Uid;semuid@exemplo.com',
      'x1;;x1@exemplo.com',
      'x2;Fulano;email-invalido',
      't_abc1234;Ana Repetida;ana2@exemplo.com',
      'x3;Beltrano;ana@exemplo.com',
    ].join('\n');
    const result = parseCsv(Buffer.from(csv), 'u.csv', limits);
    expect(result.total).toBe(6);
    expect(result.invalidCount).toBe(4);
    expect(result.rows[1].errors).toEqual(['UID vazio']);
    expect(result.rows[2].errors).toEqual(['NOME vazio']);
    expect(result.rows[3].errors).toEqual(['E-mail com formato inválido']);
    expect(result.rows[4]).toMatchObject({ line: 6, errors: ['UID duplicado (já aparece na linha 2)'] });
    expect(result.rows[5].errors).toEqual([]);
  });
});

describe('splitName', () => {
  it('separa o primeiro nome do restante', () => {
    expect(splitName('Maria da Silva Santos')).toEqual({ firstName: 'Maria', lastName: 'da Silva Santos' });
    expect(splitName('  Maria  ')).toEqual({ firstName: 'Maria', lastName: '' });
  });
});
