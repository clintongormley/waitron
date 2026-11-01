import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as store from "@waitron/store";
import * as placement from "./backup-data-placement.js";
import { verifyBackupArtifact } from "./backup-verification-entry.js";

vi.mock("node:fs/promises", { spy: true });
import {
  logicalDatabase,
  useBackupVerificationFixture,
} from "./testing/backup-verification-fixture.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";

const realFs = await vi.importActual<typeof fs>("node:fs/promises");
const suite = useBackupVerificationFixture();
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.rm).mockImplementation(realFs.rm);
});
const cleanEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  NODE_OPTIONS: "",
};

it("real bundled verifier passes with workers denied while ordinary opens still require them", async () => {
  const f = await suite.create();
  const original = await readFile(f.deps.artifactPath);
  const root = await realpath(f.root);
  f.deps.artifactPath = f.deps.artifactPath.replace(f.root, root);
  f.deps.scratchRoot = f.deps.scratchRoot.replace(f.root, root);
  const bundle = join(root, "permission-runner.mjs");
  const verifier = join(root, "backup-verification.mjs");
  const ordinarySource = join(root, "ordinary-controls.ts");
  const ordinaryBundle = join(root, "ordinary-controls.mjs");
  const migrationsRoot = join(root, "drizzle");
  const input = join(root, "request.json");
  await copyMigrationsRoot(migrationsRoot);
  await symlink(resolve("node_modules"), join(root, "node_modules"));
  await writeFile(
    ordinarySource,
    `
    export { openVenueDatabase } from "@waitron/db";
    export { runningWatchdog } from ${JSON.stringify(resolve("../../packages/store/src/venue-liveness.ts"))};
  `,
  );
  await writeFile(
    bundle,
    `
    import assert from "node:assert/strict";
    import { readFile, readdir, mkdir } from "node:fs/promises";
    import { join } from "node:path";
    import { Worker } from "node:worker_threads";
    import { BACKUP_VERIFICATION_MODULES, currentBackupVerificationTarget, verifyBackupArtifact } from ${JSON.stringify(verifier)};
    import { openVenueDatabase, runningWatchdog } from ${JSON.stringify(ordinaryBundle)};
    import { DatabaseSync } from "node:sqlite";
    async function snapshot(query) {
      const tables = [];
      for await (const row of query.rows("select name from sqlite_schema where type='table' order by name")) tables.push(row.name);
      const result = {};
      for (const name of tables) {
        const rows = [];
        for await (const row of query.rows('select * from "' + name.replaceAll('"', '""') + '"')) rows.push(JSON.stringify(row, (_key, value) => typeof value === "bigint" ? {integer: String(value)} : value instanceof Uint8Array ? {bytes: Buffer.from(value).toString("hex")} : value));
        result[name] = rows.sort();
      }
      return result;
    }
    if (process.argv[2] === "target") {
      console.log(JSON.stringify(currentBackupVerificationTarget()));
    } else {
      const f = JSON.parse(await readFile(process.argv[2], "utf8"));
      await mkdir(f.ordinary, {recursive: true});
      if (process.argv[3] === "ordinary") {
        const a = await openVenueDatabase(f.ordinary);
        const worker = runningWatchdog();
        assert(worker instanceof Worker);
        const b = await openVenueDatabase(f.ordinary);
        await a.close();
        assert.equal(runningWatchdog(), worker);
        await b.close();
        assert.equal(runningWatchdog(), undefined);
        console.log(JSON.stringify({ordinaryMonitored: true}));
      } else {
        let workerDenied;
        try { new Worker("", {eval: true}); } catch (e) { workerDenied = {code:e.code, permission:e.permission}; }
        assert.deepEqual(workerDenied, {code:"ERR_ACCESS_DENIED",permission:"WorkerThreads"});
        let compared = false;
        const modules = BACKUP_VERIFICATION_MODULES.map(m => m.name !== "core" ? m : ({...m, backup:{...m.backup, verification:{...m.backup.verification, verifyRestoredData:async context => {
          assert.deepEqual(await snapshot(context.before), f.logical);
          assert.deepEqual(await snapshot(context.after), f.logical);
          compared = true;
          return m.backup.verification.verifyRestoredData(context);
        }}}}));
        const result = await verifyBackupArtifact(f.request, {...f.deps, modules, signal:new AbortController().signal, now:()=>new Date(f.now)});
        let ordinaryRefusal;
        try { const ordinary = await openVenueDatabase(f.ordinary); await ordinary.close(); } catch(e) { ordinaryRefusal={code:e.code,permission:e.permission}; }
        const lock = new DatabaseSync(join(f.ordinary,"venue.lock"));
        try { lock.exec("begin immediate"); } finally { lock.close(); }
        console.log(JSON.stringify({result, compared, workerDenied, ordinaryRefusal, ordinaryFiles:await readdir(f.ordinary), scratch:await readdir(f.deps.scratchRoot)}));
      }
    }
  `,
  );
  const built = spawnSync(
    process.execPath,
    [
      resolve("../../scripts/bundle-node.mjs"),
      `src/backup-verification-entry.ts=${verifier}`,
      `${ordinarySource}=${ordinaryBundle}`,
    ],
    {
      encoding: "utf8",
      env: cleanEnv,
      timeout: 180_000,
    },
  );
  expect(built.error).toBeUndefined();
  expect(built.status, built.stderr).toBe(0);
  const targetRead = spawnSync(process.execPath, [bundle, "target"], {
    encoding: "utf8",
    env: cleanEnv,
    timeout: 10_000,
  });
  expect(targetRead.error).toBeUndefined();
  expect(targetRead.status, targetRead.stderr).toBe(0);
  f.request.target = JSON.parse(targetRead.stdout);
  f.deps.runtime = f.request.target.runtime;
  f.deps.migrationsRoot = migrationsRoot;
  const ordinary = join(root, "ordinary");
  await mkdir(ordinary);
  await writeFile(
    input,
    JSON.stringify({
      request: f.request,
      deps: { ...f.deps, modules: undefined, signal: undefined, now: undefined },
      logical: f.logical,
      ordinary,
      now: f.deps.now().toISOString(),
    }),
    { mode: 0o600 },
  );
  const child = spawnSync(
    process.execPath,
    [
      "--permission",
      `--allow-fs-read=${resolve("../..")}`,
      `--allow-fs-read=${root}`,
      `--allow-fs-write=${f.deps.scratchRoot}`,
      `--allow-fs-write=${ordinary}`,
      bundle,
      input,
    ],
    { encoding: "utf8", env: cleanEnv, timeout: 45_000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const answer = JSON.parse(child.stdout);
  expect(answer.workerDenied).toEqual({ code: "ERR_ACCESS_DENIED", permission: "WorkerThreads" });
  expect(answer.ordinaryRefusal).toEqual({
    code: "ERR_ACCESS_DENIED",
    permission: "WorkerThreads",
  });
  expect(answer.ordinaryFiles).toEqual(["venue.lock"]);
  expect(answer.result).toMatchObject({
    status: "passed",
    reason: "none",
    activation: "not_attempted",
    measuredArchive: { sha256: f.request.archive.sha256, bytes: f.request.archive.bytes },
  });
  expect(answer.result.modules.map((m: { name: string }) => m.name)).toEqual(
    f.request.target.modules.map((m) => m.name),
  );
  expect(answer.result.modules.every((m: { status: string }) => m.status === "passed")).toBe(true);
  expect(answer.compared).toBe(true);
  expect(answer.scratch).toEqual([]);
  const permitted = spawnSync(process.execPath, [bundle, input, "ordinary"], {
    encoding: "utf8",
    env: cleanEnv,
    timeout: 15_000,
  });
  expect(permitted.error).toBeUndefined();
  expect(permitted.status, permitted.stderr).toBe(0);
  expect(JSON.parse(permitted.stdout)).toEqual({ ordinaryMonitored: true });
  expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
  expect(await readFile(f.deps.artifactPath)).toEqual(original);
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
}, 300_000);

it.each(["directory removal", "query close"])(
  "%s uncertainty cannot pass verification",
  async (failure) => {
    const f = await suite.create();
    const originalRm = realFs.rm;
    const originalOpen = store.openBackupQuery;
    let reached = false;
    if (failure === "directory removal") {
      vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
        if (String(path).split("/").at(-1)?.startsWith("verification-venue-")) {
          reached = true;
          throw new Error("copy removal refused");
        }
        return originalRm(path, options);
      });
    } else {
      vi.spyOn(store, "openBackupQuery").mockImplementation(async (path) => {
        const opened = await originalOpen(path);
        if (!path.includes("verification-venue-")) return opened;
        return {
          ...opened,
          close: async () => {
            await opened.close();
            reached = true;
            throw new Error("query close refused");
          },
        };
      });
    }
    expect(await verifyBackupArtifact(f.request, f.deps)).toMatchObject({
      status: "unavailable",
      reason: "cleanup_uncertain",
      activation: "not_attempted",
    });
    expect(reached).toBe(true);
    expect(await readdir(f.deps.scratchRoot)).toEqual([]);
    expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
  },
);

it("an ordinary verification passes after the cleanup failure cases", async () => {
  const f = await suite.create();
  expect(await verifyBackupArtifact(f.request, f.deps)).toMatchObject({
    status: "passed",
    reason: "none",
    activation: "not_attempted",
  });
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
});

it.each(["success", "owner refusal"])(
  "closes the placed query before removing its directory after %s",
  async (outcome) => {
    const f = await suite.create();
    const originalOpen = store.openBackupQuery;
    const originalRm = realFs.rm;
    let placedQuery: store.BackupQuery | undefined;
    let checked = false;
    vi.spyOn(store, "openBackupQuery").mockImplementation(async (path) => {
      const opened = await originalOpen(path);
      if (path.includes("verification-venue-")) placedQuery = opened.query;
      return opened;
    });
    vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
      if (String(path).split("/").at(-1)?.startsWith("verification-venue-")) {
        expect(placedQuery).toBeDefined();
        await expect(
          placedQuery!.rows("select 1")[Symbol.asyncIterator]().next(),
        ).rejects.toThrow();
        checked = true;
      }
      return originalRm(path, options);
    });
    if (outcome === "owner refusal")
      f.deps.modules = f.deps.modules.map((m) =>
        m.name !== "core"
          ? m
          : {
              ...m,
              backup: {
                ...m.backup,
                verification: {
                  ...m.backup!.verification!,
                  verifyRestoredData: async () => {
                    throw new Error("owner refused");
                  },
                },
              },
            },
      );
    const result = await verifyBackupArtifact(f.request, f.deps);
    expect(result.status).toBe(outcome === "success" ? "passed" : "unavailable");
    expect(result.reason).toBe(outcome === "success" ? "none" : "unexpected");
    expect(checked).toBe(true);
    expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  },
);

it.each(["placement failure", "cancellation"])("cleans the copy after %s", async (failure) => {
  const f = await suite.create();
  const originalPlace = placement.placeBackupData;
  const controller = new AbortController();
  f.deps.signal = controller.signal;
  vi.spyOn(placement, "placeBackupData").mockImplementation(async (...args) => {
    await originalPlace(...args);
    if (failure === "placement failure") throw new Error("placement refused");
    controller.abort();
  });
  const result = await verifyBackupArtifact(f.request, f.deps);
  expect(result).toMatchObject({
    status: "unavailable",
    reason: failure === "placement failure" ? "unexpected" : "cancelled",
    activation: "not_attempted",
  });
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
});
