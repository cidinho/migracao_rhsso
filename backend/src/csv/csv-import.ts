import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';

export type Encoding = 'utf-8-bom' | 'utf-8' | 'windows-1252';
export type Delimiter = ';' | ',';

export interface RowInput {
  line: number;
  uid: string;
  nome: string;
  email: string;
}

export interface NormalizedRow extends RowInput {
  username: string;
  firstName: string;
  lastName: string;
  errors: string[];
}

export interface PreviewResult {
  fileName: string;
  encoding: Encoding;
  delimiter: Delimiter;
  total: number;
  validCount: number;
  invalidCount: number;
  rows: NormalizedRow[];
}

export interface CsvLimits {
  maxBytes: number;
  maxRows: number;
}

export class CsvFileError extends Error {
  constructor(
    readonly code: 'NOT_CSV' | 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'EMPTY' | 'MISSING_COLUMNS' | 'MALFORMED',
    message: string,
  ) {
    super(message);
  }
}

const REQUIRED_COLUMNS = ['uid', 'nome', 'email'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const TEMPLATE_CSV = '\uFEFFUID;NOME;Email\r\nt_abc1234;Maria da Silva Santos;maria.santos@exemplo.com.br\r\n';

export function decode(buffer: Buffer): { text: string; encoding: Encoding } {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    return { text: iconv.decode(buffer, 'win1252'), encoding: 'windows-1252' };
  }
}

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  return count(',') > count(';') ? ',' : ';';
}

export function splitName(nome: string): { firstName: string; lastName: string } {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Normaliza e valida as linhas; usado na prévia e na revalidação ao criar o job. */
export function normalizeRows(rows: RowInput[]): NormalizedRow[] {
  const firstLineByUid = new Map<string, number>();
  return rows.map((input) => {
    const uid = (input.uid ?? '').trim();
    const nome = (input.nome ?? '').trim().replace(/\s+/g, ' ');
    const email = (input.email ?? '').trim();
    const username = uid.toLowerCase();
    const errors: string[] = [];

    if (!uid) errors.push('UID vazio');
    else if (/\s/.test(uid)) errors.push('UID não pode conter espaços');
    if (!nome) errors.push('NOME vazio');
    if (!email) errors.push('E-mail vazio');
    else if (!EMAIL_RE.test(email)) errors.push('E-mail com formato inválido');

    if (username) {
      const firstLine = firstLineByUid.get(username);
      if (firstLine !== undefined) errors.push(`UID duplicado (já aparece na linha ${firstLine})`);
      else firstLineByUid.set(username, input.line);
    }

    return { line: input.line, uid, nome, email, username, ...splitName(nome), errors };
  });
}

export function parseCsv(buffer: Buffer, fileName: string, limits: CsvLimits): PreviewResult {
  if (buffer.length > limits.maxBytes) {
    throw new CsvFileError('TOO_LARGE', `O arquivo excede o tamanho máximo de ${formatBytes(limits.maxBytes)}.`);
  }
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip || /\.(xlsx?|ods)$/i.test(fileName)) {
    throw new CsvFileError(
      'NOT_CSV',
      'Planilhas do Excel (.xlsx/.xls) não são aceitas. No Excel, use "Salvar como" e escolha "CSV (separado por vírgulas)" ou "CSV UTF-8".',
    );
  }
  if (!/\.csv$/i.test(fileName)) {
    throw new CsvFileError('NOT_CSV', 'O arquivo deve ter a extensão .csv.');
  }

  const { text, encoding } = decode(buffer);
  const delimiter = detectDelimiter(text);

  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(text, {
      delimiter,
      bom: true,
      info: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as unknown as Array<{ record: string[]; info: { lines: number } }>;
  } catch (err) {
    throw new CsvFileError('MALFORMED', `Não foi possível ler o CSV: ${(err as Error).message}`);
  }

  if (records.length === 0) throw new CsvFileError('EMPTY', 'O arquivo está vazio.');

  const header = records[0].record.map((h) => h.trim().toLowerCase());
  const index = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof REQUIRED_COLUMNS)[number],
    number
  >;
  const missing = REQUIRED_COLUMNS.filter((c) => index[c] < 0);
  if (missing.length) {
    const names = { uid: 'UID', nome: 'NOME', email: 'Email' };
    throw new CsvFileError(
      'MISSING_COLUMNS',
      `Coluna(s) obrigatória(s) ausente(s): ${missing.map((c) => names[c]).join(', ')}. O cabeçalho deve conter UID, NOME e Email.`,
    );
  }

  const data = records.slice(1).filter((r) => r.record.some((v) => v.trim() !== ''));
  if (data.length === 0) throw new CsvFileError('EMPTY', 'Não há usuários na planilha: o arquivo contém apenas o cabeçalho.');
  if (data.length > limits.maxRows) {
    throw new CsvFileError('TOO_MANY_ROWS', `A planilha tem ${data.length} linhas; o máximo permitido é ${limits.maxRows}.`);
  }

  const rows = normalizeRows(
    data.map(({ record, info }) => ({
      line: info.lines,
      uid: record[index.uid] ?? '',
      nome: record[index.nome] ?? '',
      email: record[index.email] ?? '',
    })),
  );
  const invalidCount = rows.filter((r) => r.errors.length).length;
  return {
    fileName,
    encoding,
    delimiter,
    total: rows.length,
    validCount: rows.length - invalidCount,
    invalidCount,
    rows,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) ? 1 : 0)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
