import { Injectable } from '@nestjs/common';
import {
  FeatureFlagRepository,
  OverrideCriteria,
} from '../interfaces/feature-flag-repository.interface';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';

@Injectable()
export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly prisma: any) {}

  async createFlag(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    return this.prisma.featureFlag.create({
      data: {
        key: input.key,
        description: input.description,
        enabled: input.enabled ?? false,
        percentage: input.percentage ?? 0,
        metadata: input.metadata ?? {},
      },
      include: { overrides: true },
    });
  }

  async updateFlag(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    return this.prisma.featureFlag.update({
      where: { key },
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.percentage !== undefined && { percentage: input.percentage }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
      include: { overrides: true },
    });
  }

  async archiveFlag(key: string): Promise<FeatureFlagWithOverrides> {
    return this.prisma.featureFlag.update({
      where: { key },
      data: { archivedAt: new Date() },
      include: { overrides: true },
    });
  }

  async findFlagByKey(key: string): Promise<FeatureFlagWithOverrides | null> {
    return this.prisma.featureFlag.findUnique({
      where: { key },
      include: { overrides: true },
    });
  }

  async findFlagIdByKey(key: string): Promise<string | null> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    return flag?.id ?? null;
  }

  async findAllActiveFlags(): Promise<FeatureFlagWithOverrides[]> {
    return this.prisma.featureFlag.findMany({
      where: { archivedAt: null },
      include: { overrides: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOverride(flagId: string, criteria: OverrideCriteria): Promise<{ id: string } | null> {
    return this.prisma.featureFlagOverride.findFirst({
      where: { flagId, ...criteria },
      select: { id: true },
    });
  }

  async createOverride(flagId: string, criteria: OverrideCriteria, enabled: boolean): Promise<void> {
    await this.prisma.featureFlagOverride.create({
      data: { flagId, ...criteria, enabled },
    });
  }

  async updateOverrideEnabled(id: string, enabled: boolean): Promise<void> {
    await this.prisma.featureFlagOverride.update({
      where: { id },
      data: { enabled },
    });
  }

  async deleteOverride(id: string): Promise<void> {
    await this.prisma.featureFlagOverride.delete({ where: { id } });
  }
}
