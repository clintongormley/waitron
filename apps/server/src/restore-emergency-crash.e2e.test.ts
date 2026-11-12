import { resultFacts } from "./testing/restore-result-facts.js";
import { spawn, spawnSync } from "node:child_process";
import { emptyScratch } from "./scratch.js";
import { firstStartPending } from "./restore-flow.js";
import { syncBuiltinESMExports } from "node:module";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openVenueDatabase, readStandardSeriesId, withTransaction } from "@waitron/db";
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
  fixture = await stagedHourCrash(suite, kind, "emergency-offline-restore");
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

it.each([
  ["archive", "before-publication", true],
  ["stream", "after-publication", false],
  ["archive", "before-completion", false],
] as const)(
  "an interrupted %s restore at %s starts over and reaches the uninterrupted result",
  async (kind, phase, corrupt) => {
    const f = await stage(kind);
    const previousIdentity = `# the original box\nWAITRON_NODE_ID=${f.node.nodeId}\nWAITRON_ENV=preproduction\n`;
    await writeFile(join(f.stateDir, "trading.env"), previousIdentity);
    await f.seedDestination();
    await writeFile(join(f.stateDir, "setup-operation.json"), "pending operation");
    if (kind === "archive") {
      const old = await openVenueDatabase(f.venueDir);
      try {
        const backend = new VerifactuBackend({
          db: old.venue,
          deploymentEnvironment: "preproduction",
          clock: {
            ...steadyClock,
            now: () => ({ ...steadyClock.now(), instant: new Date("2026-10-16T12:39:00Z") }),
          },
          resolveClient: async () => {
            throw new Error("this restore has no network");
          },
        });
        const seriesId = await readStandardSeriesId(old.venue, f.node.nodeId);
        await withTransaction(old.venue, (tx) =>
          recordSale(
            tx,
            backend,
            saleInput({ nodeId: f.node.nodeId, seriesId: brandSeriesId(seriesId) }),
          ),
        );
        expect(await old.venue.select().from(registrosFacturacion)).toHaveLength(2);
      } finally {
        await old.close();
      }
    }
    await killRestore(f, phase);
    const committed = await f.snapshot();
    if (phase === "before-completion")
      await expect(readFile(join(f.stateDir, "setup-operation.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    expect(committed.records).toEqual(f.originalRecords);
    expect(committed.allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNW",
      "0CNQR",
    ]);
    expect(
      committed.series
        .filter((row) => row.retiredAt === null)
        .map((row) => [row.code, row.nextNumber]),
    ).toEqual([
      ["A-0CNQR", 1],
      ["FF-0CNQR", 1],
      ["R-0CNQR", 1],
    ]);
    const journal = f.journal();
    if (corrupt) await writeFile(join(f.venueDir, "venue.db"), "corrupt partial database");
    else await f.advanceCounters();
    await expect(f.run()).resolves.toBe(true);
    expect(resultFacts(await f.snapshot(), "numeroInstalacion")).toEqual(
      resultFacts(committed, "numeroInstalacion"),
    );
    expect(f.journal()).toBe(journal);
    expect(await readFile(join(f.stateDir, "trading.env.replaced"), "utf8")).toBe(previousIdentity);
    await expectFinishedRetry(f, journal);
  },
);

async function expectFinishedRetry(f: Awaited<ReturnType<typeof stage>>, journal: string) {
  expect(f.journal()).toBe(journal);
  const active = await f.snapshot();
  expect(active.records).toEqual(f.originalRecords);
  expect(active.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW", "0CNQR"]);
  expect(active.allocations.slice(0, 1)).toEqual(await suite.db.select().from(fiscalAllocations));
  expect(active.allocations.filter((row) => row.eventKey === f.binding.eventId)).toHaveLength(1);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
  expect(
    JSON.parse(await readFile(join(f.stateDir, "flows/restore/record.json"), "utf8")),
  ).toHaveProperty("phase", "first-start");
  for (const file of [
    "flows/restore/node-key",
    "flows/restore/artifact",
    "flows/restore/key",
    "flows/restore/venue.db",
    "flows/restore/entries",
    "flows/restore/placement.db",
  ])
    await expect(readFile(join(f.stateDir, file))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(f.run()).resolves.toBe(false);
  expect(await f.snapshot()).toEqual(active);
}

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
import { runStagedRestore, stageRestoreRequest } from ${JSON.stringify(resolve("src/restore-request.ts"))};
import { endRestoreFlow } from ${JSON.stringify(resolve("src/restore-flow.ts"))};
import { lockRestoreTarget } from ${JSON.stringify(resolve("src/restore.ts"))};
const [stateDir, venueDir, migrationsRoot, phase] = process.argv.slice(2);
const wait = async () => { console.log("RECOVERY_CRASH_GATE"); await new Promise(() => { setInterval(() => {}, 1000); }); };
if (phase === "staged" || phase === "hour-selected") await wait();
const original = nativeFs.rename;
nativeFs.rename = async (from, to) => {
  if (phase === "before-completion" && String(to) === join(stateDir, "flows/restore/record.json") && JSON.parse(await nativeFs.readFile(from, "utf8")).phase === "first-start") await wait();
  if (phase === "before-publication" && String(to) === join(stateDir, "trading.env")) await wait();
  const result = await original(from, to);
  if (phase === "after-publication" && String(to) === join(stateDir, "trading.env")) await wait();
  if (phase === "staging-artifact" && String(to).includes("/scratch/restore-flow-") && String(to).endsWith("/artifact")) await wait();
  if (phase === "after-publish" && String(to) === join(stateDir, "flows/restore")) await wait();
  if (phase === "after-end" && String(from) === join(stateDir, "flows/restore")) await wait();
  if (phase === "first-start-record" && String(to) === join(stateDir, "flows/restore/record.json") && JSON.parse(await nativeFs.readFile(to, "utf8")).phase === "first-start") await wait();
  return result;
};
const remove = nativeFs.rm;
let removalStarted = false;
nativeFs.rm = async (path, options) => {
  if (["artifact-gone", "key-gone"].includes(phase) && String(path).startsWith(join(stateDir, "flows/restore/")) && !String(path).endsWith("record.json.tmp")) {
    const selected = phase === "artifact-gone" ? "artifact" : phase === "key-gone" ? "key" : "node-key";
    if (String(path) === join(stateDir, "flows/restore", selected) && !removalStarted) {
      removalStarted = true;
      await remove(path, options);
      await wait();
    }
    await new Promise(() => {});
  }
  return remove(path, options);
};
syncBuiltinESMExports();
if (phase === "after-end") { const hold = await lockRestoreTarget(venueDir); try { await endRestoreFlow(stateDir); } finally { hold.release(); } }
if (phase === "after-publish" || phase === "staging-artifact") {
  const record = JSON.parse(await nativeFs.readFile(join(stateDir, "flows/restore/record.json"), "utf8"));
  const artifact = await nativeFs.readFile(join(stateDir, "flows/restore/artifact"));
  const recoveryKey = await nativeFs.readFile(join(stateDir, "flows/restore/key"), "utf8");
  const nodeRecoverySecret = await nativeFs.readFile(join(stateDir, "flows/restore/node-key"), "utf8");
  const hold = await lockRestoreTarget(venueDir);
  try { if (phase === "staging-artifact") await endRestoreFlow(stateDir); await stageRestoreRequest(stateDir, { ...record.request, artifact, recoveryKey, nodeRecoverySecret }); } finally { hold.release(); }
}
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
      expect(journal).toContain("0CNQR");
      const priorIntent = JSON.parse(journal).revisions;
      if (phase === "before-commit") {
        const original = await f.snapshot();
        expect(original.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW"]);
        expect(original.records).toEqual(f.originalRecords);
        await expect(f.run()).resolves.toBe(true);
        await expectFinishedRetry(f, journal);
        expect((await f.snapshot()).allocations.slice(0, 1)).toEqual(original.allocations);
        return;
      }
      // The settle wait alone ends at 12:40, the killed restore's name (0CNQR).
      vi.setSystemTime(new Date("2026-10-16T12:38:00Z"));
      await expect(f.nextEvent()).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "minute_in_use", allowedFromMs: Date.parse("2026-10-16T12:41:00Z") },
      });
      expect(f.journal()).toBe(journal);
      await f.freshStage();
      await expect(f.run()).resolves.toBe(true);
      expect(JSON.parse(f.journal()).revisions.slice(0, priorIntent.length)).toEqual(priorIntent);
      const active = await f.snapshot();
      expect(active.allocations).toHaveLength(2);
      expect(active.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW", "0CNSM"]);
      expect(active.allocations[1]!.eventKey).toBe("fresh-after-interruption");
      expect(active.records).toEqual(f.originalRecords);
    });
  }

it.each([
  "after-publish",
  "first-start-record",
  "artifact-gone",
  "key-gone",
  "staging-artifact",
  "after-end",
])("a restore killed at %s completes once and leaves no private attachment", async (phase) => {
  const f = await stage("archive");
  if (phase === "after-end") await f.run();
  await killRestore(f, phase);
  await emptyScratch(f.stateDir, vi.fn());
  if (phase === "staging-artifact") {
    await expect(f.run()).resolves.toBe(false);
    expect(await firstStartPending(f.stateDir)).toBeNull();
    expect(await readdir(join(f.stateDir, "scratch"))).toEqual([]);
    return;
  }
  const before = phase === "after-publish" ? undefined : await f.snapshot();
  const journal = f.journal();
  expect(await f.run()).toBe(phase === "after-publish");
  const after = await f.snapshot();
  expect(after.records).toEqual(f.originalRecords);
  expect(after.allocations).toHaveLength(2);
  if (phase !== "after-publish") {
    expect(after).toEqual(before);
    expect(f.journal()).toBe(journal);
  }
  for (const name of ["key", "node-key", "venue.db", "placement.db", "artifact", "entries"]) {
    await expect(readFile(join(f.stateDir, "flows/restore", name))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
  expect(await firstStartPending(f.stateDir)).toEqual(
    phase === "after-end" ? null : { source: "archive" },
  );
  await emptyScratch(f.stateDir, vi.fn());
  expect(await readdir(join(f.stateDir, "scratch"))).toEqual([]);
  const completed = f.journal();
  await expect(f.run()).resolves.toBe(false);
  expect(f.journal()).toBe(completed);
  expect(await f.snapshot()).toEqual(after);
});
