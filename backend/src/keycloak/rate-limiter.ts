export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fila única para todas as requisições ao RH-SSO: limita a concorrência e
 * garante um intervalo mínimo entre o início de requisições consecutivas.
 */
export class RateLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private nextStartAt = 0;

  constructor(
    private readonly maxConcurrency: number,
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /** Adia o início de qualquer próxima requisição por pelo menos `ms`. */
  delayAll(ms: number): void {
    this.nextStartAt = Math.max(this.nextStartAt, this.now() + ms);
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
    } else {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    for (;;) {
      const now = this.now();
      const wait = this.nextStartAt - now;
      if (wait <= 0) {
        this.nextStartAt = now + this.minIntervalMs;
        return;
      }
      await this.sleep(wait);
    }
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}
