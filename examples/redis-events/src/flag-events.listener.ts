import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagEvents, FlagEvaluatedEvent } from '@nestarc/feature-flag';

@Injectable()
export class FlagEventsListener {
  private readonly logger = new Logger(FlagEventsListener.name);

  @OnEvent(FeatureFlagEvents.EVALUATED)
  onEvaluated(event: FlagEvaluatedEvent): void {
    this.logger.log({
      flagKey: event.flagKey,
      result: event.result,
      source: event.source,
      evaluationTimeMs: event.evaluationTimeMs,
    });
  }
}
