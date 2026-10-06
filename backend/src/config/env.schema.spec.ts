import { validateEnv } from './env.schema.js';

const base = {
  KEYCLOAK_BASE_URL: 'https://sso.exemplo.com.br/auth/',
  KEYCLOAK_REALM: 'meu-realm',
  KEYCLOAK_CLIENT_ID: 'importador',
  KEYCLOAK_CLIENT_SECRET: 'segredo',
};

describe('validateEnv', () => {
  it('aplica os valores padrão', () => {
    const env = validateEnv(base);
    expect(env.KEYCLOAK_BASE_URL).toBe('https://sso.exemplo.com.br/auth');
    expect(env.KC_MAX_CONCURRENCY).toBe(1);
    expect(env.KC_MIN_INTERVAL_MS).toBe(300);
    expect(env.KC_EMAIL_VERIFIED).toBe(true);
    expect(env.KC_NEW_USER_REQUIRED_ACTIONS).toEqual(['UPDATE_PROFILE']);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe(3001);
  });

  it('falha indicando a variável obrigatória ausente', () => {
    const { KEYCLOAK_CLIENT_SECRET: _, ...semSecret } = base;
    expect(() => validateEnv(semSecret)).toThrow(/KEYCLOAK_CLIENT_SECRET/);
  });

  it('aceita lista vazia de ações obrigatórias', () => {
    expect(validateEnv({ ...base, KC_NEW_USER_REQUIRED_ACTIONS: '' }).KC_NEW_USER_REQUIRED_ACTIONS).toEqual([]);
  });

  it('aceita várias ações obrigatórias', () => {
    const env = validateEnv({ ...base, KC_NEW_USER_REQUIRED_ACTIONS: 'UPDATE_PROFILE, UPDATE_PASSWORD' });
    expect(env.KC_NEW_USER_REQUIRED_ACTIONS).toEqual(['UPDATE_PROFILE', 'UPDATE_PASSWORD']);
  });

  it('rejeita ação obrigatória desconhecida', () => {
    expect(() => validateEnv({ ...base, KC_NEW_USER_REQUIRED_ACTIONS: 'UPDATE_PROFILES' })).toThrow(/UPDATE_PROFILES/);
  });

  it('usa as variáveis de proxy em minúsculas como alternativa', () => {
    const env = validateEnv({ ...base, https_proxy: 'http://proxy:8080', no_proxy: 'localhost' });
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080');
    expect(env.NO_PROXY).toBe('localhost');
  });

  it('rejeita URL inválida', () => {
    expect(() => validateEnv({ ...base, KEYCLOAK_BASE_URL: 'sso.exemplo' })).toThrow(/KEYCLOAK_BASE_URL/);
  });
});
