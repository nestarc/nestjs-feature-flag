import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS, CACHE_ADAPTER, FEATURE_FLAG_REPOSITORY } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  RemoveOverrideInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { CacheAdapter } from '../interfaces/cache-adapter.interface';
import { FeatureFlagRepository } from '../interfaces/feature-flag-repository.interface';
import { FlagEvaluatorService } from './flag-evaluator.service';
import { FlagContextResolver } from './flag-context-resolver';
import { FlagEventPublisher } from './flag-event-publisher';
import { FeatureFlagEvents, FlagEvaluatedEvent } from '../events/feature-flag.events';

const CACHE_INVALIDATION_FAILED = 'feature-flag.cache.invalidation-failed';

@Injectable()
export class FeatureFlagService {
  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly repository: FeatureFlagRepository,
    @Inject(CACHE_ADAPTER) private readonly cacheAdapter: CacheAdapter,
    private readonly evaluator: FlagEvaluatorService,
    private readonly contextResolver: FlagContextResolver,
    private readonly eventPublisher: FlagEventPublisher,
  ) {}

  private get cacheTtlMs(): number {
    return this.options.cacheTtlMs ?? 30_000;
  }

  async isEnabled(flagKey: string, explicitContext?: EvaluationContext): Promise<boolean> {
    const flag = await this.resolveFlag(flagKey);
    if (!flag) {
      return this.options.defaultOnMissing ?? false;
    }

    const context = this.contextResolver.resolve(explicitContext);
    const startTime = Date.now();
    const { result, source } = this.evaluator.evaluate(flag, context);
    const evaluationTimeMs = Date.now() - startTime;

    this.eventPublisher.emit(FeatureFlagEvents.EVALUATED, {
      flagKey,
      result,
      context,
      source,
      evaluationTimeMs,
    } satisfies FlagEvaluatedEvent);

    return result;
  }

  async evaluateAll(explicitContext?: EvaluationContext): Promise<Record<string, boolean>> {
    const flags = await this.resolveAllFlags();
    const context = this.contextResolver.resolve(explicitContext);
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      result[flag.key] = this.evaluator.evaluate(flag, context).result;
    }

    return result;
  }

  async create(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    const flag = await this.repository.createFlag(input);
    await this.safeInvalidateCache();
    this.eventPublisher.emit(FeatureFlagEvents.CREATED, { flagKey: input.key, action: 'created' });
    return flag;
  }

  async update(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    const flag = await this.repository.updateFlag(key, input);
    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.UPDATED, { flagKey: key, action: 'updated' });
    return flag;
  }

  async archive(key: string): Promise<FeatureFlagWithOverrides> {
    const flag = await this.repository.archiveFlag(key);
    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.ARCHIVED, { flagKey: key, action: 'archived' });
    return flag;
  }

  async setOverride(key: string, input: SetOverrideInput): Promise<void> {
    const flagId = await this.repository.findFlagIdByKey(key);
    if (!flagId) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    const criteria = {
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      environment: input.environment ?? null,
    };

    const existing = await this.repository.findOverride(flagId, criteria);
    if (existing) {
      await this.repository.updateOverrideEnabled(existing.id, input.enabled);
    } else {
      await this.repository.createOverride(flagId, criteria, input.enabled);
    }

    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.OVERRIDE_SET, {
      flagKey: key,
      ...input,
      action: 'set',
    });
  }

  async findAll(): Promise<FeatureFlagWithOverrides[]> {
    return this.repository.findAllActiveFlags();
  }

  async invalidateCache(): Promise<void> {
    await this.cacheAdapter.invalidate();
    this.eventPublisher.emit(FeatureFlagEvents.CACHE_INVALIDATED, {});
  }

  async findByKey(key: string): Promise<FeatureFlagWithOverrides> {
    const flag = await this.repository.findFlagByKey(key);
    if (!flag) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }
    return flag;
  }

  async removeOverride(key: string, input: RemoveOverrideInput): Promise<void> {
    const flagId = await this.repository.findFlagIdByKey(key);
    if (!flagId) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    const criteria = {
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      environment: input.environment ?? null,
    };

    const existing = await this.repository.findOverride(flagId, criteria);
    if (existing) {
      await this.repository.deleteOverride(existing.id);
    }

    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.OVERRIDE_REMOVED, {
      flagKey: key,
      ...input,
      action: 'removed',
    });
  }

  /**
   * Best-effort cache invalidation for mutation paths.
   * DB write already succeeded — cache failure should not fail the caller.
   * Stale entries self-heal via TTL (default 30s).
   */
  private async safeInvalidateCache(key?: string): Promise<void> {
    try {
      await this.cacheAdapter.invalidate(key);
    } catch (error) {
      this.eventPublisher.emit(CACHE_INVALIDATION_FAILED, {
        key: key ?? '__all__',
        error: String(error),
      });
    }
  }

  private async resolveFlag(key: string): Promise<FeatureFlagWithOverrides | null> {
    const cached = await this.cacheAdapter.get(key);
    if (cached) return cached;

    const flag = await this.repository.findFlagByKey(key);
    if (flag) {
      await this.cacheAdapter.set(key, flag, this.cacheTtlMs);
    }

    return flag;
  }

  private async resolveAllFlags(): Promise<FeatureFlagWithOverrides[]> {
    const cached = await this.cacheAdapter.getAll();
    if (cached) return cached;

    const flags = await this.repository.findAllActiveFlags();
    await this.cacheAdapter.setAll(flags, this.cacheTtlMs);
    return flags;
  }
}
