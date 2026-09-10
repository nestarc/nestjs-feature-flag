# Evaluation benchmark

[`evaluation-overhead.ts`](./evaluation-overhead.ts) measures sequential feature flag evaluations against PostgreSQL with `MemoryCacheAdapter`. Run it from the repository root with a Node.js version supported by `package.json`.

## Run

Install the dependencies pinned by the repository:

```bash
npm ci
```

Set `DATABASE_URL` to a PostgreSQL database where your role can create a schema. Each run creates its own schema; the benchmark does not require the application's tables or migrations to have been applied beforehand.

For the repository's optional local Docker database:

```bash
npm run docker:up
export DATABASE_URL='postgresql://test:test@localhost:5499/feature_flag_test'
```

The Docker setup uses PostgreSQL 16. If you override `FEATURE_FLAG_POSTGRES_PORT`, use that port in `DATABASE_URL`. `docker:up` also starts Redis, but this benchmark uses only PostgreSQL and the in-memory cache.

Run the benchmark and optionally save the results:

```bash
BENCH_OUTPUT=benchmarks/results/local.json npm run bench
```

`npm run bench` first generates the Prisma client through `prebench`. The benchmark creates missing output directories and writes `BENCH_OUTPUT` exclusively: if the file already exists, the run fails without overwriting it. Choose a new filename for each saved run. Omit `BENCH_OUTPUT` to print the results without writing a JSON file.

Show the available settings:

```bash
npm run bench -- --help
```

## Settings

| Environment variable | Default  | Meaning                                                                                                           |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Required | PostgreSQL connection URL; the role needs permission to create a schema in this database.                         |
| `BENCH_ITERATIONS`   | `500`    | Measured iterations per scenario. Must be an integer of at least `10` and a multiple of `10`.                     |
| `BENCH_WARMUP`       | `30`     | Warmup iterations per scenario, excluded from reported timings. Must be a non-negative integer.                   |
| `BENCH_OUTPUT`       | Unset    | Optional new JSON output file, resolved from the current working directory. Existing files are never overwritten. |

For example:

```bash
BENCH_ITERATIONS=1000 BENCH_WARMUP=50 BENCH_OUTPUT=benchmarks/results/local-1000.json npm run bench
```

## Data and measurements

Every run creates a schema with a UUID in its name and applies the checked-in SQL migrations with that schema on the connection's `search_path`. The Prisma PostgreSQL adapter is configured to use the same schema. The benchmark seeds exactly **50 flags**: `BENCH_FLAG`, with attribute overrides, and 49 bulk flags.

The cached service uses `MemoryCacheAdapter` with a 30,000 ms TTL. A separate service uses a TTL of `0` to disable caching. The four scenarios measure:

| Scenario | Operation                                                            | Cache behavior                                                                                     |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A        | `isEnabled('BENCH_FLAG')`                                            | A warmed cache hit.                                                                                |
| B        | `isEnabled('BENCH_FLAG')`                                            | Caching disabled; each call reads PostgreSQL.                                                      |
| C        | `isEnabled('BENCH_FLAG', context)` with matching override attributes | Cache invalidated before each measured call; includes a database read and override evaluation.     |
| D        | `evaluateAll()` over all 50 flags                                    | Cache invalidated on every tenth iteration, producing an intentional 10% cold / 90% warm schedule. |

Scenario A always performs one additional untimed call to prime the cache, including when `BENCH_WARMUP=0`. Cache invalidation for scenarios C and D happens before the timed operation. Schema creation, migrations, seeding, warmup, result assertions, and cleanup are also outside the measured timings. Calls run sequentially; these scenarios do not measure concurrent request throughput or HTTP handling.

On success or failure, the benchmark's `finally` cleanup attempts to close its clients and remove only the schema created by that run. Each cleanup action is attempted even if an earlier action fails. Cleanup failures are reported and make the process exit unsuccessfully.

## Results

The console reports timing summaries. When `BENCH_OUTPUT` is set, the JSON file also includes raw timings and run metadata: timestamp, Node.js, Prisma and PostgreSQL versions, operating system, architecture, CPU, Git revision and working-tree dirty status, cache TTLs, iteration counts, and warmup counts. Preserve this metadata alongside results when comparing runs.

These are synthetic measurements for the recorded environment and dataset. Database location, machine load, runtime versions, data size, and request concurrency can change application performance. Scenario D's cold calls are scheduled by invalidation rather than observed from production traffic. The results provide neither a performance guarantee nor evidence that a 30-second TTL is optimal. They do not measure Redis performance.
