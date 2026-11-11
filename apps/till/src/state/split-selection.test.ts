import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type {
  BillBalance,
  BillRefundView,
  Draft,
  DraftLine,
  PartyBill,
  TabLine,
} from "../api/client.js";
import { billGross } from "./adjust-target.js";
import { paidQuantities } from "./bill-payment.js";
import { tabLinePortionKey } from "./portion-groups.js";
import {
  pickGroups,
  pickedCount,
  setCount,
  type PickRow,
  type Picks,
} from "./portion-selection.js";
import {
  anywayNote,
  billTick,
  heldSelected,
  leftWithNothingToPay,
  nothingStays,
  pickOnBill,
  rowsOf,
  splitSourcesFrom,
  splitSummary,
  tidySplit,
  toSelection,
  toggleBill,
  type SplitPicks,
  type SplitSource,
} from "./split-selection.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Caña",
    productId: "cana",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "5.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: "offer-cana",
    portion: true,
    ...over,
  };
}

function dish(id: string, lineNo: number, price: string): TabLine {
  return line(id, lineNo, {
    name: id,
    productId: id,
    menuItemId: id,
    unitPriceGross: price,
  });
}

const fourBeerLines = (from = 1) => [0, 1, 2, 3].map((at) => line(`c${at + 1}`, from + at));

function balanceOf(
  lines: readonly TabLine[],
  over: {
    received?: string;
    reserved?: string;
    paid?: string[];
    status?: BillBalance["status"];
  } = {},
): BillBalance {
  return {
    workingOrderId: "unused",
    status: over.status ?? "open",
    total: billGross(lines),
    received: over.received ?? "0.00",
    reserved: over.reserved ?? "0.00",
    outstanding: "0.00",
    tips: "0.00",
    payments: [],
    paidLines: (over.paid ?? []).map((lineId) => ({
      lineId,
      lineNo: lines.find((row) => row.id === lineId)!.lineNo,
      paidQuantity: "1.000",
    })),
  };
}

const keyFor = (lines: readonly TabLine[], balance: BillBalance) => (row: TabLine) =>
  tabLinePortionKey(row, lines, paidQuantities(balance).get(row.lineNo) ?? null);

function bill(id: string, number: number | null, over: Partial<PartyBill> = {}): PartyBill {
  return {
    workingOrderId: id,
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "party",
    label: null,
    billNumber: number,
    billName: null,
    status: "open",
    total: "0.00",
    outstanding: "0.00",
    hasPayments: false,
    receiptAvailable: false,
    ...over,
  };
}

interface SourceOptions {
  received?: string;
  reserved?: string;
  paid?: string[];
  status?: PartyBill["status"];
  held?: SplitSource["held"];
  ownUnsent?: boolean;
  refundPending?: boolean;
}

function source(
  id: string,
  number: number | null,
  lines: readonly TabLine[],
  options: SourceOptions = {},
): SplitSource {
  const balance = balanceOf(lines, {
    ...(options.received === undefined ? {} : { received: options.received }),
    ...(options.reserved === undefined ? {} : { reserved: options.reserved }),
    ...(options.paid === undefined ? {} : { paid: options.paid }),
  });
  return {
    bill: bill(id, number, { status: options.status ?? "open", total: balance.total }),
    groups: pickGroups(lines, keyFor(lines, balance), balance),
    held: options.held ?? null,
    ownUnsent: options.ownUnsent ?? false,
    refundPending: options.refundPending ?? false,
  };
}

const luis = { draftId: "draft-luis", revision: 0, ownerName: "Luis", takenFromYou: false };

const NOTHING: SplitPicks = { whole: new Set(), picks: new Map() };

const wholeOf = (...ids: string[]): SplitPicks => ({ whole: new Set(ids), picks: new Map() });

const looseOf = (entries: Record<string, string[]>): SplitPicks => ({
  whole: new Set(),
  picks: new Map(Object.entries(entries).map(([id, picks]) => [id, new Set(picks)])),
});

const sorted = (picks: Picks | undefined) => [...(picks ?? [])].sort();

const drawn = (sources: readonly SplitSource[], split: SplitPicks) =>
  new Map<string, readonly PickRow[]>(
    sources.map((one) => [one.bill.workingOrderId, rowsOf(one, split)]),
  );

const named = (rows: readonly PickRow[]) => rows.map((row) => row.members.map((m) => m.id));

function draft(
  billId: string,
  ownerId: string,
  ownerName: string,
  fresh: readonly TabLine[] = [],
  revision = 0,
): Draft {
  return {
    id: `draft-${ownerId}`,
    partyId: "party",
    billId,
    ownerId,
    ownerName,
    revision,
    lines: fresh.map(
      (row) =>
        ({
          id: `fresh-${row.id}`,
          sourceLineId: null,
          source: null,
        }) as unknown as DraftLine,
    ),
    takenOverFrom: null,
  };
}

const readOf = (...bills: { id: string; lines: TabLine[] }[]) => ({
  bills: bills.map(({ id, lines }) => ({
    billId: id,
    lines,
    balance: balanceOf(lines),
  })),
});

describe("A803 selection:", () => {
  describe("ticking a bill", () => {
    it("ticking a bill takes all of it and clears its picks", () => {
      const one = source("b1", 1, [dish("a", 1, "5.00"), dish("b", 2, "6.00")]);

      const some = pickOnBill(one, NOTHING, new Set(["a"]));
      expect(billTick(one, some)).toBe("some");
      const all = toggleBill(one, some);

      expect(billTick(one, all)).toBe("all");
      expect(all.picks.has("b1")).toBe(false);
      expect([...all.whole]).toEqual(["b1"]);
    });

    it("ticking a whole bill again unticks it, and nothing ticked reads none", () => {
      const one = source("b1", 1, [dish("a", 1, "5.00")]);

      expect(billTick(one, NOTHING)).toBe("none");
      expect(billTick(one, toggleBill(one, toggleBill(one, NOTHING)))).toBe("none");
    });

    it("ticking one bill leaves another bill's tick and picks as they were", () => {
      const two = source("b2", 2, [dish("c", 3, "5.00")]);
      const split = { whole: new Set(["b2"]), picks: new Map([["b1", new Set(["a"])]]) };

      const next = toggleBill(two, split);
      expect(sorted(next.picks.get("b1"))).toEqual(["a"]);
      expect(next.whole.has("b2")).toBe(false);
    });
  });

  describe("unticking a row of a whole bill", () => {
    it("turns the rest into picks, in line order, up to each limit", () => {
      const lines = [dish("a", 1, "5.00"), dish("b", 2, "6.00"), dish("c", 3, "7.00")];
      const one = source("b1", 1, lines);

      const next = pickOnBill(one, wholeOf("b1"), new Set(["a", "c"]));

      expect(billTick(one, next)).toBe("some");
      expect(next.whole.size).toBe(0);
      expect(toSelection([one], next)).toEqual({
        wholeBillIds: [],
        loose: [{ billId: "b1", lineIds: ["a", "c"] }],
      });
    });

    it("whole-bill tick of a part-paid bill is allowed and untick leaves its paid rows out", () => {
      const lines = [dish("paid", 1, "5.00"), dish("a", 2, "6.00"), dish("b", 3, "7.00")];
      const one = source("b1", 1, lines, { paid: ["paid"], received: "5.00" });

      const whole = toggleBill(one, NOTHING);
      expect(billTick(one, whole)).toBe("all");

      const next = pickOnBill(one, whole, new Set(["paid", "a"]));
      expect(sorted(next.picks.get("b1"))).toEqual(["a"]);
      expect(toSelection([one], next).loose).toEqual([{ billId: "b1", lineIds: ["a"] }]);
    });

    it("2 of 4 from a whole bill: unticking the Caña row drops all four, and a pick count keeps 4a's first-members rule", () => {
      const lines = [dish("p", 1, "12.00"), ...fourBeerLines(2)];
      const one = source("b1", 1, lines);

      const withoutBeerLines = pickOnBill(one, wholeOf("b1"), new Set(["p"]));
      expect(sorted(withoutBeerLines.picks.get("b1"))).toEqual(["p"]);

      const row = rowsOf(one, withoutBeerLines)[1]!;
      expect(row.counted).toBe(true);
      const two = pickOnBill(
        one,
        withoutBeerLines,
        setCount(row, 2, withoutBeerLines.picks.get("b1")!),
      );
      expect(sorted(two.picks.get("b1"))).toEqual(["c1", "c2", "p"]);
      expect(pickedCount(rowsOf(one, two)[1]!, two.picks.get("b1")!)).toBe(2);

      const later = pickOnBill(one, withoutBeerLines, new Set(["p", "c3", "c4"]));
      expect(sorted(later.picks.get("b1"))).toEqual(["c1", "c2", "p"]);
    });
  });

  describe("every dish picked", () => {
    const lines = [dish("a", 1, "5.00"), dish("b", 2, "6.00")];

    it("on a clean bill becomes whole", () => {
      const one = source("b1", 1, lines);
      const next = pickOnBill(one, NOTHING, new Set(["a", "b"]));

      expect(billTick(one, next)).toBe("all");
      expect(next.picks.has("b1")).toBe(false);
    });

    it("every unpaid dish on a part-paid bill does not", () => {
      const paid = dish("paid", 3, "5.00");
      const one = source("b1", 1, [...lines, paid], { paid: ["paid"], received: "5.00" });
      const next = pickOnBill(one, NOTHING, new Set(["a", "b"]));

      expect(billTick(one, next)).toBe("some");
      expect(next.whole.size).toBe(0);
    });

    it("every sent dish on a bill holding this person's unsent dishes does not, and toSelection lists the picks and leaves the unsent dishes out", () => {
      const one = source("b1", 1, lines, { ownUnsent: true });
      const next = pickOnBill(one, NOTHING, new Set(["a", "b"]));

      expect(billTick(one, next)).toBe("some");
      expect(toSelection([one], next)).toEqual({
        wholeBillIds: [],
        loose: [{ billId: "b1", lineIds: ["a", "b"] }],
      });
    });

    it("no pick left clears the bill's entry", () => {
      const one = source("b1", 1, lines);
      const next = pickOnBill(one, looseOf({ b1: ["a"] }), new Set());

      expect(next.picks.has("b1")).toBe(false);
      expect(billTick(one, next)).toBe("none");
    });
  });

  describe("a contribution's floor", () => {
    it("€40 on €52 stays within it after an untick, and allows €40.00", () => {
      const lines = [
        dish("twelve", 1, "12.00"),
        dish("twenty", 2, "20.00"),
        dish("more", 3, "20.00"),
      ];
      const one = source("b1", 1, lines, { received: "40.00" });

      const next = pickOnBill(one, wholeOf("b1"), new Set(["twelve", "twenty"]));

      expect(sorted(next.picks.get("b1"))).toEqual(["twelve"]);
    });

    it("€40 on €52 does not allow €39.99", () => {
      const lines = [dish("small", 1, "12.01"), dish("big", 2, "39.99")];
      const one = source("b1", 1, lines, { received: "40.00" });

      const next = pickOnBill(one, wholeOf("b1"), new Set(["small"]));

      expect(billTick(one, next)).toBe("none");
      expect(next.whole.size).toBe(0);
    });

    it("binds picks only: the whole tick stands, and its rows draw no floor stop", () => {
      const lines = [dish("a", 1, "26.00"), dish("b", 2, "26.00")];
      const one = source("b1", 1, lines, { received: "40.00" });

      const whole = toggleBill(one, NOTHING);
      expect(billTick(one, whole)).toBe("all");
      expect(rowsOf(one, whole).map((row) => row.blocked)).toEqual([null, null]);
      expect(rowsOf(one, NOTHING).map((row) => row.blocked?.reason)).toEqual(["floor", "floor"]);
    });

    it("unticking a row of a whole bill leaves every other row picked, up to the floor", () => {
      const ten = ["a", "b", "c"].map((id, index) => dish(id, index + 1, "10.00"));
      const clean = source("b1", 1, ten);
      const part = source("b1", 1, ten, { received: "20.00" });
      const untick = new Set(["a", "b"]);

      expect(sorted(pickOnBill(clean, wholeOf("b1"), untick).picks.get("b1"))).toEqual(["a", "b"]);
      expect(sorted(pickOnBill(part, wholeOf("b1"), untick).picks.get("b1"))).toEqual(["a"]);
    });

    it("a contribution marks no dish paid", () => {
      const one = source("b1", 1, [dish("a", 1, "26.00")], { received: "10.00" });

      expect(rowsOf(one, NOTHING)[0]!.blocked?.reason).not.toBe("paid");
    });

    it("a paid row of a whole bill keeps its paid stop", () => {
      const lines = [dish("paid", 1, "5.00"), dish("a", 2, "6.00")];
      const one = source("b1", 1, lines, { paid: ["paid"], received: "5.00" });

      expect(rowsOf(one, wholeOf("b1")).map((row) => row.blocked?.reason ?? null)).toEqual([
        "paid",
        null,
      ]);
    });
  });

  describe("a presented bill", () => {
    const lines = [dish("a", 1, "5.00"), dish("b", 2, "6.00")];
    const one = source("b1", 1, lines, { status: "placed" });

    it("takes the header tick", () => {
      expect(billTick(one, toggleBill(one, NOTHING))).toBe("all");
    });

    it("has every row blocked presented, a whole one's too, with nothing left to pick", () => {
      for (const split of [NOTHING, wholeOf("b1")]) {
        expect(rowsOf(one, split).map((row) => row.blocked)).toEqual([
          { reason: "presented" },
          { reason: "presented" },
        ]);
        expect(rowsOf(one, split).map((row) => row.limit)).toEqual([0, 0]);
      }
    });

    it("accepts no pick", () => {
      expect(pickOnBill(one, NOTHING, new Set(["a"]))).toBe(NOTHING);
      const whole = wholeOf("b1");
      expect(pickOnBill(one, whole, new Set(["a"]))).toBe(whole);
    });
  });

  describe("a held bill", () => {
    const lines = [dish("a", 1, "5.00"), dish("b", 2, "6.00")];
    const one = source("b1", 1, lines, { held: luis });

    it("at none takes no toggle", () => {
      expect(toggleBill(one, NOTHING)).toBe(NOTHING);
    });

    it("at all clears on a toggle", () => {
      const next = toggleBill(one, wholeOf("b1"));
      expect(billTick(one, next)).toBe("none");
      expect(next.whole.size).toBe(0);
    });

    it("at some clears on a toggle, picks included", () => {
      const next = toggleBill(one, looseOf({ b1: ["a"] }));
      expect(billTick(one, next)).toBe("none");
      expect(next.picks.has("b1")).toBe(false);
      expect(next.whole.size).toBe(0);
    });

    it("changes nothing on a pick, whatever its tick", () => {
      for (const split of [NOTHING, wholeOf("b1"), looseOf({ b1: ["a"] })]) {
        expect(pickOnBill(one, split, new Set(["b"]))).toBe(split);
      }
    });
  });

  describe("toSelection", () => {
    const one = source("b1", 1, [dish("a", 1, "5.00"), dish("b", 2, "6.00")]);
    const two = source("b2", 2, [dish("c", 3, "5.00"), dish("d", 4, "6.00")]);
    const three = source("b3", 3, [dish("e", 5, "5.00")]);

    it("sorts whole by number and lines by line number, whatever order they came in", () => {
      const split = {
        whole: new Set(["b3", "b1"]),
        picks: new Map([["b2", new Set(["d"])]]),
      };

      expect(toSelection([three, two, one], split)).toEqual({
        wholeBillIds: ["b1", "b3"],
        loose: [{ billId: "b2", lineIds: ["d"] }],
      });
      expect(toSelection([three, two, one], looseOf({ b2: ["c"], b1: ["b"] })).loose).toEqual([
        { billId: "b1", lineIds: ["b"] },
        { billId: "b2", lineIds: ["c"] },
      ]);
    });

    it("lists the lines of a bill in line number order", () => {
      const lines = [dish("late", 9, "5.00"), dish("early", 2, "6.00"), dish("rest", 12, "7.00")];
      const out = source("b1", 1, lines);

      expect(toSelection([out], looseOf({ b1: ["late", "early"] })).loose[0]!.lineIds).toEqual([
        "early",
        "late",
      ]);
    });

    it("never lists a bill twice", () => {
      const split = { whole: new Set(["b1"]), picks: new Map([["b1", new Set(["a"])]]) };

      expect(toSelection([one], split)).toEqual({ wholeBillIds: ["b1"], loose: [] });
    });

    it("gives an empty selection for nothing ticked, and for a pick no row holds", () => {
      expect(toSelection([one, two], NOTHING)).toEqual({ wholeBillIds: [], loose: [] });
      expect(toSelection([one], looseOf({ b1: ["not-here"] }))).toEqual({
        wholeBillIds: [],
        loose: [],
      });
    });
  });

  describe("nothingStays", () => {
    const going = source("b1", 1, [dish("a", 1, "5.00")]);

    it("with a paid bill left: true", () => {
      const paid = source("b2", 2, [dish("p", 2, "5.00")], { status: "settled" });
      expect(nothingStays([going, paid], wholeOf("b1"))).toBe(true);
    });

    it("with an empty open bill left: true", () => {
      expect(nothingStays([going, source("b2", 2, [])], wholeOf("b1"))).toBe(true);
    });

    it("with an own unsent draft on a staying bill: false", () => {
      const staying = source("b2", 2, [], { ownUnsent: true });
      expect(nothingStays([going, staying], wholeOf("b1"))).toBe(false);
    });

    it("with someone else's draft on a staying bill: false", () => {
      const staying = source("b2", 2, [], { held: luis });
      expect(nothingStays([going, staying], wholeOf("b1"))).toBe(false);
    });

    it("with a sent dish on a staying bill: false", () => {
      const staying = source("b2", 2, [dish("d", 2, "5.00")]);
      expect(nothingStays([going, staying], wholeOf("b1"))).toBe(false);
    });

    it("with only loose picks: false, since a whole bill is what everything ticked means", () => {
      const two = [dish("x", 1, "5.00"), dish("y", 2, "5.00")];
      expect(nothingStays([source("b1", 1, two)], looseOf({ b1: ["x"] }))).toBe(false);
    });

    it("with nothing ticked: false", () => {
      expect(nothingStays([going], NOTHING)).toBe(false);
    });

    it("counts a held selected bill as going", () => {
      const held = source("b1", 1, [dish("a", 1, "5.00")], { held: luis });
      expect(nothingStays([held], wholeOf("b1"))).toBe(true);
    });
  });

  describe("anywayNote", () => {
    const going = source("b1", 1, [dish("a", 1, "5.00")]);

    it("with only a paid bill staying: paid", () => {
      expect(anywayNote([going], wholeOf("b1"), true)).toBe("paid");
    });

    it("with a paid bill read in the sources staying: paid", () => {
      const paid = source("b2", 2, [dish("p", 2, "5.00")], { status: "settled" });
      expect(anywayNote([going, paid], wholeOf("b1"), true)).toBe("paid");
    });

    it("with an empty open bill staying beside a paid one: empty", () => {
      expect(anywayNote([going, source("b2", 2, [])], wholeOf("b1"), true)).toBe("empty");
    });

    it("with no bill staying: empty", () => {
      expect(anywayNote([going], wholeOf("b1"), false)).toBe("empty");
    });
  });

  describe("leftWithNothingToPay", () => {
    const steakAndSoup = [dish("steak", 1, "20.00"), dish("soup", 2, "10.00")];
    const partPaid = (options: SourceOptions = {}) =>
      source("b1", 1, steakAndSoup, { received: "20.00", ...options });
    const soupPicked = looseOf({ b1: ["soup"] });
    const wine = source("b2", 2, [dish("wine", 5, "40.00")]);

    it("true when the picks leave a bill holding what it has received", () => {
      expect(leftWithNothingToPay([partPaid()], soupPicked, false)).toBe(true);
    });

    it("false when the picks leave money owing on it", () => {
      const owes = source("b1", 1, steakAndSoup, { received: "19.99" });
      expect(leftWithNothingToPay([owes], soupPicked, false)).toBe(false);
    });

    it("false for the same bill with nothing picked", () => {
      expect(leftWithNothingToPay([partPaid()], NOTHING, false)).toBe(false);
    });

    it("false with a card in progress in place of money received", () => {
      const reserved = source("b1", 1, steakAndSoup, { reserved: "20.00" });
      expect(leftWithNothingToPay([reserved], soupPicked, false)).toBe(false);
    });

    it("false with an untouched bill owing beside it, and true once that bill is ticked", () => {
      expect(leftWithNothingToPay([partPaid(), wine], soupPicked, false)).toBe(false);
      expect(
        leftWithNothingToPay(
          [partPaid(), wine],
          { whole: new Set(["b2"]), picks: soupPicked.picks },
          false,
        ),
      ).toBe(true);
    });

    it("false with an empty bill beside it, even with a paid bill too", () => {
      expect(leftWithNothingToPay([partPaid(), source("b2", 2, [])], soupPicked, true)).toBe(false);
    });

    it("false with this person's unsent dishes on it, since the server then leaves it open", () => {
      expect(leftWithNothingToPay([partPaid({ ownUnsent: true })], soupPicked, false)).toBe(false);
    });

    it("false while someone else's unsent dishes hold it", () => {
      expect(leftWithNothingToPay([partPaid({ held: luis })], soupPicked, false)).toBe(false);
    });

    it("false while a card refund on it is going through, picked from or untouched", () => {
      const covered = source("b1", 1, steakAndSoup, { received: "30.00", refundPending: true });
      expect(leftWithNothingToPay([partPaid({ refundPending: true })], soupPicked, false)).toBe(
        false,
      );
      expect(leftWithNothingToPay([covered], NOTHING, false)).toBe(false);
    });

    it("false with no balance read, whatever the listed total", () => {
      const unread: SplitSource = {
        bill: bill("b1", 1, { total: "0.00" }),
        groups: pickGroups([], () => null, null),
        held: null,
        ownUnsent: false,
        refundPending: false,
      };
      expect(leftWithNothingToPay([unread], NOTHING, true)).toBe(false);
    });

    it("false for a pick left on a bill since paid, whose money covers it", () => {
      const sincePaid = partPaid({ received: "30.00", status: "settled" });
      expect(leftWithNothingToPay([sincePaid], soupPicked, true)).toBe(false);
    });

    it("an untouched bill its money already covers counts, and one with no money does not", () => {
      const covered = source("b1", 1, steakAndSoup, { received: "30.00" });
      const free = source("b1", 1, [dish("water", 1, "0.00")]);
      expect(leftWithNothingToPay([covered], NOTHING, false)).toBe(true);
      expect(leftWithNothingToPay([free], NOTHING, true)).toBe(false);
    });

    it("the rest of a bill that owes nothing and holds no money stays open, paid bill or not", () => {
      const rest = source("b1", 1, [dish("water", 1, "0.00"), dish("soup", 2, "10.00")]);
      expect(leftWithNothingToPay([rest], soupPicked, false)).toBe(false);
      expect(leftWithNothingToPay([rest], soupPicked, true)).toBe(false);
    });

    it("with no bill staying, answers whether a paid bill does", () => {
      const going = source("b1", 1, steakAndSoup);
      expect(leftWithNothingToPay([going], wholeOf("b1"), true)).toBe(true);
      expect(leftWithNothingToPay([going], wholeOf("b1"), false)).toBe(false);
    });

    it("agrees with Everything ticked's note, which does not show for a bill left fully paid", () => {
      const going = source("b2", 2, [dish("wine", 5, "40.00")]);
      const split = { whole: new Set(["b2"]), picks: soupPicked.picks };
      expect(leftWithNothingToPay([going, partPaid()], split, false)).toBe(true);
      expect(nothingStays([going, partPaid()], split)).toBe(false);

      expect(anywayNote([going], wholeOf("b2"), true)).toBe("paid");
      expect(leftWithNothingToPay([going], wholeOf("b2"), true)).toBe(true);

      const empty = source("b3", 3, []);
      expect(nothingStays([going, empty], wholeOf("b2"))).toBe(true);
      expect(anywayNote([going, empty], wholeOf("b2"), true)).toBe("empty");
      expect(leftWithNothingToPay([going, empty], wholeOf("b2"), true)).toBe(false);
    });
  });

  describe("splitSourcesFrom", () => {
    const a = dish("a", 1, "5.00");
    const b = dish("b", 2, "6.00");
    const c = dish("c", 3, "7.00");

    it("a fresh dish in a draft takes no bill dish out of the rows", () => {
      const fresh = { id: "fresh", sourceLineId: null, source: null } as unknown as DraftLine;
      const [one] = splitSourcesFrom(
        readOf({ id: "b1", lines: [a, b] }),
        [bill("b1", 1)],
        [{ ...draft("b1", "me", "Me"), lines: [fresh] }],
        "me",
        keyFor,
      );

      expect(named(rowsOf(one!, NOTHING))).toEqual([["a"], ["b"]]);
    });

    it("a bill waits on a refund only while one of its refunds is pending", () => {
      const refunds = (...states: BillRefundView["state"][]) =>
        [
          { refunds: [] },
          { refunds: states.map((state) => ({ state })) },
        ] as unknown as BillBalance["payments"];
      const reading = readOf(
        { id: "pending", lines: [a] },
        { id: "finished", lines: [b] },
        { id: "none", lines: [c] },
      );
      reading.bills[0]!.balance.payments = refunds("completed", "pending");
      reading.bills[1]!.balance.payments = refunds("completed", "failed");

      const sources = splitSourcesFrom(
        reading,
        [bill("pending", 1), bill("finished", 2), bill("none", 3)],
        [],
        "me",
        keyFor,
      );

      expect(sources.map((row) => [row.bill.workingOrderId, row.refundPending])).toEqual([
        ["pending", true],
        ["finished", false],
        ["none", false],
      ]);
    });

    it("someone else's draft sets held with its name and revision and leaves the bill's ownUnsent false", () => {
      const [one] = splitSourcesFrom(
        readOf({ id: "b1", lines: [a] }),
        [bill("b1", 1)],
        [draft("b1", "luis", "Luis", [], 4)],
        "me",
        keyFor,
      );

      expect(one!.held).toEqual({
        draftId: "draft-luis",
        revision: 4,
        ownerName: "Luis",
        takenFromYou: false,
      });
      expect(one!.ownUnsent).toBe(false);
    });

    it("a holder the server has no name for carries null, never an invented name", () => {
      const [one] = splitSourcesFrom(
        readOf({ id: "b1", lines: [a] }),
        [bill("b1", 1)],
        [draft("b1", "gone", "")],
        "me",
        keyFor,
      );

      expect(one!.held).toEqual({
        draftId: "draft-gone",
        revision: 0,
        ownerName: null,
        takenFromYou: false,
      });
    });

    it("a holder who took the draft from this person marks it, and from anyone else does not", () => {
      const takenFrom = (billId: string, personId: string) => ({
        ...draft(billId, "luis", "Luis"),
        takenOverFrom: { personId, name: "" },
      });
      const [mine, theirs] = splitSourcesFrom(
        readOf({ id: "b1", lines: [a] }, { id: "b2", lines: [b] }),
        [bill("b1", 1), bill("b2", 2)],
        [takenFrom("b1", "me"), takenFrom("b2", "marta")],
        "me",
        keyFor,
      );

      expect(mine!.held!.takenFromYou).toBe(true);
      expect(theirs!.held!.takenFromYou).toBe(false);
    });

    it("this person's draft sets ownUnsent and no held", () => {
      const [one, two] = splitSourcesFrom(
        readOf({ id: "b1", lines: [a] }, { id: "b2", lines: [c] }),
        [bill("b1", 1), bill("b2", 2)],
        [draft("b1", "me", "Me")],
        "me",
        keyFor,
      );

      expect(one!.ownUnsent).toBe(true);
      expect(one!.held).toBeNull();
      expect(two!.ownUnsent).toBe(false);
      expect(two!.held).toBeNull();
    });

    it("a bill absent from the bills list is left out", () => {
      const sources = splitSourcesFrom(
        readOf({ id: "b1", lines: [a] }, { id: "b2", lines: [c] }),
        [bill("b2", 2)],
        [],
        "me",
        keyFor,
      );

      expect(sources.map((one) => one.bill.workingOrderId)).toEqual(["b2"]);
    });

    it("comes in number order whatever the read's order", () => {
      const sources = splitSourcesFrom(
        readOf({ id: "b9", lines: [c] }, { id: "b1", lines: [a] }),
        [bill("b1", 2), bill("b9", 1)],
        [],
        "me",
        keyFor,
      );

      expect(sources.map((one) => one.bill.workingOrderId)).toEqual(["b9", "b1"]);
    });

    it("draws rows from the read's lines and balance, and groups with the key it is given", () => {
      const paidLines = balanceOf([a, b], { paid: ["a"], received: "5.00" });
      const [one] = splitSourcesFrom(
        { bills: [{ billId: "b1", lines: [a, b], balance: paidLines }] },
        [bill("b1", 1)],
        [],
        "me",
        keyFor,
      );

      expect(rowsOf(one!, NOTHING).map((row) => row.blocked?.reason ?? null)).toEqual([
        "paid",
        null,
      ]);
    });
  });

  describe("splitSummary", () => {
    const one = source("b1", 1, [
      dish("a", 1, "11.00"),
      dish("b", 2, "11.00"),
      dish("c", 3, "11.00"),
      dish("d", 4, "67.00"),
    ]);
    const two = source("b2", 2, [dish("e", 5, "46.00")]);
    const three = source("b3", 3, [dish("f", 6, "30.00")]);
    const split = {
      whole: new Set(["b3", "b2"]),
      picks: new Map([["b1", new Set(["a", "b", "c"])]]),
    };

    it("board 08: T8 takes Bill 2, Bill 3 and 3 dishes from Bill 1, €109.00; T7 keeps the rest of Bill 1, €67.00", () => {
      const summary = splitSummary([three, one, two], split);

      expect(summary.takes.whole.map((s) => s.bill.workingOrderId)).toEqual(["b2", "b3"]);
      expect(summary.takes.loose.map((p) => [p.source.bill.workingOrderId, p.count])).toEqual([
        ["b1", 3],
      ]);
      expect(summary.takes.amount).toBe(decimal("109.00"));
      expect(summary.keeps.whole).toEqual([]);
      expect(summary.keeps.rest.map((s) => s.bill.workingOrderId)).toEqual(["b1"]);
      expect(summary.keeps.amount).toBe(decimal("67.00"));
    });

    it("nothing ticked keeps every bill whole", () => {
      const summary = splitSummary([two, three], NOTHING);

      expect(summary.takes).toEqual({ whole: [], loose: [], amount: decimal("0.00") });
      expect(summary.keeps.whole.map((s) => s.bill.workingOrderId)).toEqual(["b2", "b3"]);
      expect(summary.keeps.rest).toEqual([]);
      expect(summary.keeps.amount).toBe(decimal("76.00"));
    });

    it("leaves a paid bill out of what stays", () => {
      const paid = source("b4", 4, [dish("p", 7, "9.00")], { status: "settled" });

      const summary = splitSummary([two, paid], wholeOf("b2"));
      expect(summary.keeps).toEqual({ whole: [], rest: [], amount: decimal("0.00") });
    });

    it("takes the bill's listed total while no balance has been read", () => {
      const lines = [dish("a", 1, "8.00")];
      const unread: SplitSource = {
        bill: bill("b1", 1, { total: "8.00" }),
        groups: pickGroups(lines, () => null, null),
        held: null,
        ownUnsent: false,
        refundPending: false,
      };

      expect(splitSummary([unread], wholeOf("b1")).takes.amount).toBe(decimal("8.00"));
    });

    it("counts a held selected bill as going", () => {
      const heldWhole = source("b2", 2, [dish("e", 5, "46.00")], { held: luis });
      const heldLoose = source("b1", 1, [dish("a", 1, "11.00"), dish("d", 4, "67.00")], {
        held: luis,
      });

      const summary = splitSummary([heldWhole, heldLoose], {
        whole: new Set(["b2"]),
        picks: new Map([["b1", new Set(["a"])]]),
      });
      expect(summary.takes.amount).toBe(decimal("57.00"));
      expect(summary.keeps.amount).toBe(decimal("67.00"));
    });
  });

  describe("tidySplit", () => {
    const a = dish("a", 1, "5.00");
    const b = dish("b", 2, "6.00");
    const c = dish("c", 3, "7.00");

    it("a re-read that pays a picked dish drops it and names its bill in changed", () => {
      const one = source("b1", 1, [a, b, c]);
      const split = looseOf({ b1: ["a", "b"] });
      const paid = source("b1", 1, [a, b, c], { paid: ["a"], received: "5.00" });

      const out = tidySplit(drawn([one], split), [paid], split);

      expect(sorted(out.split.picks.get("b1"))).toEqual(["b"]);
      expect(out.changed).toEqual(["b1"]);
      expect(out.gone).toEqual([]);
    });

    it("the same when it was the bill's last pick: the tick goes to none", () => {
      const one = source("b1", 1, [a, b]);
      const split = looseOf({ b1: ["a"] });
      const paid = source("b1", 1, [a, b], { paid: ["a"], received: "5.00" });

      const out = tidySplit(drawn([one], split), [paid], split);

      expect(billTick(paid, out.split)).toBe("none");
      expect(out.split.picks.has("b1")).toBe(false);
      expect(out.changed).toEqual(["b1"]);
    });

    it("a re-read that pays one of 2 of 4 names the bill, and the count stays", () => {
      const lines = fourBeerLines();
      const one = source("b1", 1, lines);
      const split = looseOf({ b1: ["c1", "c2"] });
      const paid = source("b1", 1, lines, { paid: ["c1"], received: "5.00" });

      const out = tidySplit(drawn([one], split), [paid], split);

      expect(sorted(out.split.picks.get("b1"))).toEqual(["c2", "c3"]);
      expect(out.changed).toEqual(["b1"]);
    });

    it("a re-read that presents a bill with picks drops them and names it in changed", () => {
      const one = source("b1", 1, [a, b]);
      const split = looseOf({ b1: ["a"] });
      const presented = source("b1", 1, [a, b], { status: "placed" });

      const out = tidySplit(drawn([one], split), [presented], split);

      expect(out.split.picks.has("b1")).toBe(false);
      expect(out.changed).toEqual(["b1"]);
    });

    it("a re-read that removes a picked dish names the bill, with no row left to say why", () => {
      const one = source("b1", 1, [a, b, c]);
      const split = looseOf({ b1: ["a", "b"] });
      const removed = source("b1", 1, [b, c]);

      const out = tidySplit(drawn([one], split), [removed], split);

      expect(sorted(out.split.picks.get("b1"))).toEqual(["b"]);
      expect(out.changed).toEqual(["b1"]);
      expect(named(rowsOf(removed, out.split)).flat()).not.toContain("a");
    });

    it("a re-read whose money reaches the floor takes a pick with no dish paid", () => {
      const ten = (id: string, lineNo: number) => dish(id, lineNo, "10.00");
      const lines = [ten("x", 1), ten("y", 2), ten("z", 3)];
      const one = source("b1", 1, lines);
      const split = looseOf({ b1: ["x", "y"] });
      const funded = source("b1", 1, lines, { received: "20.00" });

      const out = tidySplit(drawn([one], split), [funded], split);

      expect(sorted(out.split.picks.get("b1"))).toEqual(["x"]);
      expect(out.changed).toEqual(["b1"]);
      const reasons = rowsOf(funded, out.split).map((row) => row.blocked?.reason ?? null);
      expect(reasons).toEqual([null, "floor", "floor"]);
    });

    it("a re-read where a whole bill is presented stays whole and names nothing", () => {
      const one = source("b1", 1, [a, b]);
      const split = wholeOf("b1");
      const presented = source("b1", 1, [a, b], { status: "placed" });

      const out = tidySplit(drawn([one], split), [presented], split);

      expect([...out.split.whole]).toEqual(["b1"]);
      expect(out.changed).toEqual([]);
      expect(out.gone).toEqual([]);
    });

    it("a re-read where a whole bill is part-paid stays whole and names nothing", () => {
      const one = source("b1", 1, [a, b]);
      const split = wholeOf("b1");
      const paid = source("b1", 1, [a, b], { paid: ["a"], received: "5.00" });

      const out = tidySplit(drawn([one], split), [paid], split);

      expect([...out.split.whole]).toEqual(["b1"]);
      expect(out.changed).toEqual([]);
    });

    it("a selected bill, whole or loose, the read no longer lists leaves the selection and is named in gone", () => {
      const one = source("b1", 1, [a]);
      const two = source("b2", 2, [b, c]);
      const stays = source("b3", 3, [dish("d", 4, "5.00")]);
      const split = { whole: new Set(["b1"]), picks: new Map([["b2", new Set(["b"])]]) };

      const out = tidySplit(drawn([one, two, stays], split), [stays], split);

      expect(out.gone).toEqual(["b1", "b2"]);
      expect(out.changed).toEqual([]);
      expect(out.split.whole.size).toBe(0);
      expect(out.split.picks.size).toBe(0);
    });

    it("an unselected bill the read no longer lists is named nowhere", () => {
      const one = source("b1", 1, [a]);

      const out = tidySplit(drawn([one], NOTHING), [], NOTHING);

      expect(out.gone).toEqual([]);
    });

    it("gone and changed follow the order of before", () => {
      const one = source("b1", 1, [a, c]);
      const two = source("b2", 2, [b, dish("x", 4, "1.00")]);
      const three = source("b3", 3, [dish("y", 5, "1.00")]);
      const four = source("b4", 4, [dish("z", 6, "1.00")]);
      const split = {
        whole: new Set(["b3", "b4"]),
        picks: new Map([
          ["b1", new Set(["a"])],
          ["b2", new Set(["b"])],
        ]),
      };
      const before = new Map([...drawn([four, two, three, one], split)]);

      const out = tidySplit(
        before,
        [
          source("b1", 1, [a, c], { status: "placed" }),
          source("b2", 2, [b, dish("x", 4, "1.00")], { status: "placed" }),
        ],
        split,
      );

      expect(out.gone).toEqual(["b4", "b3"]);
      expect(out.changed).toEqual(["b2", "b1"]);
    });

    it("a selected bill that was never drawn is still accounted for", () => {
      const one = source("b1", 1, [a, b]);
      const split = { whole: new Set(["b9"]), picks: new Map([["b1", new Set(["a"])]]) };

      const out = tidySplit(new Map(), [one], split);

      expect(out.gone).toEqual(["b9"]);
      expect(out.changed).toEqual(["b1"]);
      expect(out.split.picks.has("b1")).toBe(false);
    });

    it("a selected bill, whole or loose, gaining a foreign draft keeps its place, is in heldSelected, and is in neither list", () => {
      const whole = source("b1", 1, [a]);
      const loose = source("b2", 2, [b, c]);
      const split = { whole: new Set(["b1"]), picks: new Map([["b2", new Set(["b"])]]) };
      const held = [source("b1", 1, [a], { held: luis }), source("b2", 2, [b, c], { held: luis })];

      const out = tidySplit(drawn([whole, loose], split), held, split);

      expect([...out.split.whole]).toEqual(["b1"]);
      expect(sorted(out.split.picks.get("b2"))).toEqual(["b"]);
      expect(out.gone).toEqual([]);
      expect(out.changed).toEqual([]);
      expect(heldSelected(held, out.split).map((s) => s.bill.workingOrderId)).toEqual(["b1", "b2"]);
    });

    it("when that draft goes, its ticks and picks are as they were, tidied, and heldSelected is empty", () => {
      const clear = [source("b1", 1, [a]), source("b2", 2, [b, c])];
      const held = [source("b1", 1, [a], { held: luis }), source("b2", 2, [b, c], { held: luis })];
      const split = { whole: new Set(["b1"]), picks: new Map([["b2", new Set(["b"])]]) };

      const during = tidySplit(drawn(clear, split), held, split);
      const after = tidySplit(drawn(held, during.split), clear, during.split);

      expect([...after.split.whole]).toEqual(["b1"]);
      expect(sorted(after.split.picks.get("b2"))).toEqual(["b"]);
      expect(after.gone).toEqual([]);
      expect(after.changed).toEqual([]);
      expect(heldSelected(clear, after.split)).toEqual([]);
    });

    it("a read that removes a bill's only unpicked dish makes it whole, names it, and names it once", () => {
      const split = looseOf({ b1: ["a", "b"] });
      const after = [source("b1", 1, [a, b])];

      const out = tidySplit(drawn([source("b1", 1, [a, b, c])], split), after, split);

      expect([...out.split.whole]).toEqual(["b1"]);
      expect(out.split.picks.has("b1")).toBe(false);
      expect(out.changed).toEqual(["b1"]);
      expect(toSelection(after, out.split)).toEqual({ wholeBillIds: ["b1"], loose: [] });

      expect(tidySplit(drawn(after, out.split), after, out.split).changed).toEqual([]);
    });

    it("a read that takes a pick as well as the only unpicked dish names the bill once", () => {
      const split = looseOf({ b1: ["a", "b"] });

      const out = tidySplit(
        drawn([source("b1", 1, [a, b, c])], split),
        [source("b1", 1, [a])],
        split,
      );

      expect([...out.split.whole]).toEqual(["b1"]);
      expect(out.changed).toEqual(["b1"]);
    });

    it("this person's unsent dishes going, with every sent dish picked, makes the bill whole and names it", () => {
      const split = looseOf({ b1: ["a"] });

      const out = tidySplit(
        drawn([source("b1", 1, [a], { ownUnsent: true })], split),
        [source("b1", 1, [a])],
        split,
      );

      expect([...out.split.whole]).toEqual(["b1"]);
      expect(out.changed).toEqual(["b1"]);
    });

    it("the only unpicked dish leaving under someone else's order names the bill when the order goes", () => {
      const split = looseOf({ b1: ["a", "b"] });
      const held = [source("b1", 1, [a, b], { held: luis })];

      const during = tidySplit(drawn([source("b1", 1, [a, b, c])], split), held, split);
      expect(sorted(during.split.picks.get("b1"))).toEqual(["a", "b"]);
      expect(during.changed).toEqual([]);

      const after = tidySplit(drawn(held, during.split), [source("b1", 1, [a, b])], during.split);
      expect([...after.split.whole]).toEqual(["b1"]);
      expect(after.changed).toEqual(["b1"]);
    });

    it("a read showing this person's own draft on a whole bill leaves it whole and names nothing", () => {
      const split = wholeOf("b1");

      const out = tidySplit(
        drawn([source("b1", 1, [a])], split),
        [source("b1", 1, [a], { ownUnsent: true })],
        split,
      );

      expect([...out.split.whole]).toEqual(["b1"]);
      expect(out.changed).toEqual([]);
    });

    it("a read that leaves another dish unpicked keeps the picks and names nothing", () => {
      const split = looseOf({ b1: ["a"] });

      const out = tidySplit(
        drawn([source("b1", 1, [a, b, c])], split),
        [source("b1", 1, [a, b])],
        split,
      );

      expect(out.split.whole.size).toBe(0);
      expect(sorted(out.split.picks.get("b1"))).toEqual(["a"]);
      expect(out.changed).toEqual([]);
    });

    it("a read that leaves only a paid dish unpicked keeps the picks and names nothing", () => {
      const split = looseOf({ b1: ["a"] });

      const out = tidySplit(
        drawn([source("b1", 1, [a, b, c], { paid: ["c"] })], split),
        [source("b1", 1, [a, c], { paid: ["c"] })],
        split,
      );

      expect(out.split.whole.size).toBe(0);
      expect(sorted(out.split.picks.get("b1"))).toEqual(["a"]);
      expect(out.changed).toEqual([]);
    });

    it("a read changing nothing names nothing, on a floor bill too", () => {
      const floor = source(
        "b1",
        1,
        [dish("twelve", 1, "12.00"), ...fourBeerLines(2), dish("big", 6, "20.00")],
        {
          received: "40.00",
        },
      );
      const whole = source("b2", 2, [dish("w", 7, "9.00")]);
      const held = source("b3", 3, [dish("h", 8, "9.00")], { held: luis });
      const start = pickOnBill(floor, wholeOf("b2"), new Set(["twelve"]));
      const sources = [floor, whole, held];

      const out = tidySplit(drawn(sources, start), sources, start);

      expect(out.changed).toEqual([]);
      expect(out.gone).toEqual([]);
      expect([...out.split.whole]).toEqual(["b2"]);
      expect(sorted(out.split.picks.get("b1"))).toEqual(["twelve"]);
    });
  });

  describe("heldSelected", () => {
    const heldBy = (id: string, number: number, ownerName: string | null) =>
      source(id, number, [dish(`d${id}`, number, "5.00")], {
        held: { draftId: `draft-${id}`, revision: 0, ownerName, takenFromYou: false },
      });

    it("is in number order and leaves out an unselected held bill", () => {
      const out = heldSelected(
        [heldBy("b3", 3, "Ana"), heldBy("b2", 2, "Luis"), heldBy("b1", 1, "Eva")],
        { whole: new Set(["b3"]), picks: new Map([["b1", new Set(["db1"])]]) },
      );

      expect(out.map((s) => s.bill.workingOrderId)).toEqual(["b1", "b3"]);
    });

    it("leaves out a selected bill nobody else holds", () => {
      const free = source("b1", 1, [dish("a", 1, "5.00")]);
      expect(heldSelected([free], wholeOf("b1"))).toEqual([]);
    });

    it("supplies each holder for the foot line: one person, two people, or no name at all", () => {
      const names = (split: SplitPicks, ...sources: SplitSource[]) =>
        heldSelected(sources, split).map((s) => s.held!.ownerName);

      expect(names(wholeOf("b1"), heldBy("b1", 1, "Ana"))).toEqual(["Ana"]);
      expect(names(wholeOf("b1", "b2"), heldBy("b2", 2, "Luis"), heldBy("b1", 1, "Ana"))).toEqual([
        "Ana",
        "Luis",
      ]);
      expect(names(wholeOf("b1"), heldBy("b1", 1, null))).toEqual([null]);
    });

    it("keeps bill order independent of list order, with a bill stored with no number last", () => {
      const out = heldSelected(
        [
          heldBy("b0", 0, "Ana"),
          source("x", null, [], { held: luis }),
          heldBy("b1", 1, "Eva"),
        ].reverse(),
        wholeOf("x", "b0", "b1"),
      );

      expect(out.map((s) => s.bill.workingOrderId)).toEqual(["b0", "b1", "x"]);
    });
  });
});
