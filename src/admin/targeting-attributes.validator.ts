import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isTargetingAttributes } from '../utils/targeting-attributes';

@ValidatorConstraint({ name: 'isTargetingAttributes', async: false })
export class IsTargetingAttributesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isTargetingAttributes(value, { allowEmpty: false });
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'attributes must be a non-empty object with string, number, boolean, or null values';
  }
}

export function IsTargetingAttributes(validationOptions?: ValidationOptions) {
  return function registerTargetingAttributesDecorator(target: object, propertyName: string): void {
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsTargetingAttributesConstraint,
    });
  };
}
