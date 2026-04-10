import { Injectable, Inject, Optional, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FEATURE_FLAG_MODULE_OPTIONS, CACHE_ADAPTER } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { CacheAdapter, RemoveOverrideInput } from '../interfaces/cache-adapter.interface';
import { FlagEvaluatorService } from './flag-evaluator.service';
import { FlagContext } from './flag-context';
import { FeatureFlagEvents, FlagEvaluatedEvent } from '../events/feature-flag.events';

@Injectable()
export class FeatureFlagService {
  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
    @Inject('PRISMA_SERVICE') private readonly prisma: any,
    @Inject(CACHE_ADAPTER) private readonly cacheAdapter: CacheAdapter,
    private readonly evaluator: FlagEvaluatorService,
    private readonly flagContext: FlagContext,
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject('EVENT_EMITTER') private readonly eventEmitter?: any,
  ) {}

  private get cacheTtlMs(): number {
    return this.options.cacheTtlMs ?? 30_000;
  }

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

    await this.cacheAdapter.invalidate();

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

    await this.cacheAdapter.invalidate(key);

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

    await this.cacheAdapter.invalidate(key);

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

    const where = {
      flagId: flag.id,
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      environment: input.environment ?? null,
    };

    const existing = await this.prisma.featureFlagOverride.findFirst({ where });

    if (existing) {
      await this.prisma.featureFlagOverride.update({
        where: { id: existing.id },
        data: { enabled: input.enabled },
      });
    } else {
      await this.prisma.featureFlagOverride.create({
        data: { ...where, enabled: input.enabled },
      });
    }

    await this.cacheAdapter.invalidate(key);

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

  async invalidateCache(): Promise<void> {
    await this.cacheAdapter.invalidate();

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.CACHE_INVALIDATED, {});
    }
  }

  async findByKey(key: string): Promise<FeatureFlagWithOverrides> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      include: { overrides: true },
    });
    if (!flag) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }
    return flag;
  }

  async removeOverride(key: string, input: RemoveOverrideInput): Promise<void> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    const where = {
      flagId: flag.id,
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      environment: input.environment ?? null,
    };

    const existing = await this.prisma.featureFlagOverride.findFirst({ where });
    if (existing) {
      await this.prisma.featureFlagOverride.delete({ where: { id: existing.id } });
    }

    await this.cacheAdapter.invalidate(key);

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.OVERRIDE_REMOVED, {
        flagKey: key,
        ...input,
        action: 'removed',
      });
    }
  }

  private async resolveFlag(key: string): Promise<FeatureFlagWithOverrides | null> {
    const cached = await this.cacheAdapter.get(key);
    if (cached) return cached;

    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      include: { overrides: true },
    });

    if (flag) {
      await this.cacheAdapter.set(key, flag, this.cacheTtlMs);
    }

    return flag;
  }

  private async resolveAllFlags(): Promise<FeatureFlagWithOverrides[]> {
    const cached = await this.cacheAdapter.getAll();
    if (cached) return cached;

    const flags = await this.prisma.featureFlag.findMany({
      where: { archivedAt: null },
      include: { overrides: true },
    });

    await this.cacheAdapter.setAll(flags, this.cacheTtlMs);
    return flags;
  }

  private buildContext(explicit?: EvaluationContext): EvaluationContext {
    return {
      userId: explicit?.userId !== undefined ? explicit.userId : this.flagContext.getUserId(),
      tenantId: explicit?.tenantId !== undefined ? explicit.tenantId : this.getTenantId(),
      environment: explicit?.environment !== undefined ? explicit.environment : this.options.environment,
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
