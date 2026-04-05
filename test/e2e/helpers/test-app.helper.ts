import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FeatureFlagModule } from '../../../src/feature-flag.module';
import { FeatureFlag } from '../../../src/decorators/feature-flag.decorator';
import { BypassFeatureFlag } from '../../../src/decorators/bypass-feature-flag.decorator';
import { getPrisma } from './prisma-test.helper';

@Controller('test')
class TestController {
  @FeatureFlag('GATED_ENDPOINT')
  @Get('gated')
  gated() {
    return { message: 'behind feature flag' };
  }

  @FeatureFlag('PREMIUM', { statusCode: 402, fallback: { message: 'Upgrade required' } })
  @Get('premium')
  premium() {
    return { message: 'premium content' };
  }

  @BypassFeatureFlag()
  @FeatureFlag('SOME_FLAG')
  @Get('bypassed')
  bypassed() {
    return { message: 'always accessible' };
  }

  @Get('open')
  open() {
    return { message: 'no guard' };
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [
      FeatureFlagModule.forRoot({
        environment: 'test',
        prisma: getPrisma(),
        cacheTtlMs: 0,
        userIdExtractor: (req) => (req.headers['x-user-id'] as string) ?? null,
      }),
    ],
    controllers: [TestController],
  }).compile();

  const app = module.createNestApplication();
  await app.init();
  return app;
}
