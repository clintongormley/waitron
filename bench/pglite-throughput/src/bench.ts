/**
 * Throughput spike for the PGlite standalone decision (spec §3).
 *
 * Simulates the §5 local-server topology: N tills issuing write-path-shaped
 * transactions against ONE database node. Reports p50/p95/p99 commit latency
 * and sustained transactions per second, for PGlite and — as a control — real
 * PostgreSQL via Testcontainers.
 *
 * Emits a Markdown block on stdout, ready to paste into
 * docs/research/2026-07-20-pglite-throughput.md, and exits non-zero if the
 * PGlite result misses the criterion in PASS_CRITERION below.
 *
 * **2026-07-21 re-measurement (Task 15's mandated follow-up, due once Task 17
 * landed).** `writePath()` below now mirrors the COMPLETED write path, not
 * Task 1's guess. Task 1 could not model art. 7.i verification or the outbox
 * sidecar because neither table existed yet — both do now
 * (`packages/fiscal-verifactu/src/verify.ts`'s `verifyChain`,
 * `packages/fiscal-verifactu/src/schema/envios.ts`). This is a faithful SHAPE
 * match, deliberately not a real `recordSale` call: wiring `@waitron/core` +
 * a real `VerifactuBackend` + a seeded tenant/till/series/SIF into this
 * standalone, single-file bench (see "Single-file constraint" in the
 * package's own README) was judged disproportionate to a throughput spike —
 * see docs/research/2026-07-20-pglite-throughput.md's re-measurement section
 * for the full reasoning. Three additions, all inside `writePath`:
 *
 *   1. The art. 7.i two-row predecessor read — `select ... order by sequence
 *      desc limit 2` — mirroring `verifyChain`'s identical query against
 *      `registros_facturacion`.
 *   2. A REAL SHA-256 recompute of record n-1's hash from ITS OWN stored
 *      inputs (never trusting the stored value), mirroring `verifyHuella`'s
 *      "does this record's stored huella match its own content" check —
 *      using the exact formula this bench already hashes new records with.
 *   3. An outbox/sidecar INSERT into the new `bench_envios` table, mirroring
 *      `VerifactuBackend.recordSale`'s `envios` insert (backend.ts step 6).
 *
 * The registro INSERT with its own huella computation (`bench_records`, plus
 * the SHA-256 that produces `hash`) was already present since Task 1 and is
 * unchanged.
 *
 * **NOT modeled**, deliberately, to keep this a shape match rather than a
 * statement-by-statement reimplementation of `recordSale`: the series/SIF/
 * tenant/location point-lookups, invoice-number allocation, and the tenders
 * insert `packages/core/src/record-sale.ts` also performs, plus the second
 * SIF lookup and QR-payload re-select inside `VerifactuBackend.recordSale`
 * itself. Each is a single indexed read or insert against a small table —
 * real cost, but secondary to the two components Task 15 flagged as OMITTED
 * ENTIRELY (verification, outbox) that this re-measurement exists to fix.
 * See the research doc for the honest accounting of what this number does
 * and does not cover, and why the residual gap does not change the PASS
 * conclusion.
 */
import { PGlite } from "@electric-sql/pglite";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

/**
 * The bar, justified from the deployment facts rather than invented.
 *
 * First deployment is a NEW deli in Barcelona (architecture §1): greenfield,
 * low initial volume, a handful of tills. Second is an existing restaurant.
 * Model the deli's worst realistic minute — a lunch rush at 4 tills, each
 * settling a sale every 15 seconds — and you get 16 sales/minute, 0.27 tx/s.
 * Model the restaurant generously at 10 tills settling every 20 seconds and
 * you get 30 sales/minute, 0.5 tx/s.
 *
 * So the sustained-throughput bar is set at 20 tx/s: roughly 40x the modelled
 * restaurant peak. The margin is not padding — the same node also serves
 * reprints, voids, Z-report reads and the outbox drainer, and PGlite
 * serialises all of them onto one backend, so they compete for the same
 * budget the sales do.
 *
 * Latency is the number a cashier actually experiences, because the receipt
 * cannot print until the transaction commits. 150ms at p95 keeps the commit
 * below the threshold at which a person perceives a wait; 400ms at p99 keeps
 * the worst sale of a rush from feeling like a queue.
 */
const PASS_CRITERION = {
  minSustainedTps: 20,
  maxP95Ms: 150,
  maxP99Ms: 400,
  maxColdBootMs: 3_000,
};

const TILLS = 8;
const DURATION_MS = 20_000;
const WARMUP_MS = 3_000;
const BOOT_SAMPLES = 5;
const FRESH_DB_SAMPLES = 20;

const SCHEMA_SQL = [
  `create table bench_chains (
     tenant_id text not null,
     till_id text not null,
     sequence integer not null,
     last_hash text not null,
     primary key (tenant_id, till_id)
   )`,
  `create table bench_sales (
     id text primary key,
     tenant_id text not null,
     till_id text not null,
     invoice_number integer not null,
     issued_at timestamptz not null,
     total numeric(12, 2) not null
   )`,
  `create table bench_sale_lines (
     id text primary key,
     sale_id text not null,
     line_no integer not null,
     quantity numeric(12, 3) not null,
     unit_price numeric(12, 2) not null,
     line_total numeric(12, 2) not null
   )`,
  `create table bench_records (
     id text primary key,
     tenant_id text not null,
     till_id text not null,
     sequence integer not null,
     hash text not null,
     unique (tenant_id, till_id, sequence)
   )`,
  // The outbox/sidecar (schema/envios.ts): 1:1 with a registro, written pendiente and never
  // touched again by this write path — this bench models the write, never the drainer.
  `create table bench_envios (
     registro_id text primary key,
     tenant_id text not null,
     estado text not null default 'pendiente'
   )`,
];

/** Executes one parameterised statement. Both targets supply one of these. */
type Exec = (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Runs `fn` inside one transaction, however this target does transactions. */
type RunInTx = (fn: (exec: Exec) => Promise<void>) => Promise<void>;

/**
 * The write-path-shaped transaction from spec §4, extended for the 2026-07-21 re-measurement
 * (see the top-of-file comment for the full enumeration): lock the chain head, run the art. 7.i
 * predecessor check, insert the sale, three lines and the fiscal record, advance the head, then
 * insert the outbox row. Every hash is computed rather than faked because each is on the critical
 * path of a real commit and costs real microseconds.
 */
async function writePath(exec: Exec, tenantId: string, tillId: string): Promise<void> {
  const head = await exec(
    "select sequence, last_hash from bench_chains where tenant_id = $1 and till_id = $2 for update",
    [tenantId, tillId],
  );
  const previous = head.rows[0] as { sequence: number; last_hash: string };
  const sequence = Number(previous.sequence) + 1;

  // Art. 7.i (verify.ts's verifyChain): read the last two chained records under the SAME lock
  // just taken, then recompute record n-1's hash from ITS OWN stored inputs — never trust the
  // stored value — mirroring verifyHuella's "does this record's stored huella match its own
  // content" check. Two rows, not one: n-1's own predecessor input is n-2's hash, which is only
  // available by reading n-2 too.
  const lastTwo = await exec(
    `select tenant_id, till_id, sequence, hash
       from bench_records
      where tenant_id = $1 and till_id = $2
      order by sequence desc
      limit 2`,
    [tenantId, tillId],
  );
  const mostRecent = lastTwo.rows[0] as
    { tenant_id: string; till_id: string; sequence: number; hash: string } | undefined;
  if (mostRecent !== undefined) {
    const beforeThat = lastTwo.rows[1] as { hash: string } | undefined;
    // Discarded rather than compared: this bench never corrupts a record, so the recompute
    // always matches, exactly as it does on every real, untampered sale. The cost being measured
    // is running the hash, not branching on its result — real verifyChain's cost is likewise
    // dominated by the read and the recompute, not by the (rare) mismatch branch.
    createHash("sha256")
      .update(
        `${beforeThat?.hash ?? ""}|${mostRecent.tenant_id}|${mostRecent.till_id}|${mostRecent.sequence}`,
      )
      .digest("hex");
  }

  const saleId = randomUUID();
  const hash = createHash("sha256")
    .update(`${previous.last_hash}|${tenantId}|${tillId}|${sequence}`)
    .digest("hex");

  await exec(
    `insert into bench_sales (id, tenant_id, till_id, invoice_number, issued_at, total)
     values ($1, $2, $3, $4, now(), $5)`,
    [saleId, tenantId, tillId, sequence, "12.34"],
  );
  for (let lineNo = 1; lineNo <= 3; lineNo += 1) {
    await exec(
      `insert into bench_sale_lines (id, sale_id, line_no, quantity, unit_price, line_total)
       values ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), saleId, lineNo, "1.000", "4.11", "4.11"],
    );
  }
  const recordId = randomUUID();
  await exec(
    `insert into bench_records (id, tenant_id, till_id, sequence, hash)
     values ($1, $2, $3, $4, $5)`,
    [recordId, tenantId, tillId, sequence, hash],
  );
  await exec(
    "update bench_chains set sequence = $1, last_hash = $2 where tenant_id = $3 and till_id = $4",
    [sequence, hash, tenantId, tillId],
  );

  // Outbox/sidecar (backend.ts's `envios` insert, step 6): one row per registro, pendiente, never
  // touched again by this write path — the drainer that reads it back is a later plan.
  await exec(
    `insert into bench_envios (registro_id, tenant_id, estado) values ($1, $2, 'pendiente')`,
    [recordId, tenantId],
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

interface Result {
  target: string;
  commits: number;
  elapsedMs: number;
  tps: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Drives TILLS concurrent virtual tills against one node for DURATION_MS,
 * discarding the first WARMUP_MS of samples so JIT warm-up and first-touch
 * page faults do not land in the tail percentiles we are judging against.
 */
async function measureThroughput(target: string, tx: RunInTx): Promise<Result> {
  const latencies: number[] = [];
  const started = performance.now();
  const deadline = started + DURATION_MS;
  let commits = 0;

  await Promise.all(
    Array.from({ length: TILLS }, (_unused, index) => {
      const tillId = `till-${index}`;
      return (async () => {
        while (performance.now() < deadline) {
          const at = performance.now();
          await tx((exec) => writePath(exec, "tenant-1", tillId));
          const took = performance.now() - at;
          commits += 1;
          if (at - started >= WARMUP_MS) latencies.push(took);
        }
      })();
    }),
  );

  const elapsedMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  return {
    target,
    commits,
    elapsedMs,
    tps: (commits / elapsedMs) * 1000,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
}

async function seed(exec: Exec): Promise<void> {
  for (const statement of SCHEMA_SQL) await exec(statement, []);
  for (let index = 0; index < TILLS; index += 1) {
    await exec(
      "insert into bench_chains (tenant_id, till_id, sequence, last_hash) values ($1, $2, 0, '')",
      ["tenant-1", `till-${index}`],
    );
  }
}

/** Cold boot: process start to the first successful query, in-memory. */
async function measureColdBoot(): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < BOOT_SAMPLES; index += 1) {
    const at = performance.now();
    const db = new PGlite();
    await db.query("select 1", []);
    samples.push(performance.now() - at);
    await db.close();
  }
  return samples;
}

/**
 * The per-test cost of a fresh database: boot, apply the schema, seed. This is
 * what every single test in packages/db will pay, and Stryker pays it once per
 * mutant per covering test — which is what decides whether a per-PR mutation
 * gate is affordable at all.
 */
async function measureFreshDb(): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < FRESH_DB_SAMPLES; index += 1) {
    const at = performance.now();
    const db = new PGlite();
    await seed((text, params) => db.query(text, params) as Promise<{ rows: never[] }>);
    samples.push(performance.now() - at);
    await db.close();
  }
  return samples;
}

async function runPglite(): Promise<Result> {
  const db = new PGlite();
  await seed((text, params) => db.query(text, params) as Promise<{ rows: never[] }>);
  // PGlite's own transaction(), never hand-rolled begin/commit: on a single
  // shared backend, concurrent callers issuing `begin` merge into ONE
  // transaction and the benchmark silently measures the wrong thing.
  const tx: RunInTx = (fn) =>
    db.transaction(async (t) => {
      await fn((text, params) => t.query(text, params) as Promise<{ rows: never[] }>);
    }) as Promise<void>;
  const result = await measureThroughput("PGlite 0.5.x (in-memory)", tx);
  await db.close();
  return result;
}

async function runPostgres(): Promise<Result> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: TILLS });
  const setup = await pool.connect();
  await seed((text, params) => setup.query(text, params));
  setup.release();

  const tx: RunInTx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await fn((text, params) => client.query(text, params));
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  };

  const result = await measureThroughput("PostgreSQL 18 (Testcontainers)", tx);
  await pool.end();
  await container.stop();
  return result;
}

function row(result: Result): string {
  const n = (value: number) => value.toFixed(1);
  return `| ${result.target} | ${n(result.tps)} | ${n(result.p50)} | ${n(result.p95)} | ${n(result.p99)} | ${result.commits} |`;
}

const boot = await measureColdBoot();
const fresh = await measureFreshDb();
const pglite = await runPglite();
const postgres = await runPostgres();

const bootSorted = [...boot].sort((a, b) => a - b);
const freshSorted = [...fresh].sort((a, b) => a - b);

console.log(`
### Sustained write-path throughput (completed write path, incl. art. 7.i + outbox) — ${TILLS} tills, ${DURATION_MS / 1000}s

| Target | tx/s | p50 ms | p95 ms | p99 ms | commits |
| --- | --- | --- | --- | --- | --- |
${row(pglite)}
${row(postgres)}

### PGlite startup costs

| Measurement | median ms | p95 ms | samples |
| --- | --- | --- | --- |
| Cold boot to first query | ${percentile(bootSorted, 50).toFixed(1)} | ${percentile(bootSorted, 95).toFixed(1)} | ${boot.length} |
| Fresh database (boot + schema + seed) | ${percentile(freshSorted, 50).toFixed(1)} | ${percentile(freshSorted, 95).toFixed(1)} | ${fresh.length} |
`);

const failures = [
  pglite.tps < PASS_CRITERION.minSustainedTps
    ? `sustained ${pglite.tps.toFixed(1)} tx/s < ${PASS_CRITERION.minSustainedTps}`
    : null,
  pglite.p95 > PASS_CRITERION.maxP95Ms
    ? `p95 ${pglite.p95.toFixed(1)}ms > ${PASS_CRITERION.maxP95Ms}ms`
    : null,
  pglite.p99 > PASS_CRITERION.maxP99Ms
    ? `p99 ${pglite.p99.toFixed(1)}ms > ${PASS_CRITERION.maxP99Ms}ms`
    : null,
  percentile(bootSorted, 95) > PASS_CRITERION.maxColdBootMs
    ? `cold boot p95 ${percentile(bootSorted, 95).toFixed(1)}ms > ${PASS_CRITERION.maxColdBootMs}ms`
    : null,
].filter((entry): entry is string => entry !== null);

if (failures.length > 0) {
  console.error(`FAIL against the criterion: ${failures.join("; ")}`);
  process.exit(1);
}
console.error("PASS against the criterion.");
