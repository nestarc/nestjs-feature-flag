/** Service-level measurements in an isolated PostgreSQL schema. See README.md. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { MemoryCacheAdapter } from '../src/cache/memory-cache.adapter';
import { FeatureFlagModule } from '../src/feature-flag.module';
import { FeatureFlagService } from '../src/services/feature-flag.service';

const REPOSITORY_ROOT = resolve(__dirname, '..');
const FLAG_COUNT = 50;
const CACHE_TTL_MS = 30_000;

interface BenchResult {
  label: string;
  iterations: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  rawTimingsMs: number[];
}

function readInteger(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function gitMetadata(): { gitRevision: string | null; workingTreeDirty: boolean | null } {
  try {
    const readGit = (args: string[]) =>
      execFileSync('git', args, {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    return {
      gitRevision: readGit(['rev-parse', 'HEAD']),
      workingTreeDirty: readGit(['status', '--porcelain']).length > 0,
    };
  } catch {
    return { gitRevision: null, workingTreeDirty: null };
  }
}

function analyze(label: string, rawTimingsMs: number[]): BenchResult {
  const sorted = [...rawTimingsMs].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1];
  return {
    label,
    iterations: sorted.length,
    avgMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    rawTimingsMs,
  };
}

async function measure<T>(
  label: string,
  iterations: number,
  warmup: number,
  action: () => Promise<T>,
  validate: (value: T) => void,
  prepare?: (iteration: number) => Promise<void>,
): Promise<BenchResult> {
  console.log(`Measuring ${label}: ${warmup} warmup, ${iterations} timed calls`);
  for (let i = 0; i < warmup; i++) {
    await prepare?.(i);
    validate(await action());
  }
  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    await prepare?.(i);
    const start = performance.now();
    const value = await action();
    timings.push(performance.now() - start);
    validate(value);
  }
  return analyze(label, timings);
}

function safeError(error: unknown, databaseUrl: string | undefined): string {
  let message = error instanceof Error ? error.message : String(error);
  if (databaseUrl) {
    message = message.split(databaseUrl).join('[DATABASE_URL]');
    try {
      const parsed = new URL(databaseUrl);
      for (const credential of [parsed.username, parsed.password]) {
        if (credential) {
          message = message.split(credential).join('[redacted]');
          message = message.split(decodeURIComponent(credential)).join('[redacted]');
        }
      }
    } catch {
      // The connection string itself has already been redacted.
    }
  }
  return message;
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log(`Usage: DATABASE_URL=postgresql://... npm run bench

Creates a UUID schema, applies the checked-in migrations there, measures the
service, then drops only that schema and closes its clients, including on failure.

BENCH_ITERATIONS  Timed calls per scenario; a multiple of 10 >= 10 (default 500).
BENCH_WARMUP      Untimed calls per scenario; integer >= 0 (default 30).
BENCH_OUTPUT      Optional new JSON file for metadata, summaries and raw timings.

See benchmarks/README.md for setup, scenarios and interpretation.`);
    return;
  }
  if (process.argv.length > 2) throw new Error('Unknown argument. Use --help for usage.');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required. See benchmarks/README.md.');
  const iterations = readInteger('BENCH_ITERATIONS', 500, 10);
  if (iterations % 10 !== 0) throw new Error('BENCH_ITERATIONS must be a multiple of 10');
  const warmup = readInteger('BENCH_WARMUP', 30, 0);
  const outputPath = process.env.BENCH_OUTPUT;
  if (outputPath !== undefined && outputPath.trim().length === 0) {
    throw new Error('BENCH_OUTPUT must be a non-empty file path when supplied');
  }

  const schema = `feature_flag_bench_${randomUUID().replace(/-/g, '')}`;
  const quotedSchema = `"${schema}"`;
  const startedAt = new Date().toISOString();
  const source = gitMetadata();
  const sql = new Client({ connectionString: databaseUrl, application_name: schema });
  let sqlFailure: Error | undefined;
  sql.on('error', (error: Error) => {
    // Idle client errors are events, not query promise rejections.
    sqlFailure = error;
  });
  const modules: TestingModule[] = [];
  let prisma: PrismaClient | undefined;
  let schemaCreated = false;
  let failed = false;
  let failure: unknown;
  const cleanupErrors: string[] = [];

  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA ${quotedSchema}`);
    schemaCreated = true;
    // Exclude public so unqualified migration statements stay in our schema.
    await sql.query(`SET search_path TO ${quotedSchema}`);
    const migrationsRoot = join(REPOSITORY_ROOT, 'prisma', 'migrations');
    const migrationNames = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (migrationNames.length === 0) throw new Error('No checked-in migrations were found');
    for (const name of migrationNames) {
      await sql.query(await readFile(join(migrationsRoot, name, 'migration.sql'), 'utf8'));
    }

    const postgres = await sql.query<{ server_version: string }>('SHOW server_version');
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
    });
    await prisma.$connect();
    const cache = new MemoryCacheAdapter();
    const cachedModule = await Test.createTestingModule({
      imports: [
        FeatureFlagModule.forRoot({
          environment: 'production',
          prisma,
          cacheTtlMs: CACHE_TTL_MS,
          cacheAdapter: cache,
        }),
      ],
    }).compile();
    modules.push(cachedModule);
    await cachedModule.init();
    const cached = cachedModule.get(FeatureFlagService);
    const uncachedModule = await Test.createTestingModule({
      imports: [FeatureFlagModule.forRoot({ environment: 'production', prisma, cacheTtlMs: 0 })],
    }).compile();
    modules.push(uncachedModule);
    await uncachedModule.init();
    const uncached = uncachedModule.get(FeatureFlagService);

    await uncached.create({ key: 'BENCH_FLAG', enabled: true });
    await uncached.setOverride('BENCH_FLAG', {
      attributes: { tenantId: 'tenant-1' },
      enabled: false,
    });
    await uncached.setOverride('BENCH_FLAG', {
      attributes: { userId: 'user-1' },
      enabled: true,
    });
    await uncached.setOverride('BENCH_FLAG', {
      attributes: { environment: 'staging' },
      enabled: false,
    });
    for (let i = 0; i < FLAG_COUNT - 1; i++) {
      await uncached.create({
        key: `BULK_FLAG_${i}`,
        enabled: i % 2 === 0,
        percentage: i % 5 === 0 ? 50 : 0,
      });
    }
    assert.equal(
      await prisma.featureFlag.count(),
      FLAG_COUNT,
      'Benchmark must contain exactly 50 flags',
    );

    const metadata = {
      startedAt,
      node: process.version,
      prisma: Prisma.prismaVersion.client,
      postgres: postgres.rows[0].server_version,
      os: { platform: platform(), release: release(), arch: arch() },
      cpu: { model: cpus()[0]?.model ?? 'unknown', logicalCores: cpus().length },
      ...source,
      schema,
      migrations: migrationNames,
      cacheAdapter: 'MemoryCacheAdapter',
      cacheTtlMs: CACHE_TTL_MS,
      uncachedTtlMs: 0,
      iterations,
      warmup,
      flagCount: FLAG_COUNT,
      bulkCacheHitFraction: 0.9,
      bulkCacheMissFraction: 0.1,
    };
    console.log(JSON.stringify(metadata, null, 2));
    const expectEnabled = (value: boolean) =>
      assert.equal(value, true, 'Evaluation failed or returned an unexpected value');
    // Prime even when warmup=0 so every timed A call begins with a cache entry.
    expectEnabled(await cached.isEnabled('BENCH_FLAG'));
    const results = [
      await measure(
        'A) isEnabled — warmed memory cache',
        iterations,
        warmup,
        () => cached.isEnabled('BENCH_FLAG'),
        expectEnabled,
      ),
      await measure(
        'B) isEnabled — cache disabled, DB lookup',
        iterations,
        warmup,
        () => uncached.isEnabled('BENCH_FLAG'),
        expectEnabled,
      ),
      await measure(
        'C) isEnabled — cold cache, matching user override',
        iterations,
        warmup,
        () =>
          cached.isEnabled('BENCH_FLAG', {
            userId: 'user-1',
            tenantId: null,
            environment: 'production',
          }),
        expectEnabled,
        () => cache.invalidate('BENCH_FLAG'),
      ),
      await measure(
        'D) evaluateAll — 50 flags, 90% cache hits / 10% misses',
        iterations,
        warmup,
        () => cached.evaluateAll(),
        (values) => {
          assert.equal(
            Object.keys(values).length,
            FLAG_COUNT,
            'Bulk evaluation must return exactly 50 flags',
          );
          assert.equal(values.BENCH_FLAG, true);
        },
        async (i) => {
          if (i % 10 === 0) await cache.invalidate();
        },
      ),
    ];

    if (sqlFailure) throw sqlFailure;
    const cacheSpeedup = results[0].avgMs > 0 ? results[1].avgMs / results[0].avgMs : null;
    for (const result of results) {
      console.log(`\n${result.label}`);
      console.log(
        `Avg: ${result.avgMs.toFixed(4)}ms | P50: ${result.p50Ms.toFixed(4)}ms | P95: ${result.p95Ms.toFixed(4)}ms | P99: ${result.p99Ms.toFixed(4)}ms`,
      );
    }
    console.log(
      `\nMeasured cache miss/hit average ratio: ${cacheSpeedup?.toFixed(2) ?? 'unavailable'}x`,
    );
    if (outputPath) {
      const destination = resolve(outputPath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(
        destination,
        JSON.stringify(
          {
            metadata: { ...metadata, completedAt: new Date().toISOString() },
            cacheSpeedup,
            scenarios: results,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
      console.log(`Saved measurements to ${destination}`);
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    const clean = async (label: string, action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        cleanupErrors.push(`${label}: ${safeError(error, databaseUrl)}`);
      }
    };
    for (const module of modules.reverse()) {
      await clean('close testing module', () => module.close());
    }
    if (prisma) await clean('disconnect Prisma', () => prisma!.$disconnect());
    if (schemaCreated) {
      await clean(`drop own schema ${schema}`, async () => {
        const statement = `DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`;
        if (!sqlFailure) {
          try {
            await sql.query(statement);
            return;
          } catch {
            // A lost setup connection must not prevent cleanup through a new one.
          }
        }
        const recovery = new Client({ connectionString: databaseUrl });
        let recoveryFailure: Error | undefined;
        recovery.on('error', (error: Error) => {
          recoveryFailure = error;
        });
        try {
          await recovery.connect();
          await recovery.query(statement);
          if (recoveryFailure) throw recoveryFailure;
        } finally {
          await clean('close cleanup PostgreSQL client', () => recovery.end());
        }
      });
    }
    await clean('close PostgreSQL client', () => sql.end());
  }
  if (cleanupErrors.length > 0) {
    for (const error of cleanupErrors) console.error(`Cleanup failed: ${error}`);
    process.exitCode = 1;
  }
  if (failed) throw failure;
  if (cleanupErrors.length === 0) console.log('Benchmark schema and clients cleaned up.');
}

main().catch((error) => {
  console.error(`Benchmark failed: ${safeError(error, process.env.DATABASE_URL)}`);
  process.exitCode = 1;
});
