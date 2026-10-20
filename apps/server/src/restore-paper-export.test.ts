import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { stagedHourRestore } from "./testing/staged-hour-restore.js";
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let f: Awaited<ReturnType<typeof stagedHourRestore>> | undefined;
afterEach(async () => {
  await f?.cleanup();
  f = undefined;
});

it.each(["archive", "stream"] as const)(
  "restores staged %s using the selected backup's older named node key and the current hour flow",
  async (kind) => {
    f = await stagedHourRestore(suite.db, kind, "paper-offline-restore");
    const retained = f.journal();
    await mintBreakGlassSecret(suite.db, TENANT_A.nodeId);
    const log = vi.fn();
    expect(await f.run(log)).toBe(true);
    const rows = await f.snapshot();
    expect(rows.allocations.map((row) => row.installationIdentity)).toEqual(["06RB", "06RC"]);
    expect(rows.allocations[1]?.approval.operatorId).toEqual({
      kind: "recovery-key",
      nodeId: TENANT_A.nodeId,
      eventId: "paper-offline-restore",
    });
    expect(
      rows.registrations
        .filter((row) => row.revocadoEn === null)
        .map((row) => row.numeroInstalacion),
    ).toEqual(["06RC"]);
    expect(
      rows.series
        .filter((row) => row.retiredAt === null)
        .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber })),
    ).toEqual([
      { code: "A-06RC", purpose: "standard", nextNumber: 1 },
      { code: "FF-06RC", purpose: "full", nextNumber: 1 },
      { code: "R-06RC", purpose: "rectificative", nextNumber: 1 },
    ]);
    expect(
      rows.series.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber),
    ).toEqual([123, 123, 123]);
    expect(f.journal()).toBe(retained);
    expect(retained).not.toContain(f.key.secret);
    expect(retained).not.toContain(f.encryptionKey);
    expect(JSON.stringify(log.mock.calls)).not.toContain(f.key.secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(f.encryptionKey);
    await expect(readFile(join(f.stateDir, "restore-request.node-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
it.each(["missing", "wrong event", "wrong source"] as const)(
  "rereads retained hour intent and refuses %s evidence before placement",
  async (mode) => {
    f = await stagedHourRestore(suite.db, "archive", "paper-offline-restore");
    const record = JSON.parse(f.journal());
    if (mode === "missing") record.revisions = [];
    else {
      const intent = record.revisions.at(-1).value.entries.at(-1);
      intent.binding[mode === "wrong event" ? "eventId" : "sourceId"] = "changed";
      if (mode === "wrong event") intent.operatorId.eventId = "changed";
    }
    await writeFile(f.journalPath, JSON.stringify(record));
    const retained = f.journal();
    const destination = await f.seedDestination();
    await writeFile(join(f.stateDir, "trading.env"), "untouched identity");
    const refusal = await f.run().then(
      () => null,
      (error: unknown) => error,
    );
    const expectedRefusal = {
      code: "sif.allocation_invalid",
      params: { reason: mode === "wrong source" ? "event_mismatch" : "reservation_missing" },
    };
    expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(destination.bytes);
    expect(await f.snapshot()).toEqual(destination.rows);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toBe("untouched identity");
    expect(f.journal()).toBe(retained);
    expect(refusal).toMatchObject(expectedRefusal);
  },
);
it("refuses the archive encryption key as node authentication before changing the destination", async () => {
  f = await stagedHourRestore(suite.db, "archive", "paper-offline-restore");
  await writeFile(join(f.stateDir, "restore-request.node-key"), f.encryptionKey);
  const destination = await f.seedDestination();
  await writeFile(join(f.stateDir, "trading.env"), "untouched identity");
  const retained = f.journal();
  const log = vi.fn();
  const refusal = await f.run(log).then(
    () => null,
    (error: unknown) => error,
  );
  const expectedRefusal = { code: "promotion.break_glass_invalid" };
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(destination.bytes);
  expect(await f.snapshot()).toEqual(destination.rows);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toBe("untouched identity");
  expect(f.journal()).toBe(retained);
  expect(refusal).toMatchObject(expectedRefusal);
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(
    f.encryptionKey,
  );
  expect(
    JSON.parse(await readFile(join(f.stateDir, "restore-request.json"), "utf8")),
  ).not.toHaveProperty("placementStarted");
  expect(JSON.stringify(log.mock.calls)).not.toContain(f.key.secret);
  expect(JSON.stringify(log.mock.calls)).not.toContain(f.encryptionKey);
});
