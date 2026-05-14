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
        userIdExtractor: (req) => {
          const userId = req.headers['x-user-id'];
          return Array.isArray(userId) ? userId[0] ?? null : userId ?? null;
        },
      }),
    }),
  ],
  controllers: [DashboardController],
})
export class AppModule {}
