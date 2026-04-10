import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  FeatureFlagRepository,
  OverrideCriteria,
} from '../interfaces/feature-flag-repository.interface';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as any).code === code
  );
}

@Injectable()
export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly prisma: any) {}

  async createFlag(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    const percentage = input.percentage ?? 0;
    if (percentage < 0 || percentage > 100) {
      throw new BadRequestException(`percentage must be between 0 and 100, got ${percentage}`);
    }

    try {
      return await this.prisma.featureFlag.create({
        data: {
          key: input.key,
          description: input.description,
          enabled: input.enabled ?? false,
          percentage,
          metadata: input.metadata ?? {},
        },
        include: { overrides: true },
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException(`Feature flag "${input.key}" already exists`);
      }
      throw error;
    }
  }

  async updateFlag(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    if (input.percentage !== undefined && (input.percentage < 0 || input.percentage > 100)) {
      throw new BadRequestException(`percentage must be between 0 and 100, got ${input.percentage}`);
    }

    try {
      return await this.prisma.featureFlag.update({
        where: { key },
        data: {
          ...(input.description !== undefined && { description: input.description }),
          ...(input.enabled !== undefined && { enabled: input.enabled }),
          ...(input.percentage !== undefined && { percentage: input.percentage }),
          ...(input.metadata !== undefined && { metadata: input.metadata }),
        },
        include: { overrides: true },
      });
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException(`Feature flag "${key}" not found`);
      }
      throw error;
    }
  }

  async archiveFlag(key: string): Promise<FeatureFlagWithOverrides> {
    try {
      return await this.prisma.featureFlag.update({
        where: { key },
        data: { archivedAt: new Date() },
        include: { overrides: true },
      });
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException(`Feature flag "${key}" not found`);
      }
      throw error;
    }
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
    try {
      await this.prisma.featureFlagOverride.create({
        data: { flagId, ...criteria, enabled },
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        // Concurrent insert hit the unique index — fall back to update
        const existing = await this.prisma.featureFlagOverride.findFirst({
          where: { flagId, ...criteria },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.featureFlagOverride.update({
            where: { id: existing.id },
            data: { enabled },
          });
          return;
        }
      }
      throw error;
    }
  }

  async updateOverrideEnabled(id: string, enabled: boolean): Promise<void> {
    await this.prisma.featureFlagOverride.update({
      where: { id },
      data: { enabled },
    });
  }

  async deleteOverride(id: string): Promise<void> {
    try {
      await this.prisma.featureFlagOverride.delete({ where: { id } });
    } catch (error) {
      if (isPrismaError(error, 'P2025')) {
        // Already deleted by a concurrent request — idempotent
        return;
      }
      throw error;
    }
  }
}
