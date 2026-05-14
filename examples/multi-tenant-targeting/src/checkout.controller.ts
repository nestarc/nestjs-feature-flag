import { Controller, Get, Headers } from '@nestjs/common';
import { FeatureFlagService } from '@nestarc/feature-flag';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly flags: FeatureFlagService) {}

  @Get()
  async getCheckout(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-user-id') userId: string,
    @Headers('x-country') country: string,
    @Headers('x-plan') plan: string,
  ) {
    const enabled = await this.flags.isEnabled('NEW_CHECKOUT', {
      userId,
      tenantId,
      attributes: {
        country,
        plan,
      },
    });

    return { version: enabled ? 'new' : 'classic' };
  }
}
