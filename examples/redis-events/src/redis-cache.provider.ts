import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RedisCacheAdapter } from '@nestarc/feature-flag';
import { Redis } from 'ioredis';

@Injectable()
export class RedisCacheProvider implements OnModuleDestroy {
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  readonly adapter = new RedisCacheAdapter({ client: this.client });

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
