import {
  ACTIVATION_ROWS,
  read,
  readDatabase,
  write,
  files,
  withHoldings,
  mainFile,
  leaveHotJournal,
  PRIVATE_COPY,
} from "../test/setup-holdings-fixture.js";
import { heldSetup } from "../test/held-setup-database.js";
import { cutAfterFirstPage } from "../test/damaged-database.js";
import { DASHBOARD_CERTIFICATE, SETUP_CERTIFICATE } from "../test/certificate-rows.js";
import * as fileSystem from "node:fs/promises";
import { access, chmod, rename, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { MODULE } from "../test/first-fiscal.js";

it("reads a legitimate held setup in place: every activation row, nothing kept, no invoice", async () => {
  const held = await heldSetup();
  vi.mocked(fileSystem.mkdtemp).mockClear();
  const result = await read(held);
  expect(fileSystem.mkdtemp).not.toHaveBeenCalled();
  expect(result).toMatchObject({ rows: ACTIVATION_ROWS, kept: 0, records: 0, accepted: 0 });
});

it("counts an invoice as a record and as a kept row", async () => {
  const held = await heldSetup({ invoices: 1 });
  const result = await read(held);
  expect(result.records).toBe(1);
  expect(result.kept).toBeGreaterThanOrEqual(1);
});

it("a setup certificate row is not kept; a dashboard one is", async () => {
  const held = await heldSetup();
  write(held, [SETUP_CERTIFICATE]);
  expect(await read(held)).toMatchObject({ rows: ACTIVATION_ROWS + 1, kept: 0 });
  write(held, [DASHBOARD_CERTIFICATE]);
  expect(await read(held)).toMatchObject({ rows: ACTIVATION_ROWS + 2, kept: 1 });
});

// The invoice count failing must not lose the kept count, or Start again deletes the row.
it.each(["envios", "registros_facturacion"])(
  "a dashboard certificate row is still kept when another fiscal table is damaged (%s dropped)",
  async (table) => {
    const held = await heldSetup();
    write(held, [DASHBOARD_CERTIFICATE, `drop table ${table}`]);
    const answer = await readDatabase(held);
    expect(answer).toMatchObject({ kind: "damaged", code: "no such table" });
    expect((answer as Extract<typeof answer, { kind: "damaged" }>).seen.kept).toBe(1);
  },
);

it("keeps a dashboard certificate row when the attempt's modules leave the fiscal module out", async () => {
  const held = await heldSetup();
  write(held, [DASHBOARD_CERTIFICATE]);
  const modules = held.host.modules!.filter((module) => module.name !== MODULE);
  expect(await read(held, modules)).toMatchObject({ kept: 1 });
});

it("a certificate table missing is damage only when the attempt's modules name the fiscal module", async () => {
  const held = await heldSetup();
  write(held, ["drop table fiscal_certificate_installs"]);
  const modules = held.host.modules!.filter((module) => module.name !== MODULE);
  expect(await readDatabase(held, modules)).toMatchObject({ kind: "read" });
  expect(await readDatabase(held)).toMatchObject({ kind: "damaged", code: "no such table" });
});

it("a module the attempt does not name still refuses a read error other than a missing table", async () => {
  const held = await heldSetup();
  write(held, [
    "drop table fiscal_certificate_installs",
    "create table fiscal_certificate_installs (id integer primary key)",
  ]);
  const modules = held.host.modules!.filter((module) => module.name !== MODULE);
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "read failed: ERR_SQLITE_ERROR 1",
  });
});

it("leaves the original files' names and bytes unchanged", async () => {
  const held = await heldSetup();
  const before = await files(held.roots.venueDir);
  await read(held);
  expect(await files(held.roots.venueDir)).toEqual(before);
});

it("reads a row committed only in the -wal in place, with no copy, leaving the originals unchanged", async () => {
  const held = await heldSetup({ pendingWal: true });
  const before = await files(held.roots.venueDir);
  expect(before.map(([name]) => name)).toContain("venue.db-wal");
  vi.mocked(fileSystem.mkdtemp).mockClear();
  const result = await read(held);
  expect(fileSystem.mkdtemp).not.toHaveBeenCalled();
  expect(result.rows).toBe(ACTIVATION_ROWS + 1);
  expect(await files(held.roots.venueDir)).toEqual(before);
});

it.each([
  ["no -shm is beside it", (path: string) => rm(`${path}-shm`), ACTIVATION_ROWS + 1],
  // SQLite ignores such a -wal, so its row is not read.
  [
    "its -wal holds only a header",
    (path: string) => fileSystem.truncate(`${path}-wal`, 32),
    ACTIVATION_ROWS,
  ],
] as const)(
  "reads a -wal through a private copy when %s, leaving the originals unchanged",
  async (_label, change, rows) => {
    const held = await heldSetup({ pendingWal: true });
    await change(join(held.roots.venueDir, "venue.db"));
    const before = await files(held.roots.venueDir);
    vi.mocked(fileSystem.mkdtemp).mockClear();
    const result = await read(held);
    expect(fileSystem.mkdtemp).toHaveBeenCalledTimes(1);
    expect(result.rows).toBe(rows);
    expect(await files(held.roots.venueDir)).toEqual(before);
  },
);

it.each([0, 1, 99])(
  "answers setup.not_ready for a %i-byte venue.db beside a -wal, which may hold an invoice, and changes no file",
  async (size) => {
    const held = await heldSetup({ pendingWal: true, invoices: 1 });
    await fileSystem.truncate(join(held.roots.venueDir, "venue.db"), size);
    const before = await files(held.roots.venueDir);
    const outcome = await read(held).catch((error: unknown) => error);
    expect(await files(held.roots.venueDir)).toEqual(before);
    expect(outcome).toMatchObject({
      code: "setup.not_ready",
      reason: "database unreadable: shorter than its header beside a -wal",
    });
  },
);

it("answers setup.not_ready for a damaged venue.db beside a non-empty -wal, and changes no file", async () => {
  const held = await heldSetup({ pendingWal: true, invoices: 1 });
  cutAfterFirstPage(join(held.roots.venueDir, "venue.db"));
  const before = await files(held.roots.venueDir);
  const outcome = await read(held).catch((error: unknown) => error);
  expect(await files(held.roots.venueDir)).toEqual(before);
  expect(outcome).toMatchObject({
    code: "setup.not_ready",
    reason: expect.stringMatching(/^database unreadable: damaged beside a -wal: /),
  });
});

it("answers setup.not_ready when the private copy cannot be written", async () => {
  const held = await heldSetup();
  await leaveHotJournal(held);
  vi.mocked(fileSystem.mkdtemp).mockRejectedValueOnce(
    Object.assign(new Error("i/o"), { code: "EIO" }),
  );
  await expect(read(held)).rejects.toMatchObject({
    code: "setup.not_ready",
    params: { cause: "unreadable" },
    reason: "copy failed: EIO",
  });
});

it("a copy that fails with ENOSPC answers storage.disk_full", async () => {
  const held = await heldSetup();
  await leaveHotJournal(held);
  vi.mocked(fileSystem.mkdtemp).mockRejectedValueOnce(
    Object.assign(new Error("no space"), { code: "ENOSPC" }),
  );
  await expect(read(held)).rejects.toMatchObject({ code: "storage.disk_full", params: {} });
});

it("answers setup.not_ready when the private copy cannot be removed", async () => {
  const held = await heldSetup();
  await leaveHotJournal(held);
  let copy: string | undefined;
  const modules = withHoldings(held, async (db) => {
    // The seat also reads the main file alone, which is not the copy.
    const file = await mainFile(db);
    if (PRIVATE_COPY.test(file)) copy = file;
    return { records: 0, accepted: 0 };
  });
  vi.mocked(fileSystem.rm).mockRejectedValueOnce(
    Object.assign(new Error("busy"), { code: "EBUSY" }),
  );
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    params: { cause: "unreadable" },
    reason: "copy not removed: EBUSY",
  });
  expect(copy).toMatch(/waitron-setup-holdings-/);
  await rm(dirname(copy!), { recursive: true, force: true });
});

it("keeps a failed read as the reason when the private copy then cannot be removed", async () => {
  const held = await heldSetup();
  await leaveHotJournal(held);
  let copy: string | undefined;
  const modules = withHoldings(held, async (db) => {
    copy = await mainFile(db);
    throw Object.assign(new Error("seat failed"), { code: "ESEAT" });
  });
  vi.mocked(fileSystem.rm).mockRejectedValueOnce(
    Object.assign(new Error("busy"), { code: "EBUSY" }),
  );
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    params: { cause: "unreadable" },
    reason: "read failed: ESEAT",
  });
  await rm(dirname(copy!), { recursive: true, force: true });
});

it("passes on a module seat's error code, never its reason", async () => {
  const held = await heldSetup();
  const modules = withHoldings(held, async () => {
    throw new AppError("setup.attempt_invalid", {}, { reason: "a value read from the database" });
  });
  await expect(read(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    params: { cause: "unreadable" },
    reason: "read failed: setup.attempt_invalid",
  });
});

it("refuses a write through the private copy and through the main file read alone", async () => {
  const held = await heldSetup();
  await leaveHotJournal(held);
  const refusals: [string, unknown][] = [];
  const modules = withHoldings(held, async (db) => {
    const file = await mainFile(db);
    try {
      await db.execute("create table seat_write (a)");
      refusals.push([file, undefined]);
    } catch (error) {
      refusals.push([file, error]);
    }
    return { records: 0, accepted: 0 };
  });
  await read(held, modules);
  expect(refusals.map(([file]) => file)).toEqual([
    expect.stringMatching(PRIVATE_COPY),
    expect.not.stringMatching(PRIVATE_COPY),
  ]);
  for (const [, refusal] of refusals) expect(String(refusal)).toMatch(/readonly/);
});

it("refuses a write through the read in place and through the main file read alone", async () => {
  const held = await heldSetup({ pendingWal: true });
  const refusals: [string, unknown][] = [];
  const modules = withHoldings(held, async (db) => {
    const file = await mainFile(db);
    try {
      await db.execute("create table seat_write (a)");
      refusals.push([file, undefined]);
    } catch (error) {
      refusals.push([file, error]);
    }
    return { records: 0, accepted: 0 };
  });
  await read(held, modules);
  expect(refusals.map(([file]) => file)).toEqual([
    expect.stringMatching(/\/venue\.db$/),
    expect.stringMatching(/\/venue\.db$/),
  ]);
  for (const [, refusal] of refusals) expect(String(refusal)).toMatch(/readonly/);
});

it.each([
  ["succeeds", async () => ({ records: 0, accepted: 0 })],
  [
    "throws",
    async () => {
      throw new Error("seat failed");
    },
  ],
])("deletes its private copy when the read %s", async (outcome, answer) => {
  const held = await heldSetup();
  await leaveHotJournal(held);
  let copy: string | undefined;
  const modules = withHoldings(held, async (db) => {
    const file = await mainFile(db);
    if (PRIVATE_COPY.test(file)) copy = file;
    return answer();
  });
  const reading = read(held, modules);
  if (outcome === "throws")
    await expect(reading).rejects.toMatchObject({
      code: "setup.not_ready",
      params: { cause: "unreadable" },
    });
  else await reading;
  expect(copy).toMatch(/waitron-setup-holdings-/);
  expect(copy).not.toBe(join(held.roots.venueDir, "venue.db"));
  await expect(access(copy!)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(dirname(copy!))).rejects.toMatchObject({ code: "ENOENT" });
});

it("reads through a private copy, read-write, when a leftover -journal sits beside the database", async () => {
  const held = await heldSetup();
  await leaveHotJournal(held);
  const before = await files(held.roots.venueDir);
  vi.mocked(fileSystem.mkdtemp).mockClear();
  const result = await read(held);
  expect(fileSystem.mkdtemp).toHaveBeenCalledTimes(1);
  expect(result.rows).toBe(ACTIVATION_ROWS);
  expect(await files(held.roots.venueDir)).toEqual(before);
});

it.each([
  ["a folder", (path: string) => fileSystem.mkdir(path)],
  ["a link", (path: string) => fileSystem.symlink("venue.db", path)],
])(
  "a side file that is %s is refused as something setup does not expect, never as unreadable",
  async (_shape, make) => {
    const held = await heldSetup();
    await make(join(held.roots.venueDir, "venue.db-journal"));
    await expect(read(held)).rejects.toMatchObject({
      code: "setup.not_ready",
      params: { cause: "unexpected" },
      reason: "copy refused: not a plain file",
    });
  },
);

it.each([
  [
    "venue.db is a link",
    async (path: string) => {
      await rename(path, `${path}.aside`);
      await symlink(`${path}.aside`, path);
    },
    { code: "setup.not_ready", reason: "read refused: not a plain file" },
  ],
  [
    "venue.db is gone",
    (path: string) => rm(path),
    { code: "setup.not_ready", reason: "database missing" },
  ],
  [
    "the -wal cannot be opened",
    (path: string) => chmod(`${path}-wal`, 0o000),
    { code: "setup.not_ready", reason: "database unreadable: in place EACCES" },
  ],
] as const)(
  "with a non-empty -wal, answers setup.not_ready when %s",
  async (_label, change, answer) => {
    const held = await heldSetup({ pendingWal: true });
    await change(join(held.roots.venueDir, "venue.db"));
    await expect(read(held)).rejects.toMatchObject(answer);
  },
);
