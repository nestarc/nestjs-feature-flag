/**
 * Benchmark: Feature flag evaluation performance
 *
 * Measures:
 *   A) isEnabled() — cache hit (hot path)
 *   B) isEnabled() — cache miss (DB lookup)
 *   C) isEnabled() — with overrides (6-layer cascade)
 *   D) evaluateAll() — bulk evaluation of N flags
 *
 * Usage:
 *   docker compose up -d --wait
 *   dotenv -e .env.test -- npx ts-node benchmarks/evaluation-overhead.ts
 */

import { Test } from '@nestjs/testing';
import { FeatureFlagModule } from '../src/feature-flag.module';
import { FeatureFlagService } from '../src/services/feature-flag.service';
import { FlagCacheService } from '../src/services/flag-cache.service';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://test:test@localhost:5499/feature_flag_test';

const WARMUP = 30;
const ITERATIONS = 500;

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

interface BenchResult {
  label: string;
  iterations: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function analyze(label: string, timings: number[]): BenchResult {
  const sorted = [...timings].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  return {
    label,
    iterations: sorted.length,
    avgMs: Math.round((total / sorted.length) * 100) / 100,
    p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

function printResult(r: BenchResult) {
  console.log(`\n${r.label}`);
  console.log(`  Iterations: ${r.iterations}`);
  console.log(
    `  Avg: ${r.avgMs}ms | P50: ${r.p50Ms}ms | P95: ${r.p95Ms}ms | P99: ${r.p99Ms}ms`,
  );
  console.log(`  Min: ${r.minMs}ms | Max: ${r.maxMs}ms`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== @nestarc/feature-flag Benchmark ===\n');

  const prisma = new PrismaClient({
    datasources: { db: { url: DATABASE_URL } },
  });
  await prisma.$connect();

  // Create NestJS app with cache enabled (30s TTL)
  const moduleWithCache = await Test.createTestingModule({
    imports: [
      FeatureFlagModule.forRoot({
        environment: 'production',
        prisma,
        cacheTtlMs: 30_000,
      }),
    ],
  }).compile();

  const appWithCache = moduleWithCache.createNestApplication();
  await appWithCache.init();
  const serviceWithCache = moduleWithCache.get(FeatureFlagService);
  const cacheService = moduleWithCache.get(FlagCacheService);

  // Create NestJS app with cache disabled
  const moduleNoCache = await Test.createTestingModule({
    imports: [
      FeatureFlagModule.forRoot({
        environment: 'production',
        prisma,
        cacheTtlMs: 0,
      }),
    ],
  }).compile();

  const appNoCache = moduleNoCache.createNestApplication();
  await appNoCache.init();
  const serviceNoCache = moduleNoCache.get(FeatureFlagService);

  // Cleanup
  console.log('Setting up test data...');
  await prisma.featureFlagOverride.deleteMany();
  await prisma.featureFlag.deleteMany();

  // Seed: one flag with overrides
  await serviceNoCache.create({ key: 'BENCH_FLAG', enabled: true });
  await serviceNoCache.setOverride('BENCH_FLAG', {
    tenantId: 'tenant-1',
    enabled: false,
  });
  await serviceNoCache.setOverride('BENCH_FLAG', {
    userId: 'user-1',
    enabled: true,
  });
  await serviceNoCache.setOverride('BENCH_FLAG', {
    environment: 'staging',
    enabled: false,
  });

  // Seed: many flags for evaluateAll() benchmark
  const FLAG_COUNT = 50;
  for (let i = 0; i < FLAG_COUNT; i++) {
    await serviceNoCache.create({
      key: `BULK_FLAG_${i}`,
      enabled: i % 2 === 0,
      percentage: i % 5 === 0 ? 50 : 0,
    });
  }

  // ===================================================================
  // Benchmark A: isEnabled() — cache hit
  // ===================================================================
  console.log(`\nWarming up A (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await serviceWithCache.isEnabled('BENCH_FLAG');
  }

  console.log(`Running A: isEnabled() cache hit (${ITERATIONS} iterations)...`);
  const timingsA: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await serviceWithCache.isEnabled('BENCH_FLAG');
    timingsA.push(performance.now() - start);
  }

  // ===================================================================
  // Benchmark B: isEnabled() — cache miss (every call)
  // ===================================================================
  console.log(`Warming up B (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await serviceNoCache.isEnabled('BENCH_FLAG');
  }

  console.log(`Running B: isEnabled() cache miss (${ITERATIONS} iterations)...`);
  const timingsB: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await serviceNoCache.isEnabled('BENCH_FLAG');
    timingsB.push(performance.now() - start);
  }

  // ===================================================================
  // Benchmark C: isEnabled() — with override cascade (user override)
  // ===================================================================
  console.log(`Running C: isEnabled() with user override (${ITERATIONS} iterations)...`);
  const timingsC: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    cacheService.invalidate();
    const start = performance.now();
    await serviceWithCache.isEnabled('BENCH_FLAG', {
      userId: 'user-1',
      tenantId: 'tenant-1',
      environment: 'production',
    });
    timingsC.push(performance.now() - start);
  }

  // ===================================================================
  // Benchmark D: evaluateAll() — bulk (50 flags)
  // ===================================================================
  cacheService.invalidate();
  console.log(`Warming up D (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    cacheService.invalidate();
    await serviceWithCache.evaluateAll();
  }

  console.log(`Running D: evaluateAll() ${FLAG_COUNT} flags (${ITERATIONS} iterations)...`);
  const timingsD: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    // Alternate between cache hit and miss to get realistic numbers
    if (i % 10 === 0) cacheService.invalidate();
    const start = performance.now();
    await serviceWithCache.evaluateAll();
    timingsD.push(performance.now() - start);
  }

  // ===================================================================
  // Results
  // ===================================================================
  const resultA = analyze('A) isEnabled() — cache hit', timingsA);
  const resultB = analyze('B) isEnabled() — cache miss (DB lookup)', timingsB);
  const resultC = analyze('C) isEnabled() — override cascade (cold)', timingsC);
  const resultD = analyze(`D) evaluateAll() — ${FLAG_COUNT} flags (mixed cache)`, timingsD);

  const cacheSpeedup = resultB.avgMs / resultA.avgMs;

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));

  for (const r of [resultA, resultB, resultC, resultD]) {
    printResult(r);
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`Cache speedup: ${cacheSpeedup.toFixed(1)}x (hit vs miss)`);
  console.log(
    `Cache hit avg: ${resultA.avgMs}ms vs miss avg: ${resultB.avgMs}ms`,
  );
  console.log('-'.repeat(70));

  // Cleanup
  await prisma.featureFlagOverride.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.$disconnect();
  await appWithCache.close();
  await appNoCache.close();

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
