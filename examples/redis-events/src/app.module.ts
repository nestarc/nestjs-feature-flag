import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { FeatureFlagModule } from '@nestarc/feature-flag';
import { FlagEventsListener } from './flag-events.listener';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';
import { RedisCacheProvider } from './redis-cache.provider';
import { RedisModule } from './redis.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
    FeatureFlagModule.forRootAsync({
      imports: [PrismaModule, RedisModule],
      inject: [PrismaService, RedisCacheProvider],
      useFactory: (prisma: PrismaService, redisCache: RedisCacheProvider) => ({
        prisma,
        environment: process.env.NODE_ENV ?? 'production',
        emitEvents: true,
        cacheAdapter: redisCache.adapter,
      }),
    }),
  ],
  providers: [FlagEventsListener],
})
export class AppModule {}
