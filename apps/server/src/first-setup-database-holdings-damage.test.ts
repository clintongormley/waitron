import {
  ACTIVATION_ROWS,
  readDatabase,
  venueDb,
  files,
  write,
  withHoldings,
  mainFile,
  PRIVATE_COPY,
} from "../test/setup-holdings-fixture.js";
// Imported first: its `vi.mock` of the internet clock must be in place before any fiscal module loads.
import { heldSetup } from "../test/held-setup-database.js";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import * as provisioning from "@waitron/provisioning";
import { damagePages, checkpointed } from "../test/damaged-database.js";
import { foreignHotJournal, foreignWal } from "../test/foreign-journal.js";

it("reports a file that is not a database as damaged with errcode 26, nothing counted", async () => {
  const held = await heldSetup({ recovery: false });
  await writeFile(join(held.roots.venueDir, "venue.db"), "not a database");
  expect(await readDatabase(held)).toEqual({
    kind: "damaged",
    code: "errcode 26",
    seen: { rows: 0, kept: 0, records: 0, accepted: 0 },
  });
});

it("reports damage in one table with errcode 11, keeping every other table's counts", async () => {
  const held = await heldSetup({ recovery: false });
  damagePages(venueDb(held), "department_days");
  const answer = await readDatabase(held);
  expect(answer).toMatchObject({ kind: "damaged", code: "errcode 11" });
  const { seen } = answer as Extract<typeof answer, { kind: "damaged" }>;
  expect(seen.rows).toBeGreaterThan(0);
  expect(seen.rows).toBeLessThan(ACTIVATION_ROWS);
  expect(seen).toMatchObject({ kept: 0, records: 0, accepted: 0 });
});

it("reports damage in tenants beside an invoice, still counting the kept rows and the invoice record", async () => {
  const held = await heldSetup({ invoices: 1, recovery: false });
  damagePages(venueDb(held), "tenants");
  const answer = await readDatabase(held);
  expect(answer).toMatchObject({ kind: "damaged", code: "errcode 11" });
  const { seen } = answer as Extract<typeof answer, { kind: "damaged" }>;
  expect(seen.kept).toBeGreaterThanOrEqual(1);
  expect(seen.records).toBe(1);
});

it("reports a damaged invoice table with no sale as damaged, with nothing kept and no records seen", async () => {
  const held = await heldSetup({ recovery: false });
  damagePages(venueDb(held), "registros_facturacion");
  expect(await readDatabase(held)).toMatchObject({
    kind: "damaged",
    code: "errcode 11",
    seen: { kept: 0, records: 0 },
  });
});

it("marks the read damaged when a module seat fails with code 11", async () => {
  const held = await heldSetup({ recovery: false });
  const modules = withHoldings(held, async () => {
    throw Object.assign(new Error("x"), { errcode: 11 });
  });
  expect(await readDatabase(held, modules)).toMatchObject({
    kind: "damaged",
    code: "errcode 11",
    seen: { rows: ACTIVATION_ROWS, kept: 0, records: 0, accepted: 0 },
  });
});

it("reports a damaged first page with errcode 26 and nothing counted", async () => {
  const held = await heldSetup({ recovery: false });
  damagePages(venueDb(held), null);
  expect(await readDatabase(held)).toEqual({
    kind: "damaged",
    code: "errcode 26",
    seen: { rows: 0, kept: 0, records: 0, accepted: 0 },
  });
});

it("is not ready, never damaged, for an intact database with another database's hot journal beside it", async () => {
  const held = await heldSetup({ invoices: 1, recovery: false });
  checkpointed(venueDb(held));
  const before = await readFile(venueDb(held));
  foreignHotJournal(`${venueDb(held)}-journal`, "rolls-back");
  await expect(readDatabase(held)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "journal beside a damaged read: errcode 11",
  });
  expect(await readFile(venueDb(held))).toEqual(before);
});

it("reads the same intact database without the journal, with its invoice record", async () => {
  const held = await heldSetup({ invoices: 1, recovery: false });
  checkpointed(venueDb(held));
  expect(await readDatabase(held)).toMatchObject({ kind: "read", holdings: { records: 1 } });
});

it("is not ready, never damaged, for a database the box may not open", async () => {
  const held = await heldSetup({ recovery: false });
  checkpointed(venueDb(held));
  await chmod(venueDb(held), 0o000);
  try {
    await expect(readDatabase(held)).rejects.toMatchObject({
      code: "setup.not_ready",
      reason: expect.stringMatching(/^database unreadable: open /),
    });
  } finally {
    await chmod(venueDb(held), 0o600);
  }
});

it.each([
  ["open", 26, { kind: "damaged", code: "errcode 26" }],
  ["open", 14, { code: "setup.not_ready", reason: "database unreadable: open unknown 14" }],
  ["wal", 11, { code: "setup.not_ready", reason: "database unreadable: wal unknown 11" }],
] as const)(
  "an opening that fails at %s with code %i answers %o",
  async (stage, errcode, answer) => {
    const held = await heldSetup({ recovery: false });
    vi.mocked(provisioning.openImmutableWhenWalEmpty).mockResolvedValueOnce({
      kind: "failed",
      stage,
      error: { errcode },
    });
    if ("kind" in answer)
      expect(await readDatabase(held)).toEqual({
        ...answer,
        seen: { rows: 0, kept: 0, records: 0, accepted: 0 },
      });
    else await expect(readDatabase(held)).rejects.toMatchObject(answer);
  },
);

it("reports a 0-byte venue.db as damaged (no such table), nothing counted", async () => {
  const held = await heldSetup({ recovery: false });
  await writeFile(venueDb(held), "");
  expect(await readDatabase(held)).toEqual({
    kind: "damaged",
    code: "no such table",
    seen: { rows: 0, kept: 0, records: 0, accepted: 0 },
  });
});

it("marks the read damaged when a module seat finds its table missing", async () => {
  const held = await heldSetup({ recovery: false });
  write(held, ["drop table registros_facturacion"]);
  expect(await readDatabase(held)).toMatchObject({ kind: "damaged", code: "no such table" });
});

it("is not ready, never damaged, when a module seat fails with code 1 for another reason", async () => {
  const held = await heldSetup({ recovery: false });
  const modules = withHoldings(held, async () => {
    throw Object.assign(new Error('near "x": syntax error'), {
      code: "ERR_SQLITE_ERROR",
      errcode: 1,
    });
  });
  await expect(readDatabase(held, modules)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "read failed: ERR_SQLITE_ERROR 1",
  });
});

it("is not ready, never damaged, for an intact database holding an invoice with an empty-original journal from another database beside it", async () => {
  const held = await heldSetup({ invoices: 1, recovery: false });
  checkpointed(venueDb(held));
  const before = await readFile(venueDb(held));
  foreignHotJournal(`${venueDb(held)}-journal`, "empty-original");
  await expect(readDatabase(held)).rejects.toMatchObject({
    code: "setup.not_ready",
    reason: "journal beside a damaged read: no such table",
  });
  expect(await readFile(venueDb(held))).toEqual(before);
});

it.each([
  ["whose page 1 names only its own table", "page-1", "no such table"],
  ["overwriting other pages", "other-pages", "errcode 11"],
] as const)(
  "an intact database holding an invoice, with another database's -wal beside it %s, is damaged and still counts the invoice its main file holds",
  async (_label, shape, code) => {
    const held = await heldSetup({ invoices: 1, recovery: false });
    checkpointed(venueDb(held));
    foreignWal(`${venueDb(held)}-wal`, shape);
    const before = await files(held.roots.venueDir);
    const answer = await readDatabase(held);
    expect(answer).toMatchObject({ kind: "damaged", code, seen: { records: 1 } });
    const { seen } = answer as Extract<typeof answer, { kind: "damaged" }>;
    expect(seen.kept).toBeGreaterThanOrEqual(1);
    expect(await files(held.roots.venueDir)).toEqual(before);
  },
);

it("a damaged database with no invoice and its own pending -wal still reads as damaged with nothing kept", async () => {
  const held = await heldSetup({ pendingWal: true, recovery: false });
  const wal = await readFile(`${venueDb(held)}-wal`);
  damagePages(venueDb(held), "department_days");
  await writeFile(`${venueDb(held)}-wal`, wal);
  expect(await readDatabase(held)).toMatchObject({
    kind: "damaged",
    code: "errcode 11",
    seen: { kept: 0, records: 0, accepted: 0 },
  });
});

it.each([
  [Object.assign(new Error("seat failed"), { code: "ESEAT" }), "ESEAT"],
  [new AppError("setup.attempt_invalid", {}, { reason: "a value" }), "setup.attempt_invalid"],
])(
  "is not ready when a module seat fails on the main file read alone (%s)",
  async (failure, code) => {
    const held = await heldSetup({ pendingWal: true, recovery: false });
    const modules = withHoldings(held, async (db) => {
      if (!PRIVATE_COPY.test(await mainFile(db))) throw failure;
      return { records: 0, accepted: 0 };
    });
    await expect(readDatabase(held, modules)).rejects.toMatchObject({
      code: "setup.not_ready",
      reason: `main file read failed: ${code}`,
    });
  },
);
