import { Injectable, Inject, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { FlagCacheService } from './flag-cache.service';
import { FlagEvaluatorService } from './flag-evaluator.service';
import { FlagContext } from './flag-context';
import { FeatureFlagEvents, FlagEvaluatedEvent } from '../events/feature-flag.events';

@Injectable()
export class FeatureFlagService {
  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
    @Inject('PRISMA_SERVICE') private readonly prisma: any,
    private readonly cache: FlagCacheService,
    private readonly evaluator: FlagEvaluatorService,
    private readonly flagContext: FlagContext,
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject('EVENT_EMITTER') private readonly eventEmitter?: any,
  ) {}

  async isEnabled(flagKey: string, explicitContext?: EvaluationContext): Promise<boolean> {
    const flag = await this.resolveFlag(flagKey);
    if (!flag) {
      return this.options.defaultOnMissing ?? false;
    }

    const context = this.buildContext(explicitContext);
    const startTime = Date.now();
    const { result, source } = this.evaluator.evaluate(flag, context);
    const evaluationTimeMs = Date.now() - startTime;

    if (this.options.emitEvents && this.eventEmitter) {
      const event: FlagEvaluatedEvent = {
        flagKey,
        result,
        context,
        source,
        evaluationTimeMs,
      };
      this.eventEmitter.emit(FeatureFlagEvents.EVALUATED, event);
    }

    return result;
  }

  async evaluateAll(explicitContext?: EvaluationContext): Promise<Record<string, boolean>> {
    const flags = await this.resolveAllFlags();
    const context = this.buildContext(explicitContext);
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      result[flag.key] = this.evaluator.evaluate(flag, context).result;
    }

    return result;
  }

  async create(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    const flag = await this.prisma.featureFlag.create({
      data: {
        key: input.key,
        description: input.description,
        enabled: input.enabled ?? false,
        percentage: input.percentage ?? 0,
        metadata: input.metadata ?? {},
      },
      include: { overrides: true },
    });

    this.cache.invalidate();

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.CREATED, { flagKey: input.key, action: 'created' });
    }

    return flag;
  }

  async update(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    const flag = await this.prisma.featureFlag.update({
      where: { key },
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.percentage !== undefined && { percentage: input.percentage }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
      include: { overrides: true },
    });

    this.cache.invalidate(key);

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.UPDATED, { flagKey: key, action: 'updated' });
    }

    return flag;
  }

  async archive(key: string): Promise<FeatureFlagWithOverrides> {
    const flag = await this.prisma.featureFlag.update({
      where: { key },
      data: { archivedAt: new Date() },
      include: { overrides: true },
    });

    this.cache.invalidate(key);

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.ARCHIVED, { flagKey: key, action: 'archived' });
    }

    return flag;
  }

  async setOverride(key: string, input: SetOverrideInput): Promise<void> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw new Error(`Feature flag "${key}" not found`);
    }

    await this.prisma.featureFlagOverride.upsert({
      where: {
        uq_override_context: {
          flagId: flag.id,
          tenantId: input.tenantId ?? null,
          userId: input.userId ?? null,
          environment: input.environment ?? null,
        },
      },
      update: { enabled: input.enabled },
      create: {
        flagId: flag.id,
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        environment: input.environment ?? null,
        enabled: input.enabled,
      },
    });

    this.cache.invalidate(key);

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.OVERRIDE_SET, {
        flagKey: key,
        ...input,
        action: 'set',
      });
    }
  }

  async findAll(): Promise<FeatureFlagWithOverrides[]> {
    return this.prisma.featureFlag.findMany({
      where: { archivedAt: null },
      include: { overrides: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  invalidateCache(): void {
    this.cache.invalidate();

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.CACHE_INVALIDATED, {});
    }
  }

  private async resolveFlag(key: string): Promise<FeatureFlagWithOverrides | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      include: { overrides: true },
    });

    if (flag) {
      this.cache.set(key, flag);
    }

    return flag;
  }

  private async resolveAllFlags(): Promise<FeatureFlagWithOverrides[]> {
    const cached = this.cache.getAll();
    if (cached) return cached;

    const flags = await this.prisma.featureFlag.findMany({
      where: { archivedAt: null },
      include: { overrides: true },
    });

    this.cache.setAll(flags);
    return flags;
  }

  private buildContext(explicit?: EvaluationContext): EvaluationContext {
    return {
      userId: explicit?.userId ?? this.flagContext.getUserId(),
      tenantId: explicit?.tenantId ?? this.getTenantId(),
      environment: explicit?.environment ?? this.options.environment,
    };
  }

  private getTenantId(): string | null {
    try {
      const { TenancyService } = require('@nestarc/tenancy');
      const tenancyService = this.moduleRef.get(TenancyService, { strict: false });
      return tenancyService?.getCurrentTenant() ?? null;
    } catch {
      return null;
    }
  }
}
