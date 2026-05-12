import {
  TargetingAttributes,
  TargetingAttributeValue,
} from '../interfaces/feature-flag.interface';

interface AttributeValidationOptions {
  allowEmpty: boolean;
}

const INVALID_ATTRIBUTES_MESSAGE =
  'attributes must be a non-empty object with string, number, boolean, or null values';

export function isTargetingAttributeValue(value: unknown): value is TargetingAttributeValue {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  );
}

export function isTargetingAttributes(
  value: unknown,
  options: AttributeValidationOptions = { allowEmpty: false },
): value is TargetingAttributes {
  if (!isPlainObject(value)) {
    return false;
  }

  const entries = Object.entries(value);
  if (!options.allowEmpty && entries.length === 0) {
    return false;
  }

  return entries.every(([, attributeValue]) => isTargetingAttributeValue(attributeValue));
}

export function normalizeTargetingAttributes(
  value: unknown,
  options: AttributeValidationOptions = { allowEmpty: false },
): TargetingAttributes {
  if (!isTargetingAttributes(value, options)) {
    throw new Error(INVALID_ATTRIBUTES_MESSAGE);
  }

  return { ...value };
}

export function matchesTargetingAttributes(
  overrideAttributes: TargetingAttributes,
  contextAttributes: TargetingAttributes,
): boolean {
  const entries = Object.entries(overrideAttributes);
  if (entries.length === 0) {
    return false;
  }

  return entries.every(([key, value]) => contextAttributes[key] === value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
