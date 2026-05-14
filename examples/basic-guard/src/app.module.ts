import { Module } from '@nestjs/common';
import { FeatureFlagModule } from '@nestarc/feature-flag';
import { DashboardController } from './dashboard.controller';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    PrismaModule,
    FeatureFlagModule.forRootAsync({
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        prisma,
        environment: process.env.NODE_ENV ?? 'development',
        userIdExtractor: (req) => req.headers['x-user-id'] as string | undefined,
      }),
    }),
  ],
  controllers: [DashboardController],
})
export class AppModule {}
