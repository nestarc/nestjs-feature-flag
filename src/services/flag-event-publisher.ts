import { Injectable, Inject, Optional } from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';

@Injectable()
export class FlagEventPublisher {
  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
    @Optional() @Inject('EVENT_EMITTER') private readonly eventEmitter?: any,
  ) {}

  emit(event: string, payload: Record<string, unknown>): void {
    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(event, payload);
    }
  }
}
