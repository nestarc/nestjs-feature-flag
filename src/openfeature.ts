import type {
  ErrorCode,
  FlagMetadata,
  Provider,
  ResolutionDetails,
} from '@openfeature/server-sdk';
import type { EvaluationContext } from './interfaces/evaluation-context.interface';
import {
  BooleanEvaluationDetails,
  EvaluationReason,
} from './interfaces/evaluation-details.interface';
import { TargetingAttributes } from './interfaces/feature-flag.interface';
import type { FeatureFlagService } from './services/feature-flag.service';
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

export interface OpenFeatureBooleanResolutionDetails extends ResolutionDetails<boolean> {
  reason: string;
  flagMetadata: FlagMetadata;
}

export interface OpenFeatureBooleanProvider extends Provider {
  metadata: { name: string };
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: OpenFeatureEvaluationContext,
  ): Promise<OpenFeatureBooleanResolutionDetails>;
}

export function createOpenFeatureBooleanProvider(
  service: Pick<FeatureFlagService, 'evaluateBoolean'>,
  options: OpenFeatureBooleanProviderOptions = {},
): OpenFeatureBooleanProvider {
  return {
    runsOn: 'server',
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
          errorCode: errorCodes.GENERAL,
          errorMessage: error instanceof Error ? error.message : String(error),
          flagMetadata: {
            source: 'default',
            localReason: 'ERROR',
            defaultUsed: true,
            localErrorCode: error instanceof Error ? error.constructor.name : 'Error',
          },
        };
      }
    },
    resolveStringEvaluation: async (_flagKey, defaultValue) =>
      unsupportedType(defaultValue),
    resolveNumberEvaluation: async (_flagKey, defaultValue) =>
      unsupportedType(defaultValue),
    resolveObjectEvaluation: async (_flagKey, defaultValue) =>
      unsupportedType(defaultValue),
  };
}

// Keep the SDK optional at runtime. Its string enum values are verified by the
// SDK integration tests; importing the enum as a value would load the SDK.
const errorCodes = {
  GENERAL: 'GENERAL' as ErrorCode.GENERAL,
  FLAG_NOT_FOUND: 'FLAG_NOT_FOUND' as ErrorCode.FLAG_NOT_FOUND,
  TYPE_MISMATCH: 'TYPE_MISMATCH' as ErrorCode.TYPE_MISMATCH,
};

function unsupportedType<T>(defaultValue: T): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: 'ERROR',
    errorCode: errorCodes.TYPE_MISMATCH,
    errorMessage: '@nestarc/feature-flag supports boolean flags only',
    flagMetadata: { source: 'default', defaultUsed: true },
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
    environment: readString(context.environment),
    attributes,
  };
}

function toOpenFeatureResolution(
  details: BooleanEvaluationDetails,
): OpenFeatureBooleanResolutionDetails {
  return {
    value: details.value,
    reason: mapOpenFeatureReason(details.reason),
    errorCode:
      details.reason === 'FLAG_NOT_FOUND'
        ? errorCodes.FLAG_NOT_FOUND
        : details.reason === 'ERROR'
          ? errorCodes.GENERAL
          : undefined,
    errorMessage: details.errorMessage,
    flagMetadata: {
      source: details.source,
      localReason: details.reason,
      defaultUsed: details.defaultUsed,
      ...(details.matchedOverrideId !== undefined && {
        matchedOverrideId: details.matchedOverrideId,
      }),
      ...(details.bucket !== undefined && { bucket: details.bucket }),
      ...(details.targetingKey !== undefined && { targetingKey: details.targetingKey }),
      ...(details.evaluationTimeMs !== undefined && {
        evaluationTimeMs: details.evaluationTimeMs,
      }),
      ...(details.errorCode !== undefined && { localErrorCode: details.errorCode }),
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
    case 'PERCENTAGE_NO_TARGETING_KEY':
      return 'DEFAULT';
    case 'FLAG_NOT_FOUND':
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
