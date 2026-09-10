import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagEvents, FlagEvaluatedEvent, FlagMutationEvent } from '@nestarc/feature-flag';

@Injectable()
export class FlagEventsListener {
  private readonly logger = new Logger(FlagEventsListener.name);
  private evaluated = 0;
  private updated = 0;

  @OnEvent(FeatureFlagEvents.EVALUATED)
  onEvaluated(event: FlagEvaluatedEvent): void {
    this.evaluated += 1;
    this.logger.log({
      event: FeatureFlagEvents.EVALUATED,
      flagKey: event.flagKey,
      result: event.result,
      source: event.source,
    });
  }

  @OnEvent(FeatureFlagEvents.UPDATED)
  onUpdated(event: FlagMutationEvent): void {
    this.updated += 1;
    this.logger.log({ event: FeatureFlagEvents.UPDATED, flagKey: event.flagKey });
  }

  snapshot() {
    return { evaluated: this.evaluated, updated: this.updated };
  }
}
