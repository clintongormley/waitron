import { describe, expect, it } from "vitest";
import { decimal, nodeId, tenantId, tillId } from "@waitron/shared";
import { computeCloseEntryHash, type CloseHashContent } from "./daily-close-hash.js";
import type { DailyCloseSnapshot, TillReconciliation } from "./close-types.js";
import type { DailyClose } from "./types.js";

const TENANT = tenantId("11111111-1111-4111-8111-111111111111");
const NODE = nodeId("22222222-2222-4222-8222-222222222222");
const TILL_A = tillId("33333333-3333-4333-8333-333333333333");
const TILL_B = tillId("44444444-4444-4444-8444-444444444444");
const CLOSED_BY = "55555555-5555-4555-8555-555555555555";

/** A complete VAT-exact close over one day at one node — the `computeDailyClose` output shape. */
function dailyClose(): DailyClose {
  return {
    tenantId: TENANT,
    nodeId: NODE,
    businessDay: "2026-08-04",
    timeZone: "Europe/Madrid",
    vat: {
      byRate: [{ rate: decimal("21.00"), base: decimal("82.64"), tax: decimal("17.36") }],
      baseTotal: decimal("82.64"),
      taxTotal: decimal("17.36"),
      grossTotal: decimal("100.00"),
    },
    cash: {
      byTill: [
        {
          tillId: TILL_A,
          byMethod: [{ method: "cash", amount: decimal("100.00"), tip: decimal("0.00") }],
          cashTakings: decimal("100.00"),
        },
      ],
      tenderTotal: decimal("100.00"),
      tipTotal: decimal("0.00"),
    },
    counts: { sales: 1, corrections: 0, voids: 0 },
  };
}

/** A two-till reconciliation block, till A first — the shape the caller sorts on `tillId`. */
function reconciliation(): TillReconciliation[] {
  return [
    {
      tillId: TILL_A,
      openingFloat: decimal("50.00"),
      payouts: decimal("0.00"),
      countedCash: decimal("150.00"),
      cashTakings: decimal("100.00"),
      cashVariance: decimal("0.00"),
    },
    {
      tillId: TILL_B,
      openingFloat: decimal("50.00"),
      payouts: decimal("10.00"),
      countedCash: decimal("40.00"),
      cashTakings: decimal("0.00"),
      cashVariance: decimal("0.00"),
    },
  ];
}

function snapshot(over: Partial<DailyCloseSnapshot> = {}): DailyCloseSnapshot {
  return {
    close: dailyClose(),
    cashReconciliation: { byTill: reconciliation(), nodeVariance: "0.00" },
    ...over,
  };
}

/** The identity + snapshot the close hash commits to. `prevEntryHash` is passed separately. */
function content(over: Partial<CloseHashContent> = {}): CloseHashContent {
  return {
    tenantId: TENANT,
    nodeId: NODE,
    businessDay: "2026-08-04",
    sequenceNo: 1,
    closedAt: new Date("2026-08-04T22:00:00Z"),
    closedBy: CLOSED_BY,
    snapshot: snapshot(),
    ...over,
  };
}

const GENESIS_PREV = "";

describe("computeCloseEntryHash", () => {
  it("produces a 64-character uppercase hex digest", () => {
    expect(computeCloseEntryHash(content(), GENESIS_PREV)).toMatch(/^[0-9A-F]{64}$/);
  });

  it("is deterministic for identical content", () => {
    expect(computeCloseEntryHash(content(), GENESIS_PREV)).toBe(
      computeCloseEntryHash(content(), GENESIS_PREV),
    );
  });

  it("is order-independent of object key order in the snapshot", () => {
    // A jsonb round-trip re-orders object keys — the stored snapshot Task 4 reads back does not
    // preserve write-time key order — so the canonicalisation must sort keys or verification breaks.
    const ordered = content();
    const rekeyed = content({
      snapshot: {
        // top-level keys reversed, and one nested object's keys reversed, exactly as a jsonb
        // read-back might present them.
        cashReconciliation: {
          nodeVariance: "0.00",
          byTill: reconciliation().map((t) => ({
            cashVariance: t.cashVariance,
            cashTakings: t.cashTakings,
            countedCash: t.countedCash,
            payouts: t.payouts,
            openingFloat: t.openingFloat,
            tillId: t.tillId,
          })),
        },
        close: dailyClose(),
      } as DailyCloseSnapshot,
    });
    expect(computeCloseEntryHash(rekeyed, GENESIS_PREV)).toBe(
      computeCloseEntryHash(ordered, GENESIS_PREV),
    );
  });

  it("is independent of the byTill array order (sorted by tillId)", () => {
    const forward = content();
    const reversed = content({
      snapshot: snapshot({
        cashReconciliation: { byTill: [...reconciliation()].reverse(), nodeVariance: "0.00" },
      }),
    });
    expect(computeCloseEntryHash(reversed, GENESIS_PREV)).toBe(
      computeCloseEntryHash(forward, GENESIS_PREV),
    );
  });

  it("changes when a per-till cashVariance figure changes (tamper-evidence)", () => {
    const tampered = content({
      snapshot: snapshot({
        cashReconciliation: {
          byTill: reconciliation().map((t, i) =>
            i === 0 ? { ...t, cashVariance: decimal("1.00") } : t,
          ),
          nodeVariance: "1.00",
        },
      }),
    });
    expect(computeCloseEntryHash(tampered, GENESIS_PREV)).not.toBe(
      computeCloseEntryHash(content(), GENESIS_PREV),
    );
  });

  it("changes when a VAT base figure inside the close changes (tamper-evidence)", () => {
    const close = dailyClose();
    // Flip one digit of the taxable base — the classic under-reporting tamper. The snapshot hash
    // must move, or a rewritten close would verify clean.
    close.vat.byRate[0]!.base = decimal("82.65");
    const tampered = content({ snapshot: snapshot({ close }) });
    expect(computeCloseEntryHash(tampered, GENESIS_PREV)).not.toBe(
      computeCloseEntryHash(content(), GENESIS_PREV),
    );
  });

  it("changes when a record count inside the close changes", () => {
    const close = dailyClose();
    close.counts.voids = 1;
    const tampered = content({ snapshot: snapshot({ close }) });
    expect(computeCloseEntryHash(tampered, GENESIS_PREV)).not.toBe(
      computeCloseEntryHash(content(), GENESIS_PREV),
    );
  });

  it("chains: the digest depends on the predecessor hash", () => {
    const genesis = computeCloseEntryHash(content(), GENESIS_PREV);
    const linked = computeCloseEntryHash(content({ sequenceNo: 2 }), "A".repeat(64));
    expect(linked).not.toBe(genesis);
  });

  it("chains: same content, different predecessor hashes differently", () => {
    const onA = computeCloseEntryHash(content(), "A".repeat(64));
    const onB = computeCloseEntryHash(content(), "B".repeat(64));
    expect(onA).not.toBe(onB);
  });

  it("accepts an empty predecessor for the genesis close", () => {
    expect(computeCloseEntryHash(content(), GENESIS_PREV)).toMatch(/^[0-9A-F]{64}$/);
  });

  it.each([
    ["tenantId", { tenantId: "99999999-9999-4999-8999-999999999999" }],
    ["nodeId", { nodeId: "88888888-8888-4888-8888-888888888888" }],
    ["businessDay", { businessDay: "2026-08-05" }],
    ["sequenceNo", { sequenceNo: 2 }],
    ["closedBy", { closedBy: "77777777-7777-4777-8777-777777777777" }],
  ] satisfies [string, Partial<CloseHashContent>][])(
    "changes the digest when the %s identity field changes",
    (_field, over) => {
      expect(computeCloseEntryHash(content(over), GENESIS_PREV)).not.toBe(
        computeCloseEntryHash(content(), GENESIS_PREV),
      );
    },
  );

  it("truncates the close timestamp to whole seconds — a sub-second change does not move it", () => {
    const onSecond = computeCloseEntryHash(
      content({ closedAt: new Date("2026-08-04T22:00:00.000Z") }),
      GENESIS_PREV,
    );
    const subSecond = computeCloseEntryHash(
      content({ closedAt: new Date("2026-08-04T22:00:00.789Z") }),
      GENESIS_PREV,
    );
    expect(subSecond).toBe(onSecond);
  });

  it("commits to the close instant at whole-second granularity — a one-second change moves it", () => {
    const onSecond = computeCloseEntryHash(
      content({ closedAt: new Date("2026-08-04T22:00:00Z") }),
      GENESIS_PREV,
    );
    const nextSecond = computeCloseEntryHash(
      content({ closedAt: new Date("2026-08-04T22:00:01Z") }),
      GENESIS_PREV,
    );
    expect(nextSecond).not.toBe(onSecond);
  });

  it("accepts an ISO string close instant equivalently to a Date", () => {
    const asDate = computeCloseEntryHash(
      content({ closedAt: new Date("2026-08-04T22:00:00Z") }),
      GENESIS_PREV,
    );
    const asString = computeCloseEntryHash(
      content({ closedAt: "2026-08-04T22:00:00Z" }),
      GENESIS_PREV,
    );
    expect(asString).toBe(asDate);
  });
});
