import { EvaluationContext } from './interfaces/evaluation-context.interface';
import {
  BooleanEvaluationDetails,
  EvaluationReason,
} from './interfaces/evaluation-details.interface';
import { TargetingAttributes } from './interfaces/feature-flag.interface';
import { FeatureFlagService } from './services/feature-flag.service';
import { isTargetingAttributeValue } from './utils/targeting-attributes';

export interface OpenFeatureBooleanProviderOptions {
  name?: string;
}

export interface OpenFeatureEvaluationContext {
  targetingKey?: unknown;
  userId?: unknown;
  tenantId?: unknown;
  environment?: unknown;
  [key: string]: unknown;
}

export interface OpenFeatureBooleanResolutionDetails {
  value: boolean;
  reason: string;
  variant?: string;
  errorCode?: string;
  errorMessage?: string;
  flagMetadata: Record<string, unknown>;
}

export interface OpenFeatureBooleanProvider {
  metadata: { name: string };
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: OpenFeatureEvaluationContext,
  ): Promise<OpenFeatureBooleanResolutionDetails>;
}

export function createOpenFeatureBooleanProvider(
  service: FeatureFlagService,
  options: OpenFeatureBooleanProviderOptions = {},
): OpenFeatureBooleanProvider {
  return {
    metadata: {
      name: options.name ?? '@nestarc/feature-flag',
    },
    resolveBooleanEvaluation: async (flagKey, defaultValue, context) => {
      try {
        const details = await service.evaluateBoolean(
          flagKey,
          toEvaluationContext(context),
          { defaultValue },
        );
        return toOpenFeatureResolution(details);
      } catch (error) {
        return {
          value: defaultValue,
          reason: 'ERROR',
          errorCode: error instanceof Error ? error.constructor.name : 'Error',
          errorMessage: error instanceof Error ? error.message : String(error),
          flagMetadata: {
            source: 'default',
            localReason: 'ERROR',
            defaultUsed: true,
          },
        };
      }
    },
  };
}

function toEvaluationContext(context: OpenFeatureEvaluationContext): EvaluationContext {
  const attributes: TargetingAttributes = {};

  for (const [key, value] of Object.entries(context)) {
    if (isKnownContextKey(key)) {
      continue;
    }

    if (isTargetingAttributeValue(value)) {
      attributes[key] = value;
    }
  }

  return {
    targetingKey: readString(context.targetingKey),
    userId: readString(context.userId),
    tenantId: readString(context.tenantId),
    environment: readString(context.environment) ?? undefined,
    attributes,
  };
}

function toOpenFeatureResolution(
  details: BooleanEvaluationDetails,
): OpenFeatureBooleanResolutionDetails {
  return {
    value: details.value,
    reason: mapOpenFeatureReason(details.reason),
    errorCode: details.errorCode,
    errorMessage: details.errorMessage,
    flagMetadata: {
      source: details.source,
      localReason: details.reason,
      defaultUsed: details.defaultUsed,
      matchedOverrideId: details.matchedOverrideId,
      bucket: details.bucket,
      targetingKey: details.targetingKey,
      evaluationTimeMs: details.evaluationTimeMs,
    },
  };
}

function mapOpenFeatureReason(reason: EvaluationReason): string {
  switch (reason) {
    case 'OVERRIDE_MATCH':
      return 'TARGETING_MATCH';
    case 'PERCENTAGE_MATCH':
    case 'PERCENTAGE_MISS':
      return 'SPLIT';
    case 'FLAG_NOT_FOUND':
    case 'PERCENTAGE_NO_TARGETING_KEY':
      return 'DEFAULT';
    case 'ERROR':
      return 'ERROR';
    case 'ARCHIVED':
      return 'DISABLED';
    case 'GLOBAL':
      return 'STATIC';
  }
}

function isKnownContextKey(key: string): boolean {
  return (
    key === 'targetingKey' ||
    key === 'userId' ||
    key === 'tenantId' ||
    key === 'environment'
  );
}

function readString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
