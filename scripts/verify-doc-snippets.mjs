#!/usr/bin/env node
// Compile complete consumer recipes directly from Markdown, without duplicated fixtures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guidePath = join(root, 'docs/usage.md');
const guide = readFileSync(guidePath, 'utf8');
const expectedRecipes = [
  'main.ts',
  'database.module.ts',
  'route-guard.ts',
  'admin.ts',
  'cache.ts',
  'events.ts',
];
const recipes = new Map();

for (const marker of guide.matchAll(/<!-- typecheck: ([^\n]+?) -->/g)) {
  const name = marker[1];
  assert(/^[a-z][a-z0-9.-]*\.ts$/.test(name), `Invalid recipe filename: ${name}`);
  assert(!recipes.has(name), `Duplicate typecheck recipe: ${name}`);
  const after = guide.slice(marker.index + marker[0].length);
  const block = after.match(/^\s*```typescript\n([\s\S]*?)\n```/);
  assert(block, `typecheck marker ${name} must be followed by a TypeScript fence`);
  recipes.set(name, `${block[1]}\n`);
}
for (const name of expectedRecipes) {
  assert(recipes.has(name), `Missing required documented recipe: ${name}`);
}

const configMarker = '<!-- source: examples/basic-guard/prisma.config.ts -->';
const configStart = guide.indexOf(configMarker);
assert(configStart !== -1, 'Consumer guide must include its documented Prisma config');
const configBlock = guide
  .slice(configStart + configMarker.length)
  .match(/^\s*```typescript\n([\s\S]*?)\n```/);
assert(configBlock, 'Documented Prisma config must be a TypeScript fence');

const typescriptCli = join(root, 'node_modules/typescript/bin/tsc');
const prismaCli = join(root, 'node_modules/prisma/build/index.js');
assert(
  existsSync(typescriptCli) && existsSync(prismaCli),
  'Install development dependencies with npm ci first',
);
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packageTypes = {};
for (const [subpath, entry] of Object.entries(manifest.exports)) {
  assert(entry.types, `Missing public types for export ${subpath}`);
  const declaration = resolve(root, entry.types);
  assert(existsSync(declaration), `Missing ${entry.types}; run npm run build first`);
  const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
  packageTypes[specifier] = [declaration];
}

const workspace = mkdtempSync(join(tmpdir(), 'feature-flag-doc-snippets-'));
try {
  mkdirSync(join(workspace, 'src'));
  mkdirSync(join(workspace, 'prisma'));
  symlinkSync(
    join(root, 'node_modules'),
    join(workspace, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const [name, source] of recipes) {
    writeFileSync(join(workspace, 'src', name), source);
  }

  // Mirror the guide's copy-and-adjust setup. Generation does not connect to a database.
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
  const originalOutput = '../generated/prisma';
  assert(
    schema.includes(originalOutput),
    'Update documented generator output when canonical schema changes',
  );
  writeFileSync(
    join(workspace, 'prisma/schema.prisma'),
    schema.replace(originalOutput, '../src/generated/prisma'),
  );
  writeFileSync(join(workspace, 'prisma.config.ts'), `${configBlock[1]}\n`);
  writeFileSync(
    join(workspace, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'commonjs',
          target: 'ES2022',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          noEmit: true,
          baseUrl: root,
          paths: packageTypes,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );

  const run = (command, args) => {
    try {
      return execFileSync(command, args, {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://docs:docs@127.0.0.1:5432/docs_typecheck_only',
        },
      });
    } catch (error) {
      throw new Error(
        `Documented recipe verification failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`,
        { cause: error },
      );
    }
  };
  run(process.execPath, [prismaCli, 'generate', '--config', join(workspace, 'prisma.config.ts')]);
  run(process.execPath, [typescriptCli, '--project', join(workspace, 'tsconfig.json')]);
  console.log(
    `Typechecked ${recipes.size} documented recipes against public package declarations and a fresh Prisma client.`,
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
