import { Module } from '@nestjs/common';
import { FeatureFlagModule } from '@nestarc/feature-flag';
import { CheckoutController } from './checkout.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        prisma,
        environment: process.env.NODE_ENV ?? 'development',
        userIdExtractor: (req) => req.headers['x-user-id'] as string | undefined,
      }),
    }),
  ],
  controllers: [CheckoutController],
  providers: [PrismaService],
})
export class AppModule {}
