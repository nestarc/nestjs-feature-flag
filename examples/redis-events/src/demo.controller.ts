import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { FeatureFlagService } from '@nestarc/feature-flag';
import { FLAG_KEY } from './flag-key';
import { FlagEventsListener } from './flag-events.listener';

// main.ts binds this demo to localhost and rejects production mode.
// A real application must use its own authentication and authorization policy.
@Controller('demo')
export class DemoController {
  constructor(
    private readonly flags: FeatureFlagService,
    private readonly events: FlagEventsListener,
  ) {}

  @Get('evaluate')
  async evaluate() {
    return {
      enabled: await this.flags.isEnabled(FLAG_KEY),
      instance: process.env.PORT ?? '3000',
    };
  }

  @Get('events')
  getEvents() {
    return this.events.snapshot();
  }

  @Post('flag')
  async update(
    @Headers('x-demo-token') token: string | undefined,
    @Body() body: { enabled?: unknown } | undefined,
  ) {
    if (!process.env.DEMO_TOKEN || token !== process.env.DEMO_TOKEN) {
      throw new UnauthorizedException('A matching x-demo-token is required');
    }
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    await this.flags.update(FLAG_KEY, { enabled: body.enabled });
    return { enabled: body.enabled };
  }
}
