import { RateLimiter } from './rate-limiter.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runTasks(limiter: RateLimiter, count: number, durationMs: number) {
  let active = 0;
  let maxActive = 0;
  const starts: number[] = [];
  await Promise.all(
    Array.from({ length: count }, () =>
      limiter.schedule(async () => {
        starts.push(Date.now());
        active++;
        maxActive = Math.max(maxActive, active);
        await wait(durationMs);
        active--;
      }),
    ),
  );
  return { maxActive, starts };
}

describe('RateLimiter', () => {
  it('nunca executa mais tarefas simultâneas que a concorrência configurada', async () => {
    expect((await runTasks(new RateLimiter(1, 0), 5, 15)).maxActive).toBe(1);
    expect((await runTasks(new RateLimiter(2, 0), 6, 15)).maxActive).toBe(2);
  });

  it('respeita o intervalo mínimo entre inícios consecutivos', async () => {
    const { starts } = await runTasks(new RateLimiter(3, 60), 4, 1);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(55);
    }
  });

  it('delayAll adia a próxima requisição', async () => {
    const limiter = new RateLimiter(1, 0);
    const t0 = Date.now();
    limiter.delayAll(120);
    await limiter.schedule(async () => undefined);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });

  it('libera a vaga mesmo quando a tarefa falha', async () => {
    const limiter = new RateLimiter(1, 0);
    await expect(limiter.schedule(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limiter.schedule(async () => 'ok')).resolves.toBe('ok');
  });
});
