import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { KeycloakSimulator } from './keycloak-simulator.js';

export interface ApiResponse<T> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
}

export interface Harness {
  sim: KeycloakSimulator;
  url: string;
  auditDir: string;
  api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
  close(): Promise<void>;
}

/**
 * Sobe o simulador do Keycloak e o backend real (AppModule) apontando para ele.
 * O ConfigModule valida as variáveis ao importar o AppModule, por isso cada arquivo
 * de teste deve criar um único harness.
 */
export async function startHarness(
  seed: (sim: KeycloakSimulator) => void,
  env: Record<string, string> = {},
): Promise<Harness> {
  const sim = new KeycloakSimulator();
  seed(sim);
  const kcUrl = await sim.start();
  const auditDir = mkdtempSync(join(tmpdir(), 'importador-e2e-'));

  Object.assign(process.env, {
    KEYCLOAK_BASE_URL: kcUrl,
    KEYCLOAK_REALM: sim.realm,
    KEYCLOAK_CLIENT_ID: sim.clientId,
    KEYCLOAK_CLIENT_SECRET: sim.clientSecret,
    KC_MIN_INTERVAL_MS: '0',
    KC_MAX_CONCURRENCY: '1',
    KC_MAX_RETRIES: '2',
    KC_RETRY_BASE_DELAY_MS: '5',
    KC_MEMBERS_PAGE_SIZE: '2',
    AUDIT_LOG_DIR: auditDir,
    HTTPS_PROXY: '',
    HTTP_PROXY: '',
    NO_PROXY: '',
    ...env,
  });

  const { AppModule } = await import('../../src/app.module.js');
  const app: INestApplication = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  (app as NestExpressApplication).useBodyParser('json', { limit: '20mb' });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  return {
    sim,
    url,
    auditDir,
    async api<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
      const init: RequestInit = { method };
      if (body instanceof FormData) init.body = body;
      else if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { 'content-type': 'application/json' };
      }
      const res = await fetch(`${url}/api${path}`, init);
      const text = await res.text();
      const isJson = res.headers.get('content-type')?.includes('application/json');
      return { status: res.status, headers: res.headers, text, body: (isJson && text ? JSON.parse(text) : text) as T };
    },
    async close() {
      await app.close();
      await sim.stop();
      rmSync(auditDir, { recursive: true, force: true });
    },
  };
}

export function csvForm(content: string, fileName = 'usuarios.csv'): FormData {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), fileName);
  return form;
}
