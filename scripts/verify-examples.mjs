#!/usr/bin/env node
// Verify actual npm consumers: examples are copied outside this checkout and install a tarball.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildOnly = process.argv.includes('--build-only');
if (process.argv.slice(2).some((arg) => arg !== '--build-only')) {
  throw new Error('Usage: node scripts/verify-examples.mjs [--build-only]');
}
if (!buildOnly && (!process.env.DATABASE_URL || !process.env.REDIS_URL)) {
  throw new Error(
    'Full verification requires DATABASE_URL and REDIS_URL for local test services. Use --build-only for compilation.',
  );
}

const require = createRequire(import.meta.url);
const runId = `ff_examples_${randomBytes(8).toString('hex')}`;
const workspace = await mkdtemp(path.join(tmpdir(), `${runId}-`));
const children = new Set();
const env = {
  ...process.env,
  NODE_ENV: 'development',
  npm_config_cache: process.env.npm_config_cache ?? path.join(workspace, 'npm-cache'),
};
const names = ['basic-guard', 'multi-tenant-targeting', 'redis-events'];
let database;
let redis;
let schemaCreated = false;

async function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        output = (output + chunk).slice(-24_000);
      });
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve(output);
      else
        reject(
          new Error(`${command} ${args.join(' ')} failed (${code ?? signal}) in ${cwd}\n${output}`),
        );
    });
  });
}

async function checkPrismaCopy(example) {
  const canonical = await readFile(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const copied = await readFile(path.join(example, 'prisma/schema.prisma'), 'utf8');
  assert.equal(
    copied,
    canonical.replace('../generated/prisma', '../src/generated/prisma'),
    'Example Prisma schema drifted from the package',
  );
  async function compare(directory = '') {
    const source = path.join(root, 'prisma/migrations', directory);
    const destination = path.join(example, 'prisma/migrations', directory);
    const sourceEntries = await readdir(source, { withFileTypes: true });
    assert.deepEqual(
      (await readdir(destination)).sort(),
      sourceEntries.map((entry) => entry.name).sort(),
    );
    for (const entry of sourceEntries) {
      if (entry.isDirectory()) await compare(path.join(directory, entry.name));
      else
        assert.deepEqual(
          await readFile(path.join(source, entry.name)),
          await readFile(path.join(destination, entry.name)),
          `Migration drift: ${entry.name}`,
        );
    }
  }
  await compare();
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.listen(0, '127.0.0.1', resolve).once('error', reject),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    signal: AbortSignal.timeout(2_000),
  });
  return { status: response.status, body: await response.json() };
}

async function start(example, extraEnv, route) {
  const port = await freePort();
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: example,
    env: { ...env, ...extraEnv, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output = (output + chunk).slice(-16_000);
    });
  }
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null) {
      throw new Error(`Example startup failed: ${spawnError ?? child.exitCode}\n${output}`);
    }
    try {
      const result = await request(base, route);
      if (result.status < 500) return { base, child };
    } catch {
      /* Wait for the HTTP listener. */
    }
    await pause(100);
  }
  throw new Error(`Example startup timed out\n${output}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const killer = setTimeout(() => child.kill('SIGKILL'), 3_000);
  await exited;
  clearTimeout(killer);
  children.delete(child);
}

try {
  if (!buildOnly) {
    const { Client } = require('pg');
    database = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5_000,
    });
    await database.connect();
    // The identifier contains only generated ASCII letters, digits, and underscores.
    await database.query(`CREATE SCHEMA "${runId}"`);
    schemaCreated = true;
    const dbUrl = new URL(process.env.DATABASE_URL);
    dbUrl.searchParams.set('schema', runId);
    env.DATABASE_URL = dbUrl.toString();
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      retryStrategy: () => null,
    });
    redis.on('error', () => {});
    await redis.connect();
  } else {
    env.DATABASE_URL = 'postgresql://build:build@127.0.0.1:5432/build_only';
  }

  console.log('Building and packing the package...');
  await run('npm', ['run', 'build'], root);
  await run('npm', ['pack', '--pack-destination', workspace], root);
  const archives = (await readdir(workspace)).filter((file) => file.endsWith('.tgz'));
  assert.equal(archives.length, 1);
  const tarball = path.join(workspace, archives[0]);
  const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const fixtures = new Map();
  for (const name of names) {
    const source = path.join(root, 'examples', name);
    const target = path.join(workspace, name);
    await checkPrismaCopy(source);
    await cp(source, target, {
      recursive: true,
      filter: (sourcePath) =>
        !['node_modules', 'dist', 'generated', '.env', 'package-lock.json'].includes(
          path.basename(sourcePath),
        ),
    });
    const manifestFile = path.join(target, 'package.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.dependencies['@nestarc/feature-flag'] = `file:${tarball}`;
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Installing packed package and building ${name}...`);
    await run('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false'], target);
    const installed = JSON.parse(
      await readFile(path.join(target, 'node_modules/@nestarc/feature-flag/package.json'), 'utf8'),
    );
    assert.equal(installed.version, rootManifest.version);
    await run('npm', ['run', 'prisma:generate'], target);
    if (!buildOnly) await run('npm', ['run', 'db:migrate'], target);
    await run('npm', ['run', 'build'], target);
    fixtures.set(name, target);
  }

  if (!buildOnly) {
    console.log('Checking guard allow/deny and tenant targeting over HTTP...');
    const basic = fixtures.get('basic-guard');
    const basicEnv = { EXAMPLE_FLAG_KEY: `${runId}_dashboard` };
    await run('npm', ['run', 'seed', '--', 'on'], basic, basicEnv);
    const basicApp = await start(basic, basicEnv, '/dashboard');
    assert.deepEqual(await request(basicApp.base, '/dashboard'), {
      status: 200,
      body: { message: 'New dashboard is enabled' },
    });
    await run('npm', ['run', 'seed', '--', 'off'], basic, basicEnv);
    assert.equal((await request(basicApp.base, '/dashboard')).status, 403);
    await stop(basicApp.child);

    const tenant = fixtures.get('multi-tenant-targeting');
    const tenantEnv = { EXAMPLE_FLAG_KEY: `${runId}_checkout` };
    await run('npm', ['run', 'seed'], tenant, tenantEnv);
    const tenantApp = await start(tenant, tenantEnv, '/checkout');
    for (const [headers, expected] of [
      [{ 'x-tenant-id': 'tenant-acme', 'x-plan': 'pro' }, 'new'],
      [{ 'x-tenant-id': 'tenant-acme', 'x-plan': 'free' }, 'classic'],
      [{ 'x-tenant-id': 'tenant-other', 'x-plan': 'pro' }, 'classic'],
      [{}, 'classic'],
    ]) {
      assert.deepEqual(await request(tenantApp.base, '/checkout', { headers }), {
        status: 200,
        body: { version: expected },
      });
    }
    await stop(tenantApp.child);

    console.log(
      'Checking two Redis instances, cache invalidation, demo authorization, and events...',
    );
    const redisExample = fixtures.get('redis-events');
    const redisEnv = {
      EXAMPLE_FLAG_KEY: `${runId}_redis`,
      EXAMPLE_REDIS_PREFIX: `${runId}:`,
      EXAMPLE_REDIS_CHANNEL: `${runId}:invalidate`,
      DEMO_TOKEN: randomBytes(24).toString('hex'),
    };
    await run('npm', ['run', 'seed', '--', 'off'], redisExample, redisEnv);
    const appA = await start(redisExample, redisEnv, '/demo/evaluate');
    const appB = await start(redisExample, redisEnv, '/demo/evaluate');
    assert.equal((await request(appA.base, '/demo/evaluate')).body.enabled, false);
    assert.equal((await request(appB.base, '/demo/evaluate')).body.enabled, false);
    const mutation = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    };
    assert.equal((await request(appA.base, '/demo/flag', mutation)).status, 401);
    assert.equal((await request(appB.base, '/demo/evaluate')).body.enabled, false);
    assert.deepEqual(
      await request(appA.base, '/demo/flag', {
        ...mutation,
        headers: { ...mutation.headers, 'x-demo-token': redisEnv.DEMO_TOKEN },
      }),
      { status: 201, body: { enabled: true } },
    );
    const deadline = Date.now() + 5_000; // Well below the example's 60-second TTL.
    let updated = false;
    while (Date.now() < deadline) {
      if ((await request(appB.base, '/demo/evaluate')).body.enabled) {
        updated = true;
        break;
      }
      await pause(50);
    }
    assert.equal(
      updated,
      true,
      'Instance B retained a cached false value after instance A updated the flag',
    );
    const eventsA = (await request(appA.base, '/demo/events')).body;
    const eventsB = (await request(appB.base, '/demo/events')).body;
    assert.ok(
      eventsA.evaluated > 0 && eventsB.evaluated > 0,
      'Evaluation events must be emitted in both processes',
    );
    assert.equal(eventsA.updated, 1);
    assert.equal(eventsB.updated, 0, 'Nest events are local to the mutating process');
  }
  console.log(
    buildOnly
      ? 'All 3 standalone consumers generated and built from the packed package.'
      : 'All 3 packed-package examples passed database, HTTP, Redis, and event checks.',
  );
} finally {
  const errors = [];
  for (const child of children) {
    try {
      await stop(child);
    } catch (error) {
      errors.push(error);
    }
  }
  if (redis) {
    try {
      await redis.del(`${runId}:${runId}_redis`, `${runId}:__all__`);
    } catch (error) {
      errors.push(error);
    }
    redis.disconnect();
  }
  if (database) {
    try {
      if (schemaCreated) await database.query(`DROP SCHEMA "${runId}" CASCADE`);
    } catch (error) {
      errors.push(error);
    }
    await database.end();
  }
  await rm(workspace, { recursive: true, force: true });
  if (errors.length) throw new AggregateError(errors, 'Example verification cleanup failed');
}
