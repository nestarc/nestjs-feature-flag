import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface FlagStore {
  userId: string | null;
}

@Injectable()
export class FlagContext {
  private static readonly storage = new AsyncLocalStorage<FlagStore>();

  run<T>(store: FlagStore, callback: () => T): T {
    return FlagContext.storage.run(store, callback);
  }

  getUserId(): string | null {
    return FlagContext.storage.getStore()?.userId ?? null;
  }
}
