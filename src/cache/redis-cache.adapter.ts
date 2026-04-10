import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CacheAdapter } from '../interfaces/cache-adapter.interface';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';

export interface RedisCacheAdapterOptions {
  client: Redis;
  subscriber?: Redis;
  keyPrefix?: string;
  channel?: string;
}

@Injectable()
export class RedisCacheAdapter implements CacheAdapter {
  private readonly client: Redis;
  private readonly subscriber: Redis;
  private readonly keyPrefix: string;
  private readonly channel: string;
  private readonly ownsSubscriber: boolean;

  constructor(options: RedisCacheAdapterOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'feature-flag:';
    this.channel = options.channel ?? 'feature-flag:invalidate';

    if (options.subscriber) {
      this.subscriber = options.subscriber;
      this.ownsSubscriber = false;
    } else {
      this.subscriber = this.client.duplicate();
      this.ownsSubscriber = true;
    }

    this.setupSubscription();
  }

  private setupSubscription(): void {
    this.subscriber.subscribe(this.channel);
    this.subscriber.on('message', (ch: string, message: string) => {
      if (ch !== this.channel) return;
      if (message === '__all__') {
        this.flushLocal();
      } else {
        this.client.del(this.prefixedKey(message));
        this.client.del(this.prefixedKey('__all__'));
      }
    });
  }

  async get(key: string): Promise<FeatureFlagWithOverrides | null> {
    const raw = await this.client.get(this.prefixedKey(key));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async set(key: string, data: FeatureFlagWithOverrides, ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    await this.client.set(this.prefixedKey(key), JSON.stringify(data), 'PX', ttlMs);
  }

  async getAll(): Promise<FeatureFlagWithOverrides[] | null> {
    const raw = await this.client.get(this.prefixedKey('__all__'));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async setAll(data: FeatureFlagWithOverrides[], ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    await this.client.set(this.prefixedKey('__all__'), JSON.stringify(data), 'PX', ttlMs);
  }

  async invalidate(key?: string): Promise<void> {
    if (key) {
      await this.client.del(this.prefixedKey(key));
      await this.client.del(this.prefixedKey('__all__'));
      await this.client.publish(this.channel, key);
    } else {
      await this.flushLocal();
      await this.client.publish(this.channel, '__all__');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.unsubscribe(this.channel);
    if (this.ownsSubscriber) {
      await this.subscriber.quit();
    }
  }

  private prefixedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async flushLocal(): Promise<void> {
    const pattern = `${this.keyPrefix}*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }
}
