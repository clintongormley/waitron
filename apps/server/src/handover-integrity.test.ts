import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCopyIntact } from "./handover-integrity.js";

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "handover-integrity-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function database(): string {
  const path = join(scratch, "copy.db");
  const db = new DatabaseSync(path);
  db.exec("create table one(a text); insert into one values ('x')");
  db.close();
  return path;
}

/** A thread running `source` in place of the real check, told what the real one is told. */
const running = (source: string) => (_real: string, options: WorkerOptions) =>
  new Worker(source, options);

describe("isCopyIntact", () => {
  it("control: a sound database reads as intact", async () => {
    expect(await isCopyIntact(database())).toBe(true);
  });

  it("a file that is not a database does not", async () => {
    const path = join(scratch, "copy.db");
    await writeFile(path, "x".repeat(8192));
    expect(await isCopyIntact(path)).toBe(false);
  });

  it("a page overwritten in a real database does not", async () => {
    const path = join(scratch, "copy.db");
    const db = new DatabaseSync(path);
    db.exec(`create table one(a text);
      with recursive n(i) as (select 1 union all select i+1 from n where i < 5000)
      insert into one select hex(randomblob(32)) from n;
      create index one_a on one(a)`);
    db.close();
    const file = await open(path, "r+");
    await file.write(Buffer.alloc(4096 * 4, 0xff), 0, 4096 * 4, 4096 * 8);
    await file.close();
    expect(await isCopyIntact(path)).toBe(false);
  });

  it("a database the check reports a fault in, without failing to read, does not", async () => {
    const path = join(scratch, "copy.db");
    const db = new DatabaseSync(path, { defensive: false });
    db.exec(`create table one(a text);
      insert into one values (null);
      pragma writable_schema = on;
      update sqlite_schema set sql = 'create table one(a text not null)' where name = 'one';`);
    db.close();
    expect(await isCopyIntact(path)).toBe(false);
  });

  it("a path where no file is does not, and leaves no file behind", async () => {
    const path = join(scratch, "absent.db");
    expect(await isCopyIntact(path)).toBe(false);
    await expect(rm(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("gives the thread's own turn to other work: a timer runs before the answer", async () => {
    let turned = false;
    setImmediate(() => (turned = true));
    await isCopyIntact(database());
    // Failing case, a check on this thread answering at once: `false`.
    expect(turned).toBe(true);
  });

  it("leaves the copy unchanged and writes no side file", async () => {
    const path = database();
    const before = await readFile(path);
    await isCopyIntact(path);
    expect((await readFile(path)).equals(before)).toBe(true);
    expect(await readdir(scratch)).toEqual(["copy.db"]);
  });

  it("a thread that fails is a fault, never a damaged copy", async () => {
    const startWorker = running('throw new Error("no such thread")');
    await expect(isCopyIntact(database(), { startWorker })).rejects.toThrow("no such thread");
  });

  it("a thread that ends without answering is a fault, never a damaged copy", async () => {
    const startWorker = running("process.exit(3)");
    await expect(isCopyIntact(database(), { startWorker })).rejects.toThrow(/code 3/);
  });

  it("a stop already given starts no thread", async () => {
    const stopping = new AbortController();
    stopping.abort(new Error("stopping"));
    let started = 0;
    const startWorker = (source: string, options: WorkerOptions) => {
      started += 1;
      return new Worker(source, options);
    };
    await expect(
      isCopyIntact(database(), { signal: stopping.signal, startWorker }),
    ).rejects.toThrow("stopping");
    expect(started).toBe(0);
  });

  it("a stop during the check ends the thread", async () => {
    const stopping = new AbortController();
    let exited!: Promise<number>;
    const startWorker = (_source: string, options: WorkerOptions) => {
      const thread = new Worker("setInterval(() => {}, 1000)", options);
      exited = new Promise((resolve) => thread.once("exit", resolve));
      thread.once("online", () => stopping.abort(new Error("stopping")));
      return thread;
    };
    await expect(
      isCopyIntact(database(), { signal: stopping.signal, startWorker }),
    ).rejects.toThrow("stopping");
    // `terminate` ends a thread with code 1; failing case: the test times out on a thread left running.
    expect(await exited).toBe(1);
  });
});
