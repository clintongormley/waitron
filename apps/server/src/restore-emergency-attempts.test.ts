import { readFile, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { stagedHourRestore } from "./testing/staged-hour-restore.js";
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let f: Awaited<ReturnType<typeof stagedHourRestore>> | undefined;
afterEach(async () => {
  await f?.cleanup();
  f = undefined;
});

it.each(["archive", "stream"] as const)(
  "retains the %s hour intent before publishing trading settings",
  async (kind) => {
    f = await stagedHourRestore(suite.db, kind, "emergency-offline-restore");
    const retained = f.journal();
    await expect(f.run()).resolves.toBe(true);
    expect(JSON.parse(retained).revisions.at(-1).value.entries.at(-1)).toMatchObject({
      kind: "intent",
      identity: "0CNQT",
      binding: f.binding,
    });
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(
      `WAITRON_NODE_ID=${TENANT_A.nodeId}`,
    );
    expect((await f.snapshot()).allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNY",
      "0CNQT",
    ]);
    expect(f.journal()).toBe(retained);
    expect(retained).not.toContain(f.key.secret);
    expect(retained).not.toContain(f.encryptionKey);
  },
);
it.each(["archive", "stream"] as const)(
  "keeps the committed %s activation when trading publication fails and finishes without reallocation",
  async (kind) => {
    f = await stagedHourRestore(suite.db, kind, "emergency-offline-restore");
    const retained = f.journal();
    const trading = join(f.stateDir, "trading.env");
    await expect(
      f.run((_level, event, fields) => {
        if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu")
          mkdirSync(trading);
      }),
    ).rejects.toMatchObject({ code: "EISDIR" });
    await expect(readFile(trading)).rejects.toMatchObject({ code: "EISDIR" });
    await f.advanceCounters();
    const committed = await f.snapshot();
    expect(committed.allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNY",
      "0CNQT",
    ]);
    expect(f.journal()).toBe(retained);
    await rm(trading, { recursive: true });
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(committed);
    expect(f.journal()).toBe(retained);
  },
);
it("retains the selected hour after a real hook transaction rolls back", async () => {
  f = await stagedHourRestore(suite.db, "archive", "emergency-offline-restore");
  const retained = f.journal();
  await expect(
    f.run((_level, event, fields) => {
      if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu")
        throw new Error("injected callback interruption");
    }),
  ).rejects.toThrow("injected callback interruption");
  await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  const rows = await f.snapshot();
  expect(rows.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNY"]);
  expect(
    rows.registrations.filter((row) => row.revocadoEn === null).map((row) => row.numeroInstalacion),
  ).toEqual(["0CNNY"]);
  expect(
    rows.series.map(({ code, nextNumber, retiredAt }) => ({ code, nextNumber, retiredAt })),
  ).toEqual([
    { code: "A-0CNNY", nextNumber: 123, retiredAt: null },
    { code: "FF-0CNNY", nextNumber: 123, retiredAt: null },
    { code: "R-0CNNY", nextNumber: 123, retiredAt: null },
  ]);
  expect(f.journal()).toBe(retained);
  expect(retained).not.toContain("injected callback interruption");
  // The settle wait alone ends at 12:42, the rolled-back restore's name (0CNQT).
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  await expect(f.nextEvent()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_in_use", allowedFromMs: Date.parse("2026-10-16T12:43:00Z") },
  });
  expect(f.journal()).toBe(retained);
});
it.each(["archive", "stream"] as const)(
  "retains readable %s intent before activation and commits before trading settings",
  async (kind) => {
    f = await stagedHourRestore(suite.db, kind, "emergency-offline-restore");
    const retained = f.journal();
    let seen = false;
    await f.run((_level, event, fields) => {
      if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu") {
        const text = readFileSync(f!.journalPath, "utf8");
        expect(text).toBe(retained);
        expect(JSON.parse(text).revisions.at(-1).value.entries.at(-1)).toMatchObject({
          kind: "intent",
          identity: "0CNQT",
          binding: f!.binding,
        });
        expect(text).not.toContain(f!.key.secret);
        expect(text).not.toContain(f!.encryptionKey);
        expect(existsSync(join(f!.stateDir, "trading.env"))).toBe(false);
        seen = true;
      }
    });
    expect(seen).toBe(true);
    expect(f.journal()).toBe(retained);
    expect((await f.snapshot()).allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNY",
      "0CNQT",
    ]);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(
      `WAITRON_NODE_ID=${TENANT_A.nodeId}`,
    );
  },
);
it.each(["archive", "stream"] as const)(
  "refuses %s trading publication when another restored credential cannot be retained",
  async (kind) => {
    f = await stagedHourRestore(suite.db, kind, "emergency-offline-restore");
    const retained = f.journal();
    const credential = join(f.stateDir, "credentials.key");
    await expect(
      f.run((_level, event, fields) => {
        if (event === "restore.hook.done" && fields?.module === "fiscal-verifactu")
          mkdirSync(credential);
      }),
    ).rejects.toMatchObject({ code: "EISDIR" });
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await f.advanceCounters();
    const committed = await f.snapshot();
    expect(committed.allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNY",
      "0CNQT",
    ]);
    expect(f.journal()).toBe(retained);
    await rm(credential, { recursive: true });
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(committed);
  },
);
