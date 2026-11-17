import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import * as threads from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveInWorker, archiveTo, connectionPair, drizzleNodeSqlite } from "./index.js";

vi.mock("node:worker_threads", { spy: true });

const directories: string[] = [];
const connections: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (connections.length) connections.pop()!.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(large = false) {
  const dir = mkdtempSync(join(tmpdir(), "waitron-worker-archive-"));
  directories.push(dir);
  const source = join(dir, "venue.db");
  const target = join(dir, "it's a backup.db");
  const db = new DatabaseSync(source);
  connections.push(db);
  db.exec("pragma journal_mode = wal; create table sales (id integer primary key, total integer)");
  db.exec("insert into sales values (1, 250); create table photos (bytes blob)");
  if (large) db.exec("insert into photos values (zeroblob(104857600))");
  return { db, source, target };
}

function rows(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare("select name from sqlite_schema where type = 'table' order by name")
      .all()
      .map(({ name }) => ({
        name,
        rows: db.prepare(`select * from "${String(name).replaceAll('"', '""')}"`).all(),
      }));
  } finally {
    db.close();
  }
}

async function untilWriting(target: string) {
  await vi.waitFor(() => expect(statSync(`${target}.partial`).size).toBeGreaterThan(0), {
    interval: 1,
  });
}

async function timerGap(copy: () => Promise<void>) {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 20);
  try {
    await delay(25);
    await copy();
    await delay(25);
    return longest;
  } finally {
    clearInterval(timer);
  }
}

describe("archiveInWorker", () => {
  it("copies every table like the main-thread copy, including committed WAL rows", async () => {
    const { db, source, target } = fixture();
    const main = `${target}.main`;
    await archiveTo(drizzleNodeSqlite(connectionPair(db, db), { schema: {} }), main);
    writeFileSync(`${target}.partial`, "left over");
    await archiveInWorker(source, target);
    expect(rows(target)).toEqual(rows(main));
    expect(rows(target)).toEqual([
      { name: "photos", rows: [] },
      { name: "sales", rows: [{ id: 1, total: 250 }] },
    ]);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it("keeps the main thread's 20 ms timer gaps below 50 ms during a 100 MB copy", async () => {
    const { source, target } = fixture(true);
    expect(await timerGap(() => archiveInWorker(source, target))).toBeLessThan(50);
  });

  it("the same main-thread copy stalls the timer beyond 50 ms", async () => {
    const { db, target } = fixture(true);
    expect(
      await timerGap(() =>
        archiveTo(drizzleNodeSqlite(connectionPair(db, db), { schema: {} }), target),
      ),
    ).toBeGreaterThan(50);
  });

  it("creates an owner-only working file, publishes only the completed copy, and permits sales", async () => {
    const { db, source, target } = fixture(true);
    const copy = archiveInWorker(source, target);
    await untilWriting(target);
    expect(existsSync(target)).toBe(false);
    expect(statSync(`${target}.partial`).mode & 0o777).toBe(0o600);
    db.exec("begin immediate; insert into sales values (2, 400); commit");
    expect(db.prepare("select total from sales where id = 2").get()).toEqual({ total: 400 });
    await copy;
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(existsSync(`${target}.partial`)).toBe(false);
    const backup = new DatabaseSync(target, { readOnly: true });
    try {
      expect(backup.prepare("pragma integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(backup.prepare("select * from sales").all()).toEqual([{ id: 1, total: 250 }]);
    } finally {
      backup.close();
    }
  });

  it("waits for a running copy, then discards it on abort before answering", async () => {
    const { Worker } = await vi.importActual<typeof threads>("node:worker_threads");
    let exitCode: number | undefined;
    vi.mocked(threads.Worker).mockImplementationOnce(function (...args) {
      const worker = new Worker(...args);
      worker.once("exit", (code) => {
        exitCode = code;
      });
      return worker;
    });
    const { source, target } = fixture(true);
    const controller = new AbortController();
    const copy = archiveInWorker(source, target, controller.signal);
    const refused = expect(copy).rejects.toMatchObject({ name: "AbortError" });
    await untilWriting(target);
    controller.abort();
    await refused;
    expect(exitCode).toBe(0);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it("does not start an already aborted copy", async () => {
    const { source, target } = fixture();
    await expect(archiveInWorker(source, target, AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it("rejects a worker's database failure and cleans up", async () => {
    const { source, target } = fixture();
    await expect(archiveInWorker(`${source}.missing`, target)).rejects.toMatchObject({
      message: expect.stringContaining("unable to open database"),
    });
    expect(existsSync(`${source}.missing`)).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it("cleans up when the worker cannot start", async () => {
    const { source, target } = fixture();
    const error = new Error("worker resource limit");
    vi.spyOn(threads, "Worker").mockImplementationOnce(function () {
      throw error;
    });
    await expect(archiveInWorker(source, target)).rejects.toBe(error);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it("refuses to publish a copy when the worker exits without completing", async () => {
    const { source, target } = fixture();
    const Worker = threads.Worker;
    vi.spyOn(threads, "Worker").mockImplementationOnce(function () {
      return new Worker("process.exit(7)", { eval: true });
    });
    await expect(archiveInWorker(source, target)).rejects.toThrow(
      "Archive worker exited with code 7",
    );
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });
});
