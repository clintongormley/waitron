import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalOutboxState, TrustedReading } from "@waitron/fiscal";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { AppError } from "@waitron/shared";
import { collectBoxHealth, type BoxHealthReaders } from "./box-health.js";
import { createStaffNoticeLog } from "./staff-notices.js";

const NOW = new Date("2026-10-22T10:00:00.000Z");
const READING: TrustedReading = {
  instant: NOW,
  offsetMinutes: 120,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
};
const STATE: FiscalOutboxState = { lastAcceptedAt: "2026-10-22T09:30:00.000Z", waiting: 3 };

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

function stubReaders(
  over: Partial<BoxHealthReaders> = {},
  filing = true,
  log = vi.fn(),
): BoxHealthReaders {
  return {
    now: () => NOW,
    notices: {
      sources: [],
      clock: { now: () => READING },
      filing: () => filing,
      log: createStaffNoticeLog(log),
    },
    stream: () => ({ state: "off" }),
    authorityClock: () => ({ state: "ok", driftSeconds: 2, measuredAt: "2026-10-22T09:00:00Z" }),
    timeHealth: async () => ({ synced: true, source: "timedatectl", warn: false }),
    disk: { since: () => null },
    space: { current: () => ({ freeBytes: null, readAt: null, lowSince: null }) },
    usage: async () => ({
      freeBytes: 1,
      totalBytes: 100_000,
      databaseBytes: 10,
      backupsBytes: 20,
      logBytes: 30,
      otherBytes: 40,
    }),
    free: async () => 5_000,
    leftovers: async () => ({ bytes: 700_000, backupRunning: false }),
    paymentsEnabled: true,
    canFree: () => true,
    ...over,
  };
}

function outboxReader(read: (tx: Transaction) => Promise<FiscalOutboxState>, awaiting = false) {
  return { read: vi.fn(read), awaitingCertificate: () => awaiting };
}

describe("collectBoxHealth's outbox", () => {
  it("answers the seat's state with whether the box awaits a certificate", async () => {
    const outbox = outboxReader(async () => STATE);
    const health = await collectBoxHealth(suite.db, stubReaders({ outbox }));
    expect(health.outbox).toEqual({ ...STATE, awaitingCertificate: false });
    expect(outbox.read).toHaveBeenCalledTimes(1);
    expect(outbox.read).toHaveBeenCalledWith(suite.db);

    const awaiting = outboxReader(async () => STATE, true);
    const later = await collectBoxHealth(suite.db, stubReaders({ outbox: awaiting }));
    expect(later.outbox).toEqual({ ...STATE, awaitingCertificate: true });
  });

  it("answers null without asking the seat when the box does not file", async () => {
    const outbox = outboxReader(async () => STATE);
    const health = await collectBoxHealth(suite.db, stubReaders({ outbox }, false));
    expect(health.outbox).toBeNull();
    expect(outbox.read).not.toHaveBeenCalled();
  });

  it("answers null when the seat has no outbox", async () => {
    const health = await collectBoxHealth(suite.db, stubReaders());
    expect(health.outbox).toBeNull();
  });

  it("drains nothing", async () => {
    suite.db.run(
      sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
    );
    const health = await collectBoxHealth(
      suite.db,
      stubReaders({ outbox: outboxReader(async () => STATE) }),
    );
    expect(health.outbox).toEqual({ ...STATE, awaitingCertificate: false });
    expect(suite.db.all<{ id: string }>(sql`select id from change_log`)).toEqual([{ id: "zz1" }]);
  });

  it("degrades only the outbox when its read throws", async () => {
    const log = vi.fn();
    const outbox = outboxReader(async () => {
      throw new AppError("storage.disk_full", {});
    });
    const without = await collectBoxHealth(suite.db, stubReaders());
    const health = await collectBoxHealth(suite.db, stubReaders({ outbox }, true, log));
    expect(health).toEqual({
      ...without,
      outbox: null,
      noticesUnavailable: [...without.noticesUnavailable, "fiscal-outbox"],
    });
    expect(log).toHaveBeenCalledWith("error", "box_health.outbox_failed", {
      errorCode: "storage.disk_full",
    });
  });

  it("refuses a read that writes, and keeps nothing it wrote", async () => {
    const log = vi.fn();
    const outbox = outboxReader(async (tx) => {
      tx.run(
        sql`insert into change_log (id, payload) values ('zz2', '{"resource":"zz","id":"2"}')`,
      );
      return STATE;
    });
    const health = await collectBoxHealth(suite.db, stubReaders({ outbox }, true, log));
    expect(health.outbox).toBeNull();
    expect(health.noticesUnavailable).toContain("fiscal-outbox");
    expect(log).toHaveBeenCalledWith("error", "box_health.outbox_failed", {
      errorCode: "box_health.outbox_wrote",
    });
    expect(suite.db.all<{ id: string }>(sql`select id from change_log where id = 'zz2'`)).toEqual(
      [],
    );
  });
});
