import { describe, expect, it } from "vitest";
import { backupAuditDay } from "./backup-audit-day.js";

const charge = (id: string, settledAt: string) => ({ id, settledAt });
const run = (day: string, generation: number, matches: ReturnType<typeof charge>[]) => ({
  periodFrom: `${day}T00:00:00.000Z`,
  periodTo: new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString(),
  generation,
  summary: { backupMatches: matches, backupUnmatched: [] as ReturnType<typeof charge>[] },
});

describe("backup audits on the venue's calendar day", () => {
  it("joins both UTC audits, keeps the latest successful generation, and clips at local midnight", () => {
    const audits = [
      run("2026-11-13", 0, [charge("old", "2026-11-13T23:30:00.000Z")]),
      run("2026-11-13", 1, [
        charge("before", "2026-11-13T22:59:59.999Z"),
        charge("start", "2026-11-13T23:00:00.000Z"),
      ]),
      {
        ...run("2026-11-14", 0, []),
        summary: {
          backupMatches: [charge("last", "2026-11-14T22:59:59.999Z")],
          backupUnmatched: [charge("end", "2026-11-14T23:00:00.000Z")],
        },
      },
    ];
    expect(backupAuditDay("2026-11-14", "Europe/Madrid", audits)).toEqual({
      day: "2026-11-14",
      timeZone: "Europe/Madrid",
      complete: true,
      backupMatches: [
        charge("start", "2026-11-13T23:00:00.000Z"),
        charge("last", "2026-11-14T22:59:59.999Z"),
      ],
      backupUnmatched: [],
    });
  });

  it("shows that the comparison is incomplete while either UTC audit is absent or predates matching", () => {
    for (const audits of [
      [run("2026-11-14", 0, [])],
      [run("2026-11-13", 0, [])],
      [run("2026-11-13", 0, []), { ...run("2026-11-14", 0, []), summary: {} }],
    ])
      expect(backupAuditDay("2026-11-14", "Europe/Madrid", audits).complete).toBe(false);
  });

  it("includes all 25 hours of Spain's autumn clock-change day", () => {
    const audits = [
      run("2026-10-24", 0, [charge("start", "2026-10-24T22:00:00.000Z")]),
      run("2026-10-25", 0, [charge("last", "2026-10-25T22:59:59.999Z")]),
    ];
    expect(backupAuditDay("2026-10-25", "Europe/Madrid", audits)).toMatchObject({
      complete: true,
      backupMatches: [
        charge("start", "2026-10-24T22:00:00.000Z"),
        charge("last", "2026-10-25T22:59:59.999Z"),
      ],
    });
  });
});
