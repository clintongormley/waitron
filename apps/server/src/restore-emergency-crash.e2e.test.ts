import { spawn, spawnSync } from "node:child_process";
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { openVenueDatabase, readStandardSeriesId, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  fiscalAllocations,
  registrosFacturacion,
  VerifactuBackend,
} from "@waitron/fiscal-verifactu";
import { recordSale } from "@waitron/core";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { orderedMigrationSets } from "@waitron/module";
import { seriesId as brandSeriesId } from "@waitron/shared";
import { migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "./modules.js";
import { runRestoreHooks } from "./restore.js";
import { stagedHourCrash } from "./testing/staged-hour-crash.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let fixture: Awaited<ReturnType<typeof stagedHourCrash>> | undefined;
async function stage(kind: "archive" | "stream") {
  fixture = await stagedHourCrash(suite.db, kind, "emergency-offline-restore");
  const originalRecords = await suite.db.select().from(registrosFacturacion);
  expect(originalRecords).toHaveLength(1);
  return { ...fixture, originalRecords };
}
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await fixture?.cleanup();
  fixture = undefined;
});
async function markPlaced(stateDir: string) {
  const path = join(stateDir, "restore-request.json");
  const marker = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...marker, placementStarted: true }));
  return path;
}

it("refuses a resumed database from a newer image before migration or hour admission", async () => {
  const f = await stage("archive");
  await f.seedDestination();
  const target = await openVenueDatabase(f.venueDir);
  try {
    await target.venue.run(
      sql`insert into __drizzle_migrations_db (hash, created_at) values (${"f".repeat(64)}, 99999999999999)`,
    );
  } finally {
    await target.close();
  }
  const markerPath = await markPlaced(f.stateDir);
  const journal = f.journal();
  await expect(f.run()).rejects.toMatchObject({ code: "provisioning.database_ahead" });
  expect(f.journal()).toBe(journal);
  expect(JSON.parse(await readFile(markerPath, "utf8")).placementStarted).toBe(true);
});

it("refuses a resume without a placed database instead of treating the stage marker as permission", async () => {
  const f = await stage("archive");
  await markPlaced(f.stateDir);
  const journal = f.journal();
  await expect(f.run()).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(f.journal()).toBe(journal);
});

it.each([
  ["archive", "settings"],
  ["stream", "settings"],
  ["archive", "credentials"],
  ["stream", "credentials"],
] as const)(
  "keeps the committed %s activation when the %s write throws before completion",
  async (kind, fault) => {
    const f = await stage(kind);
    const failure = Object.assign(new Error("injected post-commit write failure"), { code: "EIO" });
    const originalWrite = nativeFs.writeFile;
    vi.spyOn(nativeFs, "writeFile").mockImplementation(async (...args) => {
      if (
        String(args[0]) ===
        join(f.stateDir, fault === "settings" ? "trading.env.tmp" : "credentials.key.tmp")
      )
        throw failure;
      return originalWrite(...args);
    });
    syncBuiltinESMExports();
    await expect(f.run()).rejects.toBe(failure);
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    const committed = await f.snapshot();
    expect(committed.allocations).toHaveLength(2);
    expect(committed.records).toEqual(f.originalRecords);
    expect(await readdir(f.stateDir)).toContain("restore-request.json");
    expect(
      JSON.parse(await readFile(join(f.stateDir, "restore-request.json"), "utf8")),
    ).toHaveProperty("placementStarted", true);
    expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await f.advanceCounters();
    const advanced = await f.snapshot();
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(advanced);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
    await expect(readFile(join(f.stateDir, "restore-request.node-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await f.run()).toBe(false);
  },
);

it.each(["archive", "stream"] as const)(
  "a %s stage marker cannot substitute for a committed activation",
  async (kind) => {
    const f = await stage(kind);
    await cp(f.databasePath, join(f.venueDir, "venue.db"));
    await markPlaced(f.stateDir);
    const original = await f.snapshot();
    await expect(f.run()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "prior_activation_requires_replay" },
    });
    expect(await f.snapshot()).toEqual(original);
    expect(original.allocations.map((row) => row.installationIdentity)).toEqual(["06RB"]);
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.each(["archive", "stream"] as const)(
  "keeps the committed %s activation after a process is killed before publishing trading settings",
  async (kind) => {
    const f = await stage(kind);
    const previousIdentity = `# existing physical box\nWAITRON_TILL_NODE_ID=${f.node.nodeId}\nWAITRON_TILL_LOCATION_ID=${f.node.locationId}\nWAITRON_ENV=preproduction\n`;
    await writeFile(join(f.stateDir, "trading.env"), previousIdentity, { mode: 0o600 });
    await f.seedDestination();
    const output = await killRestore(f, "before-publication");
    expect(output).not.toContain(f.key.secret);
    expect(output).not.toContain(f.encryptionKey);
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const markerPath = join(f.stateDir, "restore-request.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    const committed = await f.snapshot();
    expect(committed.allocations).toHaveLength(2);
    expect(committed.allocations.map((row) => row.installationIdentity)).toEqual(["06RB", "06RC"]);
    const copy = await openVenueDatabase(f.venueDir);
    try {
      await runRestoreHooks({
        db: copy.venue,
        node: f.node,
        modules: ALL_MODULES,
        log: () => {},
        withModuleOperations: f.service.runner(marker.recoveryOperation.input, { refresh: true }),
        resumeOperation: f.binding,
      });
      expect(await copy.venue.select().from(fiscalAllocations)).toEqual(committed.allocations);
    } finally {
      await copy.close();
    }
    const expectRetained = async () => {
      expect(await f.snapshot()).toEqual(committed);
      expect(JSON.parse(await readFile(markerPath, "utf8")).placementStarted).toBe(true);
      await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    };
    const journal = f.journal();
    await writeFile(f.journalPath, JSON.stringify({ version: 1, revisions: [] }));
    await expect(f.run()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_missing" },
    });
    await expectRetained();
    await writeFile(f.journalPath, journal);
    await writeFile(join(f.stateDir, "restore-request.node-key"), "wrong-node-key");
    await expect(f.run()).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expectRetained();
    await writeFile(join(f.stateDir, "restore-request.node-key"), f.key.secret);
    const originalMarker = await readFile(markerPath, "utf8");
    await writeFile(
      markerPath,
      JSON.stringify({
        ...marker,
        recoveryOperation: {
          ...marker.recoveryOperation,
          binding: { ...marker.recoveryOperation.binding, sourceId: "different-copy" },
        },
      }),
    );
    await expect(f.run()).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { reason: "source_mismatch" },
    });
    await expectRetained();
    await writeFile(markerPath, originalMarker);
    await f.advanceCounters();
    const advanced = await f.snapshot();
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(advanced);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.locationId);
    expect(await readFile(join(f.stateDir, "trading.env.replaced"), "utf8")).toBe(previousIdentity);
    expect(await f.run()).toBe(false);
    const selling = await openVenueDatabase(f.venueDir);
    let networkCalls = 0;
    try {
      const backend = new VerifactuBackend({
        db: selling.venue,
        deploymentEnvironment: "preproduction",
        clock: steadyClock,
        resolveClient: async () => {
          networkCalls++;
          throw new Error("recovery test has no network");
        },
      });
      const seriesId = await readStandardSeriesId(selling.venue, f.node.nodeId);
      const result = await withTransaction(selling.venue, (tx) =>
        recordSale(
          tx,
          backend,
          saleInput({ nodeId: f.node.nodeId, seriesId: brandSeriesId(seriesId) }),
        ),
      );
      const [sale] = await selling.venue.select().from(sales).where(eq(sales.id, result.saleId));
      expect(sale?.invoiceNumber).toBe(917);
      const rows = await selling.venue.select().from(registrosFacturacion);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.saleId !== result.saleId)).toEqual(f.originalRecords);
      const allocation = (await selling.venue.select().from(fiscalAllocations)).find(
        (row) => row.eventKey === f.binding.eventId,
      )!;
      const issued = rows.find((row) => row.saleId === result.saleId);
      expect(issued).toMatchObject({
        saleId: result.saleId,
        sifId: allocation.sifId,
        primerRegistro: true,
        secuencia: 2,
      });
      expect(issued!.numSerieFactura).toBe(
        `${allocation.allocation.series.find((series) => series.purpose === "standard")!.code}/917`,
      );
      expect(networkCalls).toBe(0);
    } finally {
      await selling.close();
    }
  },
);

async function killRestore(f: Awaited<ReturnType<typeof stage>>, phase: string) {
  const migrationsRoot = join(f.root, "migrations");
  const sets = orderedMigrationSets(ALL_MODULES);
  const options = migrationOptionsFor(sets, null);
  for (let i = 0; i < options.length; i++)
    await cp(options[i]!.migrationsFolder, join(migrationsRoot, sets[i]!.name), {
      recursive: true,
    });
  const entry = join(f.root, "crash-entry.mjs");
  const binary = join(f.root, "crash-binary.mjs");
  const preload = join(f.root, "synthetic-clock.mjs");
  await writeFile(
    preload,
    `import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
const OriginalDate = Date;
const started = OriginalDate.now();
const fixed = OriginalDate.parse("2026-10-16T12:40:00Z");
globalThis.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [fixed + OriginalDate.now() - started])); }
  static now() { return fixed + OriginalDate.now() - started; }
};
https.request = (url, options, receive) => {
  if (url.protocol !== "https:" || options.method !== "HEAD" || options.rejectUnauthorized !== true) throw new Error("unexpected clock request");
  const request = new EventEmitter();
  request.end = () => receive({ headers: { date: new Date().toUTCString() }, statusCode: 200, destroy() {} });
  return request;
};
syncBuiltinESMExports();
`,
  );
  await writeFile(
    entry,
    `
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { writeSync } from "node:fs";
import { runStagedRestore } from ${JSON.stringify(resolve("src/restore-request.ts"))};
const [stateDir, venueDir, migrationsRoot, phase] = process.argv.slice(2);
const wait = async () => { console.log("RECOVERY_CRASH_GATE"); await new Promise(() => { setInterval(() => {}, 1000); }); };
if (phase === "staged" || phase === "hour-selected") await wait();
const original = nativeFs.writeFile;
nativeFs.writeFile = async (path, ...args) => {
  if (phase === "before-publication" && String(path) === join(stateDir, "trading.env.tmp")) await wait();
  return original(path, ...args);
};
syncBuiltinESMExports();
await runStagedRestore({ stateDir, venueDir, migrationsRoot, log: (_level, event, fields) => {
  if (phase === "before-commit" && event === "restore.hook.done" && fields?.module === "fiscal-verifactu") { writeSync(1,"RECOVERY_CRASH_GATE\\n"); process.kill(process.pid,"SIGSTOP"); }
} });
if (phase === "before-first-sale") await wait();
throw new Error("publication gate was not reached");
`,
  );
  const buildScript = join(f.root, "build-command.mjs");
  await writeFile(
    buildScript,
    `import { bundle } from ${JSON.stringify(new URL("../../../scripts/bundle-node.mjs", import.meta.url).href)};
bundle([{ entry: ${JSON.stringify(entry)}, outfile: ${JSON.stringify(binary)} }], { release: { sourceCommit: "${"a".repeat(40)}", committedAt: "2026-10-15T00:00:00.000Z", instantMs: Date.parse("2026-10-15T00:00:00Z"), generator: "scripts/generate-hour-release.mjs:v1", generatorSha256: "${"b".repeat(64)}" } });
`,
  );
  const built = spawnSync(process.execPath, [buildScript], { encoding: "utf8", timeout: 30_000 });
  expect(built.status, built.stderr).toBe(0);
  const child = spawn(
    process.execPath,
    ["--import", preload, binary, f.stateDir, f.venueDir, migrationsRoot, phase],
    { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );
  let output = "";
  const ready = new Promise<void>((resolveReady) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("RECOVERY_CRASH_GATE\n")) resolveReady();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
  });
  const deadline = AbortSignal.timeout(15_000);
  const timedOut = new Promise<never>((_resolve, reject) => {
    deadline.addEventListener("abort", () => reject(new Error(`crash gate timed out: ${output}`)), {
      once: true,
    });
  });
  try {
    await Promise.race([
      ready,
      timedOut,
      exited.then((result) => {
        throw new Error(`child exited before gate: ${JSON.stringify(result)} ${output}`);
      }),
    ]);
    expect(child.pid).toBeGreaterThan(0);
    expect(child.kill("SIGKILL")).toBe(true);
    await expect(exited).resolves.toEqual({ code: null, signal: "SIGKILL" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
  return output;
}

it.each(["archive", "stream"] as const)(
  "a %s restore stopped after staging can start normally",
  async (kind) => {
    const f = await stage(kind);
    const journal = f.journal();
    await killRestore(f, "staged");
    expect(f.journal()).toBe(journal);
    await expect(f.run()).resolves.toBe(true);
    expect((await f.snapshot()).records).toEqual(f.originalRecords);
  },
);
it.each(["archive", "stream"] as const)(
  "a completed %s restore stopped before its first sale does not activate twice",
  async (kind) => {
    const f = await stage(kind);
    await killRestore(f, "before-first-sale");
    const before = await f.snapshot();
    const journal = f.journal();
    await expect(f.run()).resolves.toBe(false);
    expect(f.journal()).toBe(journal);
    expect(await f.snapshot()).toEqual(before);
    expect(before.allocations).toHaveLength(2);
    expect(before.records).toEqual(f.originalRecords);
  },
);
for (const kind of ["archive", "stream"] as const)
  for (const phase of ["hour-selected", "before-commit"]) {
    it(`retains the ${kind} spent hour when killed at ${phase} without a local committed result`, async () => {
      const f = await stage(kind);
      await killRestore(f, phase);
      const journal = f.journal();
      expect(journal).toContain("06RC");
      const priorIntent = JSON.parse(journal).revisions;
      if (phase === "before-commit") {
        const original = await f.snapshot();
        expect(original.allocations.map((row) => row.installationIdentity)).toEqual(["06RB"]);
        expect(original.records).toEqual(f.originalRecords);
        await expect(f.run()).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "prior_activation_requires_replay" },
        });
        expect(await f.snapshot()).toEqual(original);
      }
      await expect(f.nextEvent()).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "hour_not_later" },
      });
      expect(f.journal()).toBe(journal);
      await f.freshStage();
      await expect(f.run()).resolves.toBe(true);
      expect(JSON.parse(f.journal()).revisions.slice(0, priorIntent.length)).toEqual(priorIntent);
      const active = await f.snapshot();
      expect(active.allocations).toHaveLength(2);
      expect(active.allocations.map((row) => row.installationIdentity)).toEqual(["06RB", "06RD"]);
      expect(active.allocations[1]!.eventKey).toBe("fresh-after-interruption");
      expect(active.records).toEqual(f.originalRecords);
    });
  }
