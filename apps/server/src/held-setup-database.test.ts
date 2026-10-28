import { heldSetup } from "../test/held-setup-database.js";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { access, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import type { SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Database } from "@waitron/db";
import { initialSetupFor } from "@waitron/module";

async function invoiceRecords(f: Awaited<ReturnType<typeof heldSetup>>) {
  const connection = new DatabaseSync(join(f.roots.venueDir, "venue.db"), { readOnly: true });
  const dialect = new SQLiteSyncDialect();
  const target = {
    execute<Row extends Record<string, unknown>>(query: SQLWrapper) {
      const compiled = dialect.sqlToQuery(query.getSQL());
      return {
        rows: connection
          .prepare(compiled.sql)
          .all(...(compiled.params as SQLInputValue[])) as Row[],
      };
    },
  } as Pick<Database, "execute">;
  try {
    let records = 0;
    for (const module of f.host.modules) {
      const seat = initialSetupFor(f.host.modules, module.name)?.startAgainHoldings;
      if (seat !== undefined) records += (await seat(target)).records;
    }
    return records;
  } finally {
    connection.close();
  }
}

it("holds records beside a stopped recovery, with the attempt at committed and no invoice", async () => {
  const f = await heldSetup();
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspected).toMatchObject({ database: "occupied", emptyDatabase: false });
  expect((await f.service.liveness())?.state).toBe("stopped");
  expect((await f.host.store.read())?.status).toBe("committed");
  expect(f.installationName).toMatch(/^[0-9A-Z]{5}$/);
  expect(await invoiceRecords(f)).toBe(0);
  await expect(access(join(f.roots.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const { owner, ids } = await f.signIn();
  expect((await f.host.store.read())?.frozen.attemptId).toBe(owner.attemptId);
  expect(ids).toEqual({
    inspectionId: expect.any(String),
    revision: expect.any(Number),
    ownerGeneration: expect.any(Number),
  });
});

it("invoices: 1 leaves one invoice record, counted through the module's seat", async () => {
  const f = await heldSetup({ invoices: 1 });
  expect(await invoiceRecords(f)).toBe(1);
  expect((await f.service.liveness())?.state).toBe("stopped");
});

it("status complete and saved trading settings are reached through real steps", async () => {
  const f = await heldSetup({ status: "complete", tradingSettings: true });
  expect((await f.host.store.read())?.status).toBe("complete");
  expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toContain(
    "WAITRON_TILL_NODE_ID=",
  );
  expect((await f.service.liveness())?.state).toBe("stopped");
});

it("status committed with saved trading settings: publication wrote them, then failed", async () => {
  const f = await heldSetup({ tradingSettings: true });
  expect((await f.host.store.read())?.status).toBe("committed");
  expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toContain(
    "WAITRON_TILL_NODE_ID=",
  );
  expect((await f.service.liveness())?.state).toBe("stopped");
});

it("recovery: false leaves the held database with no recovery beside it", async () => {
  const f = await heldSetup({ recovery: false });
  expect(f.service).toBeUndefined();
  expect(await f.host.resolution.inspectFirstSetupResolution()).toMatchObject({
    database: "occupied",
    emptyDatabase: false,
  });
  expect((await f.host.store.read())?.status).toBe("committed");
  expect(await f.workspace.read()).toEqual([]);
});

it("pendingWal leaves a committed row in venue.db-wal", async () => {
  const f = await heldSetup({ pendingWal: true });
  // A write-ahead file is a 32-byte header followed by frames; a frame means a pending page.
  expect((await stat(join(f.roots.venueDir, "venue.db-wal"))).size).toBeGreaterThan(32);
  const url = pathToFileURL(join(f.roots.venueDir, "venue.db"));
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  const immutable = new DatabaseSync(url, { readOnly: true });
  try {
    expect(immutable.prepare("select count(*) as n from adjustment_settings").get()).toEqual({
      n: 0,
    });
  } finally {
    immutable.close();
  }
  // The same two files read together, in a copy so the originals stay as left, hold the row.
  const aside = await mkdtemp(join(tmpdir(), "held-setup-wal-read-"));
  try {
    for (const name of ["venue.db", "venue.db-wal"])
      await copyFile(join(f.roots.venueDir, name), join(aside, name));
    const copy = new DatabaseSync(join(aside, "venue.db"));
    try {
      expect(copy.prepare("select count(*) as n from adjustment_settings").get()).toEqual({ n: 1 });
    } finally {
      copy.close();
    }
  } finally {
    await rm(aside, { recursive: true, force: true });
  }
});
