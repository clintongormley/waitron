import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { TAXPAYER_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { stagedHourRestore } from "./testing/staged-hour-restore.js";
import { observeTimeServiceHourClock } from "@waitron/fiscal-verifactu/src/hour-clock-time-service.js";
import { timeServiceReader } from "./clock-service-reading.js";

vi.mock("./clock-service-reading.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-service-reading.js")>();
  return { ...actual, timeServiceReader: vi.fn(() => async () => false) };
});
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let f: Awaited<ReturnType<typeof stagedHourRestore>> | undefined;
afterEach(async () => {
  await f?.cleanup();
  f = undefined;
});

it.each(["archive", "stream"] as const)(
  "restores a staged %s with the selected copy's older key and a durably selected current hour",
  async (kind) => {
    f = await stagedHourRestore(suite, kind, "emergency-offline-restore");
    const before = f.journal();
    await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, TAXPAYER_A.nodeId);
    const log = vi.fn();
    await expect(f.run(log)).resolves.toBe(true);
    const rows = await f.snapshot();
    expect(rows.allocations).toHaveLength(2);
    expect(rows.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNY", "0CNQT"]);
    expect(rows.allocations[1]?.approval.operatorId).toEqual({
      kind: "recovery-key",
      nodeId: TAXPAYER_A.nodeId,
      eventId: "emergency-offline-restore",
    });
    expect(
      rows.registrations
        .filter((row) => row.revocadoEn === null)
        .map((row) => row.numeroInstalacion),
    ).toEqual(["0CNQT"]);
    expect(
      rows.series
        .filter((row) => row.retiredAt === null)
        .map(({ code, nextNumber }) => ({ code, nextNumber })),
    ).toEqual([
      { code: "A-0CNQT", nextNumber: 1 },
      { code: "FF-0CNQT", nextNumber: 1 },
      { code: "R-0CNQT", nextNumber: 1 },
    ]);
    expect(
      rows.series.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber),
    ).toEqual([123, 123, 123]);
    expect(f.journal()).toBe(before);
    expect(before).toContain('"identity":"0CNQT"');
    expect(before).not.toContain(f.key.secret);
    expect(before).not.toContain(f.encryptionKey);
    expect(JSON.stringify(log.mock.calls)).not.toContain(f.key.secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(f.encryptionKey);
    await expect(readFile(join(f.stateDir, "flows/restore/node-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
it("rereads the retained selected-hour binding and refuses a changed event before placement", async () => {
  f = await stagedHourRestore(suite, "archive", "emergency-offline-restore");
  const path = join(f.stateDir, "flows/restore/record.json");
  const marker = JSON.parse(await readFile(path, "utf8"));
  marker.request.recoveryOperation.binding.eventId = "another-recovery";
  await writeFile(path, JSON.stringify(marker));
  const destination = await f.seedDestination();
  await writeFile(join(f.stateDir, "trading.env"), "untouched identity");
  const journal = f.journal();
  const refusal = await f.run().then(
    () => null,
    (error: unknown) => error,
  );
  const expectedRefusal = {
    code: "sif.allocation_invalid",
    params: { reason: "reservation_missing" },
  };
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(destination.bytes);
  expect(await readFile(join(f.venueDir, "node.db"))).toEqual(destination.nodeBytes);
  expect(await f.snapshot()).toEqual(destination.rows);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toBe("untouched identity");
  expect(f.journal()).toBe(journal);
  expect(refusal).toMatchObject(expectedRefusal);
});
async function withRealObserver<T>(run: () => Promise<T>): Promise<T> {
  const { observeTimeServiceHourClock: real } = await vi.importActual<
    typeof import("@waitron/fiscal-verifactu/src/hour-clock-time-service.js")
  >("@waitron/fiscal-verifactu/src/hour-clock-time-service.js");
  vi.mocked(observeTimeServiceHourClock).mockImplementation(real);
  try {
    return await run();
  } finally {
    vi.mocked(observeTimeServiceHourClock).mockReset();
  }
}
it("asks the time-service reader its caller hands it, never the host's own", async () => {
  f = await stagedHourRestore(suite, "archive", "emergency-offline-restore");
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, TAXPAYER_A.nodeId);
  const supplied = vi.fn(async () => true);
  const hostAsked = vi.mocked(timeServiceReader).mock.results.length;
  await expect(
    withRealObserver(() => f!.run(undefined, { timeServiceSynchronised: supplied })),
  ).resolves.toBe(true);
  expect(supplied).toHaveBeenCalled();
  expect(vi.mocked(timeServiceReader).mock.results.length).toBe(hostAsked);
});
it("asks the box's host service when its caller hands it no reader", async () => {
  f = await stagedHourRestore(suite, "archive", "emergency-offline-restore");
  await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, TAXPAYER_A.nodeId);
  const host = vi.fn(async () => true);
  vi.mocked(timeServiceReader).mockImplementationOnce(() => host);
  await expect(withRealObserver(() => f!.run())).resolves.toBe(true);
  expect(host).toHaveBeenCalled();
});
