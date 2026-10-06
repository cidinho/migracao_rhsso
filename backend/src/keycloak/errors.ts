export type KeycloakErrorType =
  | 'WAF_BLOCKED'
  | 'FORBIDDEN'
  | 'AUTH_FAILED'
  | 'USER_EXISTS'
  | 'HTTP'
  | 'NETWORK';

export abstract class KeycloakError extends Error {
  abstract readonly type: KeycloakErrorType;

  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class WafBlockedError extends KeycloakError {
  readonly type = 'WAF_BLOCKED';

  constructor(status: number, body?: string) {
    super(
      'Requisição bloqueada pelo WAF (resposta 403 sem JSON). O job foi pausado; aguarde e retome, ou reduza a taxa de requisições.',
      status,
      body,
    );
  }
}

export class KeycloakForbiddenError extends KeycloakError {
  readonly type = 'FORBIDDEN';

  constructor(body?: string) {
    super(
      'Permissão insuficiente: o client não tem os papéis necessários em realm-management (manage-users, view-users, query-groups).',
      403,
      body,
    );
  }
}

export class KeycloakAuthError extends KeycloakError {
  readonly type = 'AUTH_FAILED';
}

export class UserAlreadyExistsError extends KeycloakError {
  readonly type = 'USER_EXISTS';

  constructor(body?: string) {
    super('Usuário já existe no RH-SSO (409).', 409, body);
  }
}

export class KeycloakHttpError extends KeycloakError {
  readonly type = 'HTTP';

  constructor(status: number, body?: string) {
    super(`RH-SSO respondeu ${status}${describeBody(body)}`, status, body);
  }
}

export class KeycloakNetworkError extends KeycloakError {
  readonly type = 'NETWORK';

  constructor(cause: unknown) {
    super(`Falha de rede ao acessar o RH-SSO: ${errorMessage(cause)}`);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
  }
  return String(err);
}

function describeBody(body?: string): string {
  if (!body) return '';
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const msg = json.errorMessage ?? json.error_description ?? json.error;
    if (typeof msg === 'string') return `: ${msg}`;
  } catch {
    // corpo não-JSON
  }
  return `: ${body.slice(0, 200)}`;
}
