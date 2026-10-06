import { z } from 'zod';

export const KNOWN_REQUIRED_ACTIONS = [
  'UPDATE_PROFILE',
  'UPDATE_PASSWORD',
  'VERIFY_EMAIL',
  'CONFIGURE_TOTP',
  'terms_and_conditions',
] as const;

const required = (name: string) =>
  z
    .string({ error: `variável obrigatória ${name} não definida` })
    .trim()
    .min(1, `variável obrigatória ${name} está vazia`);

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const int = (def: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? String(def) : v))
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

const bool = (def: boolean) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return def;
      const s = v.toLowerCase();
      if (['true', '1', 'yes', 'sim'].includes(s)) return true;
      if (['false', '0', 'no', 'nao', 'não'].includes(s)) return false;
      ctx.addIssue({ code: 'custom', message: `valor booleano inválido: "${v}"` });
      return z.NEVER;
    });

const requiredActions = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return ['UPDATE_PROFILE'];
    const items = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = items.filter(
      (i) => !(KNOWN_REQUIRED_ACTIONS as readonly string[]).includes(i),
    );
    if (unknown.length) {
      ctx.addIssue({
        code: 'custom',
        message: `ação obrigatória desconhecida: ${unknown.join(', ')} (aceitas: ${KNOWN_REQUIRED_ACTIONS.join(', ')})`,
      });
      return z.NEVER;
    }
    return [...new Set(items)];
  });

export const envSchema = z.object({
  KEYCLOAK_BASE_URL: required('KEYCLOAK_BASE_URL')
    .pipe(z.url({ protocol: /^https?$/, error: 'KEYCLOAK_BASE_URL deve ser uma URL http(s)' }))
    .transform((v) => v.replace(/\/+$/, '')),
  KEYCLOAK_REALM: required('KEYCLOAK_REALM'),
  KEYCLOAK_CLIENT_ID: required('KEYCLOAK_CLIENT_ID'),
  KEYCLOAK_CLIENT_SECRET: required('KEYCLOAK_CLIENT_SECRET'),

  KC_EMAIL_VERIFIED: bool(true),
  KC_NEW_USER_REQUIRED_ACTIONS: requiredActions,
  KC_MAX_CONCURRENCY: int(1, 1, 20),
  KC_MIN_INTERVAL_MS: int(300, 0),
  KC_MAX_RETRIES: int(5, 0, 20),
  KC_RETRY_BASE_DELAY_MS: int(1000, 1),
  KC_REQUEST_TIMEOUT_MS: int(30000, 1000),
  KC_MEMBERS_PAGE_SIZE: int(500, 1, 5000),

  GROUPS_CACHE_TTL_SECONDS: int(300, 0),
  UPLOAD_MAX_BYTES: int(5 * 1024 * 1024, 1),
  UPLOAD_MAX_ROWS: int(10000, 1),
  JOB_RETENTION_MINUTES: int(120, 1),
  AUDIT_LOG_DIR: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || './logs'),

  HTTPS_PROXY: optionalText,
  HTTP_PROXY: optionalText,
  NO_PROXY: optionalText,

  HOST: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || '127.0.0.1'),
  PORT: int(3001, 1, 65535),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const input = {
    ...raw,
    HTTPS_PROXY: raw.HTTPS_PROXY ?? raw.https_proxy,
    HTTP_PROXY: raw.HTTP_PROXY ?? raw.http_proxy,
    NO_PROXY: raw.NO_PROXY ?? raw.no_proxy,
  };
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`,
    );
    throw new Error(
      `Configuração inválida. Verifique o .env ou as variáveis de ambiente:\n${lines.join('\n')}`,
    );
  }
  return result.data;
}
