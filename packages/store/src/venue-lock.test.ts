import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it } from "vitest";
import { lockVenueDirectory, openVenueStore, VenueInUseError, type VenueStore } from "./index.js";

const sales = sqliteTable("sales", { id: integer("id").primaryKey(), total: integer("total") });
const venueSchema = { sales };
const nodeSchema = {};

/** Node's startup on a loaded runner dominates each child; the bound clears several of them. */
const CHILD_TIMEOUT_MS = 20_000;

const opened: VenueStore<typeof venueSchema, typeof nodeSchema>[] = [];
const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  while (opened.length > 0) await opened.pop()!.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const tempDir = () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-venue-lock-"));
  directories.push(directory);
  return directory;
};
const openStore = async (directory: string, exclusive?: boolean) => {
  const store = await openVenueStore({ directory, venueSchema, nodeSchema, exclusive });
  opened.push(store);
  return store;
};

const TRY = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("pragma busy_timeout = 0");
try { db.exec("begin immediate"); process.stdout.write("acquired"); }
catch (error) { process.stdout.write("refused " + error.errcode); }
db.close();`;

const HOLD = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("pragma busy_timeout = 0");
db.exec("begin immediate");
process.stdout.write("held");
setInterval(() => {}, 1000);`;

function node(script: string, directory: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, join(directory, "venue.lock")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  return child;
}

function tryFromAnotherProcess(directory: string): Promise<string> {
  const child = node(TRY, directory);
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", reject);
    child.on("exit", () => resolve(out));
  });
}

function holdFromAnotherProcess(directory: string): Promise<ChildProcess> {
  const child = node(HOLD, directory);
  return new Promise((resolve, reject) => {
    let err = "";
    child.stderr!.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve(child);
    });
    child.on("exit", (code) => reject(new Error(`holder exited early (${code}): ${err}`)));
  });
}

const exited = (child: ChildProcess) =>
  new Promise<void>((resolve) => child.once("exit", () => resolve()));

describe("the venue folder's process lock", () => {
  it(
    "refuses a second process while one holds the folder, and leaves the first working",
    async () => {
      const directory = tempDir();
      const store = await openStore(directory);
      expect(await tryFromAnotherProcess(directory)).toBe("refused 5");
      store.venue.run(sql`create table sales (id integer primary key, total integer)`);
      store.venue.run(sql`insert into sales (id, total) values (1, 100)`);
      expect(store.venue.all(sql`select total from sales`)).toEqual([{ total: 100 }]);
      await store.close();
      expect(await tryFromAnotherProcess(directory)).toBe("acquired");
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "refuses to open, at once and before touching the databases, while another process holds it",
    async () => {
      const directory = tempDir();
      await holdFromAnotherProcess(directory);
      const started = Date.now();
      const refusal = await openVenueStore({ directory, venueSchema, nodeSchema }).catch(
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(VenueInUseError);
      expect((refusal as VenueInUseError).directory).toBe(directory);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(existsSync(join(directory, "venue.db"))).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "does not stay locked after the holder is killed",
    async () => {
      const directory = tempDir();
      const holder = await holdFromAnotherProcess(directory);
      await expect(openVenueStore({ directory, venueSchema, nodeSchema })).rejects.toBeInstanceOf(
        VenueInUseError,
      );
      holder.kill("SIGKILL");
      await exited(holder);
      const store = await openStore(directory);
      expect(store.venue.all(sql`select 1 as one`)).toEqual([{ one: 1 }]);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "shares the lock between opens in one process and gives it up with the last close",
    async () => {
      const directory = tempDir();
      const a = await openStore(directory);
      const b = await openStore(directory);
      await a.close();
      await a.close(); // a second close of the same store must not give up b's share
      expect(await tryFromAnotherProcess(directory)).toBe("refused 5");
      await b.close();
      expect(await tryFromAnotherProcess(directory)).toBe("acquired");
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "lets an open that asks for no lock sit beside a holder, and holds nothing itself",
    async () => {
      const directory = tempDir();
      const holder = await holdFromAnotherProcess(directory);
      const store = await openStore(directory, false);
      expect(store.venue.all(sql`select 1 as one`)).toEqual([{ one: 1 }]);
      holder.kill("SIGKILL");
      await exited(holder);
      expect(await tryFromAnotherProcess(directory)).toBe("acquired");
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    "gives the lock back when the open itself fails",
    async () => {
      const directory = tempDir();
      writeFileSync(join(directory, "node.db"), "these bytes are not a database".repeat(100));
      await expect(openVenueStore({ directory, venueSchema, nodeSchema })).rejects.toThrow(
        "file is not a database",
      );
      expect(await tryFromAnotherProcess(directory)).toBe("acquired");
    },
    CHILD_TIMEOUT_MS,
  );

  it("reports a lock file it cannot open as the engine reported it, not as in use", async () => {
    // Opening a directory as a database throws errcode 14 from the constructor.
    const directory = tempDir();
    mkdirSync(join(directory, "venue.lock"));
    const refusal = await lockVenueDirectory(directory).catch((error: unknown) => error);
    expect(refusal).not.toBeInstanceOf(VenueInUseError);
    expect(refusal).toMatchObject({ errcode: 14 });
  });

  it("creates the folder when it does not exist yet", async () => {
    const directory = join(tempDir(), "not-yet");
    const lock = await lockVenueDirectory(directory);
    expect(existsSync(join(directory, "venue.lock"))).toBe(true);
    lock.release();
    lock.release(); // idempotent
  });
});
