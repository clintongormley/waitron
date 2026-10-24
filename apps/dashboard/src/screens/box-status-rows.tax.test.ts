import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BoxHealth } from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { es } from "../i18n/strings.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { boxStatusRows, type PartRow } from "./box-status-rows.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

const ACCEPTED = "2026-10-22T17:29:00.000Z";

function health(overrides: Partial<BoxHealth> = {}): BoxHealth {
  return {
    at: "2026-10-22T19:45:00.000Z",
    sales: { lastAt: "2026-10-22T19:43:00.000Z" },
    notices: [],
    noticesUnavailable: [],
    filing: true,
    clockStop: null,
    outbox: { lastAcceptedAt: ACCEPTED, waiting: 0, awaitingCertificate: false },
    stream: { state: "off" },
    clock: {
      authority: { state: "unknown" },
      sync: { synced: true, source: "unavailable", warn: false },
    },
    printers: [],
    readers: null,
    canFree: false,
    disk: {
      freeBytes: null,
      totalBytes: null,
      databaseBytes: null,
      backupsBytes: null,
      logBytes: null,
      otherBytes: null,
      stoppedSince: null,
      lowSince: null,
      reclaimable: { bytes: 0, backupRunning: false },
    },
    ...overrides,
  };
}

const UNSENT = {
  key: "fiscal.records_unsent",
  code: "fiscal.records_unsent",
  severity: "warning" as const,
  params: { count: 12 },
  owner: "fiscal",
};

function taxRow(input: BoxHealth): PartRow {
  const found = boxStatusRows(input, []).rows.find((row) => row.id === "tax");
  if (found === undefined) throw new Error("no tax row");
  return found;
}

describe("the Tax agency row's detail", () => {
  it("says when the box last saved an acceptance", () => {
    expect(taxRow(health()).details).toEqual([
      fill("box_status.tax.last_accepted", { time: formatIsoMinute(ACCEPTED) }),
    ]);
    expect(taxRow(health()).details).toEqual([`Last accepted ${formatIsoMinute(ACCEPTED)}`]);
  });

  it("says none has been accepted yet when the outbox has no acceptance", () => {
    const row = taxRow(
      health({ outbox: { lastAcceptedAt: null, waiting: 0, awaitingCertificate: false } }),
    );
    expect(row.details).toEqual(["None accepted yet"]);
  });

  it("is worded in Spanish", () => {
    setLocale("es");
    expect(taxRow(health()).details).toEqual([
      es["box_status.tax.last_accepted"].replace("{time}", formatIsoMinute(ACCEPTED)),
    ]);
  });

  it("draws nothing about the waiting records", () => {
    const row = taxRow(
      health({
        notices: [UNSENT],
        outbox: { lastAcceptedAt: ACCEPTED, waiting: 12, awaitingCertificate: false },
      }),
    );
    const none = taxRow(
      health({
        notices: [UNSENT],
        outbox: { lastAcceptedAt: ACCEPTED, waiting: 0, awaitingCertificate: false },
      }),
    );
    expect(row.details).toEqual(none.details);
  });

  it("is empty when the box has no outbox to read", () => {
    const row = taxRow(health({ outbox: null }));
    expect(row.details).toEqual([]);
    expect(row.line).toBe(t("box_status.tax.ok"));
    expect(row.state).toBe("ok");
  });

  it("leaves the line and state to the unsent-records notice", () => {
    for (const outbox of [
      null,
      { lastAcceptedAt: ACCEPTED, waiting: 12, awaitingCertificate: false },
      { lastAcceptedAt: null, waiting: 0, awaitingCertificate: true },
    ]) {
      const unsent = taxRow(health({ notices: [UNSENT], outbox }));
      expect(unsent.line).toBe(fill("box_status.tax.unsent", { count: "12" }));
      expect(unsent.state).toBe("attention");
      const quiet = taxRow(health({ outbox }));
      expect(quiet.line).toBe(t("box_status.tax.ok"));
      expect(quiet.state).toBe("ok");
    }
  });
});
