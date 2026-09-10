import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = ['basic-guard', 'multi-tenant-targeting', 'redis-events'];
const documents = [
  'README.md',
  'docs/usage.md',
  'docs/README.md',
  'AGENTS.md',
  'benchmarks/README.md',
  ...examples.map((name) => `examples/${name}/README.md`),
];
const failures = [];
let sourceCount = 0;

function anchors(path) {
  const markdown = readFileSync(path, 'utf8').replace(/```[\s\S]*?```/g, '');
  const ids = new Set();
  const counts = new Map();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1]
      .replace(/<[^>]*>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
      .replaceAll(' ', '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  for (const match of markdown.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/g)) {
    ids.add(match[1]);
  }
  return ids;
}

function check(label, callback) {
  try {
    callback();
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
}

for (const document of documents) {
  check(document, () => {
    const path = join(root, document);
    const markdown = readFileSync(path, 'utf8');
    // A source marker ties a documented code block to a consumer fixture that CI runs.
    const markers = [...markdown.matchAll(/<!-- source: ([^\n]+?) -->/g)];
    for (const marker of markers) {
      const sourcePath = resolve(root, marker[1]);
      assert(sourcePath.startsWith(root + sep), 'source marker must stay inside the repository');
      const after = markdown.slice(marker.index + marker[0].length);
      const block = after.match(/^\s*```[^\n]*\n([\s\S]*?)\n```/);
      assert(block, `source marker ${marker[1]} must be followed by a fenced code block`);
      assert.equal(
        block[1].replaceAll('\r\n', '\n').trimEnd(),
        readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n').trimEnd(),
        `documented snippet differs from ${marker[1]}`,
      );
      sourceCount += 1;
    }

    // Check repository links, including links from the distributed consumer guide.
    // Remote release links are reviewed separately; this check never needs network access.
    const prose = markdown.replace(/```[\s\S]*?```/g, '');
    for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split(/\s+"/)[0];
      if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target)) continue;
      const [file, fragment] = target.split('#').map(decodeURIComponent);
      const linkedPath = file ? resolve(dirname(path), file) : path;
      assert(existsSync(linkedPath), `broken relative link: ${target}`);
      if (fragment && /\.md$/i.test(linkedPath)) {
        assert(anchors(linkedPath).has(fragment), `broken heading link: ${target}`);
      }
    }
  });
}

check('README executable source', () => {
  assert(sourceCount > 0, 'at least one documented source block must be connected to a tested example');
  assert(
    readFileSync(join(root, 'README.md'), 'utf8').includes('<!-- source: examples/basic-guard/src/app.module.ts -->'),
    'README Quickstart must include the tested basic AppModule',
  );
});

const migrations = readdirSync(join(root, 'prisma/migrations'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `${entry.name}/migration.sql`);
const models = (source) => source.slice(source.indexOf('model FeatureFlag {')).trim();
for (const example of examples) {
  check(`${example} schema and migrations`, () => {
    const exampleRoot = join(root, 'examples', example);
    assert.equal(
      models(readFileSync(join(exampleRoot, 'prisma/schema.prisma'), 'utf8')),
      models(readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')),
      'example models differ from the package schema',
    );
    for (const migration of migrations) {
      assert.equal(
        readFileSync(join(exampleRoot, 'prisma/migrations', migration), 'utf8'),
        readFileSync(join(root, 'prisma/migrations', migration), 'utf8'),
        `migration differs: ${migration}`,
      );
    }
  });
}

check('npm consumer documentation and exports', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const [pack] = JSON.parse(execFileSync(npm, [
    'pack', '--dry-run', '--ignore-scripts', '--json', '--cache', join(tmpdir(), 'feature-flag-docs-npm-cache'),
  ], { cwd: root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }));
  const files = new Set(pack.files.map((file) => file.path));
  for (const required of ['README.md', 'docs/usage.md', 'CHANGELOG.md', 'prisma/schema.prisma']) {
    assert(files.has(required), `missing from npm package: ${required}`);
  }
  for (const document of ['README.md', 'docs/usage.md']) {
    const prose = readFileSync(join(root, document), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split(/\s+"/)[0];
      if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target)) continue;
      const file = decodeURIComponent(target.split('#')[0]);
      if (!file) continue;
      const linkedPath = posix.normalize(posix.join(posix.dirname(document), file));
      assert(
        files.has(linkedPath),
        `relative link in packaged ${document} targets an unpackaged file: ${target}`,
      );
    }
  }
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    for (const target of [entry.types, entry.default]) {
      assert(target && files.has(target.replace(/^\.\//, '')), `missing export ${subpath}: ${target}`);
    }
  }
  for (const field of ['homepage', 'bugs']) assert(manifest[field], `missing package ${field}`);
  console.log(`Verified npm package: ${files.size} files, consumer guide, changelog and all exports.`);
});

check('documented TypeScript recipes', () => {
  execFileSync(process.execPath, [join(root, 'scripts/verify-doc-snippets.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
});

if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified ${documents.length} documents, ${sourceCount} source blocks, and ${examples.length} portable schemas.`);
  console.log(`Repository: ${relative(process.cwd(), root) || '.'}`);
}
