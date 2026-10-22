import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { clockNotices, FISCAL_STAFF_NOTICES } from "./staff-notices.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const reading = (iso: string, offsetMinutes: number) => ({
  instant: new Date(iso),
  offsetMinutes,
});

const notice = (iso: string, offsetMinutes: number) => ({
  key: "clock.unusable",
  code: "clock.unusable",
  severity: "error",
  params: { clockAt: new Date(iso).toISOString(), offsetMinutes },
});

describe("clockNotices", () => {
  it.each([
    { iso: "2024-10-27T23:30:00.000Z", offsetMinutes: 0, refused: true },
    { iso: "2024-10-27T22:59:59.999Z", offsetMinutes: 60, refused: true },
    { iso: "2001-01-01T11:00:00.000Z", offsetMinutes: 60, refused: true },
    { iso: "2024-10-27T23:30:00.000Z", offsetMinutes: 60, refused: false },
    { iso: "2024-10-27T23:00:00.000Z", offsetMinutes: 60, refused: false },
    { iso: "2026-10-22T10:00:00.000Z", offsetMinutes: 120, refused: false },
  ])("$iso at $offsetMinutes: notice $refused", ({ iso, offsetMinutes, refused }) => {
    expect(clockNotices(reading(iso, offsetMinutes))).toEqual(
      refused ? [notice(iso, offsetMinutes)] : [],
    );
  });

  it("carries the refusal's own params", () => {
    const r = reading("2001-01-01T11:00:00.000Z", 60);
    let caught: unknown;
    try {
      refuseBeforeFirstIssueDate(r);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(clockNotices(r)[0]!.params).toEqual((caught as AppError).params);
  });
});

describe("FISCAL_STAFF_NOTICES", () => {
  it("the seat's one source answers the clock notice", async () => {
    expect(FISCAL_STAFF_NOTICES).toHaveLength(1);
    const before = reading("2001-01-01T11:00:00.000Z", 60);
    const after = reading("2026-10-22T10:00:00.000Z", 120);
    expect(
      await withTransaction(suite.db, (tx) =>
        FISCAL_STAFF_NOTICES[0]!.read({ tx, reading: before }),
      ),
    ).toEqual([notice("2001-01-01T11:00:00.000Z", 60)]);
    expect(
      await withTransaction(suite.db, (tx) =>
        FISCAL_STAFF_NOTICES[0]!.read({ tx, reading: after }),
      ),
    ).toEqual([]);
  });
});
