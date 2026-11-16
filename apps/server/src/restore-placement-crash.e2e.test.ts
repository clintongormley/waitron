import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { orderedMigrationSets } from "@waitron/module";
import { migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "./modules.js";
import { firstStartPending } from "./restore-flow.js";
import { stagedHourCrash } from "./testing/staged-hour-crash.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-time-service.js", () => ({
  observeTimeServiceHourClock: async () => ({
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
let root: string | undefined;
let fixture: Awaited<ReturnType<typeof stagedHourCrash>> | undefined;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "restore-placement-kill-"));
  const sets = orderedMigrationSets(ALL_MODULES);
  const options = migrationOptionsFor(sets, null);
  for (let i = 0; i < sets.length; i++)
    await cp(options[i]!.migrationsFolder, join(root, "migrations", sets[i]!.name), {
      recursive: true,
    });
  const entry = join(root, "entry.mjs");
  await writeFile(
    entry,
    `
import { writeSync } from "node:fs";
import { runStagedRestore } from ${JSON.stringify(resolve("src/restore-request.ts"))};
const [stateDir, venueDir, migrationsRoot, selected] = process.argv.slice(2);
await runStagedRestore({ stateDir, venueDir, migrationsRoot, timeServiceSynchronised: async () => true, log: (_level, event) => {
 if (event === selected) { writeSync(1, "PLACEMENT_GATE\\n"); process.kill(process.pid, "SIGSTOP"); }
} });
throw new Error("placement gate not reached");
`,
  );
  await writeFile(
    join(root, "clock.mjs"),
    `const OriginalDate = Date; const started = OriginalDate.now(); const fixed = OriginalDate.parse("2026-10-16T12:40:00Z"); globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [fixed + OriginalDate.now() - started])); } static now() { return fixed + OriginalDate.now() - started; } };`,
  );
  const build = join(root, "build.mjs");
  await writeFile(
    build,
    `import { bundle } from ${JSON.stringify(new URL("../../../scripts/bundle-node.mjs", import.meta.url).href)}; bundle([{ entry: ${JSON.stringify(entry)}, outfile: ${JSON.stringify(join(root, "child.mjs"))} }], { release: { sourceCommit: "${"a".repeat(40)}", committedAt: "2026-10-15T00:00:00.000Z", instantMs: Date.parse("2026-10-15T00:00:00Z"), generator: "scripts/generate-hour-release.mjs:v1", generatorSha256: "${"b".repeat(64)}" } });`,
  );
  const built = spawnSync(process.execPath, [build], { encoding: "utf8", timeout: 30_000 });
  expect(built.status, built.stderr).toBe(0);
});
afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
  vi.useRealTimers();
});
afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

it.each([
  ["staged", true, true],
  ["previous_moved", false, false],
  ["node_placed", false, true],
  ["venue_placed", true, true],
] as const)(
  "restarts a saved restore killed at %s with the new database pair",
  async (step, venuePresent, nodePresent) => {
    const f = (fixture = await stagedHourCrash(suite, "archive", `placement-${step}`));
    await f.seedDestination();
    const old = await openVenueDatabase(f.venueDir);
    try {
      for (const db of [old.venue, old.node])
        await db.run(sql`create table placement_marker (value text)`);
    } finally {
      await old.close();
    }
    vi.useRealTimers();
    const child = spawn(
      process.execPath,
      [
        "--import",
        join(root!, "clock.mjs"),
        join(root!, "child.mjs"),
        f.stateDir,
        f.venueDir,
        join(root!, "migrations"),
        `restore.db.${step}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (done, fail) => {
        child.once("error", fail);
        child.once("exit", (code, signal) => done({ code, signal }));
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gate = new Promise<void>((done, fail) => {
      child.stdout.on("data", (bytes: Buffer) => {
        output += bytes.toString();
        if (output.includes("PLACEMENT_GATE\n")) done();
      });
      child.stderr.on("data", (bytes: Buffer) => {
        output += bytes.toString();
      });
      timer = setTimeout(() => fail(new Error(`placement gate timeout: ${output}`)), 20_000);
    });
    try {
      await Promise.race([
        gate,
        exited.then((result) => {
          throw new Error(`child exited ${JSON.stringify(result)}: ${output}`);
        }),
      ]);
      expect(child.kill("SIGKILL")).toBe(true);
      expect(await exited).toEqual({ code: null, signal: "SIGKILL" });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
    const exists = async (name: string) =>
      stat(join(f.venueDir, name)).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
    expect([await exists("venue.db"), await exists("node.db")]).toEqual([
      venuePresent,
      nodePresent,
    ]);
    // Restart after the child's advancing clock, so its retained intent is not in the future.
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-16T12:41:00Z"));
    expect(await f.run()).toBe(true);
    const placed = await openVenueDatabase(f.venueDir);
    try {
      for (const db of [placed.venue, placed.node])
        expect(
          await db.all(sql`select name from sqlite_master where name = 'placement_marker'`),
        ).toEqual([]);
    } finally {
      await placed.close();
    }
    expect(await firstStartPending(f.stateDir)).toEqual({ source: "archive" });
    expect(await f.run()).toBe(false);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
  },
  60_000,
);
