import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { FeatureFlagModule, RedisCacheAdapter } from '@nestarc/feature-flag';
import { Redis } from 'ioredis';
import { FlagEventsListener } from './flag-events.listener';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    FeatureFlagModule.forRootAsync({
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

        return {
          prisma,
          environment: process.env.NODE_ENV ?? 'production',
          emitEvents: true,
          cacheAdapter: new RedisCacheAdapter({ client: redis }),
        };
      },
    }),
  ],
  providers: [PrismaService, FlagEventsListener],
})
export class AppModule {}
