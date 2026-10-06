import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envSchema, type Env } from './env.schema.js';

@Injectable()
export class AppConfigService {
  readonly values: Env;

  constructor(config: ConfigService) {
    this.values = Object.fromEntries(
      Object.keys(envSchema.shape).map((key) => [key, config.get(key)]),
    ) as Env;
  }
}
