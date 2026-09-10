import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS, CACHE_ADAPTER, FEATURE_FLAG_REPOSITORY } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  RemoveOverrideInput,
  FeatureFlagWithOverrides,
  FlagMutationMetadata,
} from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { CacheAdapter } from '../interfaces/cache-adapter.interface';
import { FeatureFlagRepository } from '../interfaces/feature-flag-repository.interface';
import { FlagEvaluatorService } from './flag-evaluator.service';
import { FlagContextResolver } from './flag-context-resolver';
import { FlagEventPublisher } from './flag-event-publisher';
import {
  FeatureFlagEvents,
  FlagEvaluatedEvent,
  FlagExposedEvent,
} from '../events/feature-flag.events';
import { normalizeTargetingAttributes } from '../utils/targeting-attributes';
import {
  BooleanEvaluationDetails,
  EvaluateBooleanOptions,
  EvaluationReason,
} from '../interfaces/evaluation-details.interface';

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

  async isEnabled(
    flagKey: string,
    explicitContext?: EvaluationContext,
    evaluationOptions: EvaluateBooleanOptions = {},
  ): Promise<boolean> {
    return (await this.evaluateBoolean(flagKey, explicitContext, evaluationOptions)).value;
  }

  async evaluateBoolean(
    flagKey: string,
    explicitContext?: EvaluationContext,
    evaluationOptions: EvaluateBooleanOptions = {},
  ): Promise<BooleanEvaluationDetails> {
    const startTime = Date.now();
    let context: EvaluationContext = {};

    try {
      context = this.contextResolver.resolve(explicitContext);
      const flag = await this.resolveFlag(flagKey);
      const registryDefinition = this.options.flags?.[flagKey];
      const details = flag
        ? {
            ...this.evaluator.evaluate(flag, context, {
              bucketBy: evaluationOptions.bucketBy ?? registryDefinition?.bucketBy,
            }),
            evaluationTimeMs: Date.now() - startTime,
          }
        : this.defaultDetails(flagKey, 'FLAG_NOT_FOUND', startTime, evaluationOptions);

      this.emitEvaluation(details, context, evaluationOptions);
      if (this.shouldTrackExposure(flagKey, flag, evaluationOptions)) {
        this.emitExposure(details, context, evaluationOptions);
      }

      return details;
    } catch (error) {
      const details = this.defaultDetails(
        flagKey,
        'ERROR',
        startTime,
        evaluationOptions,
        error,
      );
      this.emitEvaluation(details, context, evaluationOptions);
      if (this.shouldTrackExposure(flagKey, null, evaluationOptions)) {
        this.emitExposure(details, context, evaluationOptions);
      }
      return details;
    }
  }

  async evaluateAll(explicitContext?: EvaluationContext): Promise<Record<string, boolean>> {
    const flags = await this.resolveAllFlags();
    const context = this.contextResolver.resolve(explicitContext);
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      result[flag.key] = this.evaluator.evaluate(flag, context, {
        bucketBy: this.options.flags?.[flag.key]?.bucketBy,
      }).result;
    }

    return result;
  }

  async create(
    input: CreateFeatureFlagInput,
    metadata: FlagMutationMetadata = {},
  ): Promise<FeatureFlagWithOverrides> {
    const flag = await this.repository.createFlag(input);
    await this.safeInvalidateCache();
    this.eventPublisher.emit(FeatureFlagEvents.CREATED, {
      flagKey: input.key,
      action: 'created',
      ...metadata,
    });
    return flag;
  }

  async update(
    key: string,
    input: UpdateFeatureFlagInput,
    metadata: FlagMutationMetadata = {},
  ): Promise<FeatureFlagWithOverrides> {
    const flag = await this.repository.updateFlag(key, input);
    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.UPDATED, {
      flagKey: key,
      action: 'updated',
      ...metadata,
    });
    return flag;
  }

  async archive(
    key: string,
    metadata: FlagMutationMetadata = {},
  ): Promise<FeatureFlagWithOverrides> {
    const flag = await this.repository.archiveFlag(key);
    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.ARCHIVED, {
      flagKey: key,
      action: 'archived',
      ...metadata,
    });
    return flag;
  }

  async setOverride(
    key: string,
    input: SetOverrideInput,
    metadata: FlagMutationMetadata = {},
  ): Promise<void> {
    const attributes = this.normalizeOverrideAttributes(input.attributes);
    const priority = input.priority ?? 0;

    const flagId = await this.repository.findFlagIdByKey(key);
    if (!flagId) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    const criteria = { attributes };
    const existing = await this.repository.findOverride(flagId, criteria);
    if (existing) {
      await this.repository.updateOverride(existing.id, {
        enabled: input.enabled,
        priority,
      });
    } else {
      await this.repository.createOverride(flagId, criteria, input.enabled, priority);
    }

    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.OVERRIDE_SET, {
      flagKey: key,
      attributes,
      enabled: input.enabled,
      priority,
      action: 'set',
      ...metadata,
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

  async removeOverride(
    key: string,
    input: RemoveOverrideInput,
    metadata: FlagMutationMetadata = {},
  ): Promise<void> {
    const attributes = this.normalizeOverrideAttributes(input.attributes);

    const flagId = await this.repository.findFlagIdByKey(key);
    if (!flagId) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    const criteria = { attributes };
    const existing = await this.repository.findOverride(flagId, criteria);
    if (existing) {
      await this.repository.deleteOverride(existing.id);
    }

    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.OVERRIDE_REMOVED, {
      flagKey: key,
      attributes,
      action: 'removed',
      ...metadata,
    });
  }

  private normalizeOverrideAttributes(input: unknown) {
    try {
      return normalizeTargetingAttributes(input, { allowEmpty: false });
    } catch (error) {
      throw new BadRequestException(String(error instanceof Error ? error.message : error));
    }
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

  private defaultDetails(
    flagKey: string,
    reason: Extract<EvaluationReason, 'FLAG_NOT_FOUND' | 'ERROR'>,
    startTime: number,
    evaluationOptions: EvaluateBooleanOptions,
    error?: unknown,
  ): BooleanEvaluationDetails {
    const defaultValue = this.resolveDefaultValue(flagKey, evaluationOptions);
    const details: BooleanEvaluationDetails = {
      flagKey,
      value: defaultValue,
      result: defaultValue,
      source: 'default',
      reason,
      defaultUsed: true,
      evaluationTimeMs: Date.now() - startTime,
    };

    if (error) {
      details.errorCode = error instanceof Error ? error.constructor.name : 'Error';
      details.errorMessage = error instanceof Error ? error.message : String(error);
    }

    return details;
  }

  private resolveDefaultValue(
    flagKey: string,
    evaluationOptions: EvaluateBooleanOptions,
  ): boolean {
    return (
      evaluationOptions.defaultValue ??
      this.options.flags?.[flagKey]?.defaultValue ??
      this.options.defaultOnMissing ??
      false
    );
  }

  private shouldTrackExposure(
    flagKey: string,
    flag: FeatureFlagWithOverrides | null,
    evaluationOptions: EvaluateBooleanOptions,
  ): boolean {
    return (
      evaluationOptions.trackExposure ??
      this.options.flags?.[flagKey]?.trackExposure ??
      readBooleanMetadata(flag?.metadata, 'trackExposure') ??
      false
    );
  }

  private emitEvaluation(
    details: BooleanEvaluationDetails,
    context: EvaluationContext,
    evaluationOptions: EvaluateBooleanOptions,
  ): void {
    const event: FlagEvaluatedEvent = {
      ...details,
      evaluationTimeMs: details.evaluationTimeMs ?? 0,
    };

    if (evaluationOptions.includeContextInEvent ?? true) {
      event.context = context;
    }

    this.eventPublisher.emit(
      FeatureFlagEvents.EVALUATED,
      event as unknown as Record<string, unknown>,
    );
  }

  private emitExposure(
    details: BooleanEvaluationDetails,
    context: EvaluationContext,
    evaluationOptions: EvaluateBooleanOptions,
  ): void {
    const event: FlagExposedEvent = { ...details };
    if (evaluationOptions.includeContextInEvent === true) {
      event.context = context;
    }

    this.eventPublisher.emit(
      FeatureFlagEvents.EXPOSED,
      event as unknown as Record<string, unknown>,
    );
  }
}

function readBooleanMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === 'boolean' ? value : undefined;
}
