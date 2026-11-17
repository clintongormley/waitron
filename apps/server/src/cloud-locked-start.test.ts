import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import type { BackupQuery, BackupRow } from "@waitron/store";
import { openLockedCopy } from "./cloud-locked-start.js";
import { bindingFor, copyId, seedEmergencyCopySource } from "./testing/emergency-copy-source.js";
import { sha } from "./testing/place-copy-box.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
let root: string;
let venueDir: string;
let stateDir: string;
let opened: Awaited<ReturnType<typeof openLockedCopy>> | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cloud-locked-start-"));
  venueDir = join(root, "venue");
  stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  await seedEmergencyCopySource(suite.db);
});
afterEach(async () => {
  await opened?.close();
  opened = undefined;
  await rm(root, { recursive: true, force: true });
});

async function placement() {
  const path = join(venueDir, "venue.db");
  await suite.db.archiveTo(path);
  return {
    binding: bindingFor(sha(path)),
    venueDir,
    stateDir,
    environment: "preproduction" as const,
    processEnv: {},
    migrationsRoot: null,
    modules: [],
    now: () => new Date("2026-11-17T10:10:00.000Z"),
  };
}

async function rows(query: BackupQuery, sql: string) {
  const result: BackupRow[] = [];
  for await (const row of query.rows(sql)) result.push(row);
  return result;
}

function outsideLock() {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    try { db.exec("pragma busy_timeout=0; begin immediate"); console.log("acquired"); }
    catch (error) { if (error.errcode !== 5) throw error; console.log("held"); }
    finally { db.close(); }
  `,
      join(venueDir, "venue.lock"),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function snapshot() {
  const files: Record<string, string> = {};
  for (const [prefix, dir] of [
    ["venue", venueDir],
    ["state", stateDir],
  ]) {
    for (const name of (await readdir(dir!)).sort()) {
      if (
        name === "scratch" ||
        name === "venue.lock" ||
        name === "venue.lock-journal" ||
        name === "venue.holder.json"
      )
        continue;
      files[`${prefix}/${name}`] = sha(join(dir!, name));
    }
  }
  return files;
}

it("keeps the placed copy immutable and its folder held until both readers close", async () => {
  const deps = await placement();
  opened = await openLockedCopy(deps);
  const before = await snapshot();
  expect(outsideLock()).toBe("held");
  expect(await rows(opened.venue, "select id from nodes")).toEqual([
    { id: deps.binding.sourceNodeId },
  ]);
  expect(await rows(opened.node, "select node_id, mode from box")).toEqual([
    { node_id: copyId, mode: "mirror" },
  ]);
  await opened.close();
  expect(outsideLock()).toBe("acquired");
  expect(await snapshot()).toEqual(before);
  expect(sha(join(venueDir, "venue.db"))).toBe(deps.binding.selectedStream.databaseSha256);
  await expect(rows(opened.venue, "select 1")).rejects.toThrow();
  await expect(rows(opened.node, "select 1")).rejects.toThrow();
  opened = await openLockedCopy(deps);
  expect(outsideLock()).toBe("held");
  await opened.close();
  expect(await snapshot()).toEqual(before);
});

it("releases its folder hold when placement refuses an expired copy", async () => {
  const deps = await placement();
  await expect(
    openLockedCopy({ ...deps, now: () => new Date(deps.binding.expiresAt) }),
  ).rejects.toMatchObject({ code: "emergency_copy.binding_expired" });
  expect(outsideLock()).toBe("acquired");
});
