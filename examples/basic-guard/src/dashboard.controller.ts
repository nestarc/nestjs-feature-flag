import { Controller, Get } from '@nestjs/common';
import { FLAG_KEY } from './flag-key';
import { FeatureFlag } from '@nestarc/feature-flag';

@Controller('dashboard')
export class DashboardController {
  @FeatureFlag(FLAG_KEY)
  @Get()
  getDashboard() {
    return { message: 'New dashboard is enabled' };
  }
}
