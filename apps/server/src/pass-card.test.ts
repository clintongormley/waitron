import { describe, expect, it } from "vitest";
import type { TicketState } from "./kitchen-print.js";
import type { PassScope } from "./pass-board.js";
import {
  buildPassBoard,
  passCardRelease,
  type PassBoard,
  type PassCard,
  type PassRow,
  type PassTarget,
} from "./pass-card.js";

const grill = "station-grill";
const cold = "station-cold";
const bar = "station-bar";
const fryer = "station-fryer";
const inside = "zone-inside";

const HOT: PassScope = { stationIds: [grill], zoneIds: [inside] };
const COLD: PassScope = { stationIds: [cold], zoneIds: [inside] };
const EVERY: PassScope = { stationIds: null, zoneIds: null };

const at = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;

const party = "party-p";
const bill1 = "bill-1";
const bill2 = "bill-2";

type Group = NonNullable<PassRow["group"]>;
const groupG: Group = {
  id: "group-g",
  partyId: party,
  partyRevision: 7,
  state: "fired",
  requestKind: "added",
  position: 1,
  createdAt: at("11:50"),
  displayNumber: 1,
  partyFirstCreatedAt: at("11:50"),
};

const openedAt: Record<string, string> = { [bill1]: at("12:00"), [bill2]: at("12:01") };

type RowAsk = Partial<Omit<PassRow, "item">> & { id: string; state?: TicketState };

/** Requested at Grill, inside, on bill 1 of group G, unless overridden. */
function row(ask: RowAsk): PassRow {
  const { id, state = "queued", ...rest } = ask;
  const orderId = rest.orderId ?? bill1;
  const firedAt = rest.firedAt === undefined ? null : rest.firedAt;
  return {
    item: {
      allergy: null,
      id,
      name: `NAME ${id}`,
      qty: "1",
      unitName: null,
      unitPrecision: null,
      soldInEach: true,
      stationName: "Grill",
      state,
      firedAt,
      note: null,
      modifiers: [],
      asServed: { allergens: {}, pending: false },
      queuedAt: at("12:00"),
      thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 20 },
      band: "fresh",
    },
    lineId: `line-${id}`,
    orderId,
    stationId: grill,
    zoneId: inside,
    partyId: party,
    partyRevision: 7,
    course: null,
    group: groupG,
    requestedAt: at("12:00"),
    firedAt,
    readyAt: null,
    passControlled: true,
    stationWaitsNow: true,
    stationClosed: false,
    extra: false,
    remaining: 1000,
    recalled: false,
    lineNo: 1,
    order: { orderNumber: 1, kitchenNote: null, openedAt: openedAt[orderId] ?? at("12:00") },
    ...rest,
  };
}

const released = (ask: RowAsk & { state: TicketState }): PassRow =>
  row({ firedAt: at("12:00"), ...ask });

const held = (ask: RowAsk): PassRow => row({ requestedAt: null, firedAt: null, ...ask });

const mains = { id: "course-mains", name: "Mains", displayOrder: 2 };

/** Master Task 5's case: group G on two bills. */
function caseOneRows(): PassRow[] {
  return [
    row({ id: "grill-1", lineNo: 1, course: mains }),
    released({
      id: "cold-1",
      orderId: bill2,
      stationId: cold,
      state: "preparing",
      lineNo: 1,
      order: { orderNumber: 2, kitchenNote: null, openedAt: at("12:01") },
    }),
    released({ id: "bar-1", stationId: bar, state: "ready", passControlled: false, lineNo: 2 }),
  ];
}

const cards = (board: PassBoard): PassCard[] => [
  ...board.held,
  ...board.toFire,
  ...board.inProgress,
  ...board.ready,
];

const columnOf = (board: PassBoard, key: string): string | undefined =>
  (["held", "toFire", "inProgress", "ready"] as const).find((column) =>
    board[column].some((card) => card.key === key),
  );

const itemOf = (card: PassCard, id: string) => card.items.find((item) => item.id === id)!;

describe("A773 pass board: cards", () => {
  it("1. puts one group on one card across two bills", () => {
    const board = buildPassBoard(caseOneRows(), HOT);
    expect(board.toFire).toHaveLength(1);
    expect(cards(board)).toHaveLength(1);
    const card = board.toFire[0]!;
    expect(card.key).toBe("group:group-g");
    expect(card.target).toEqual({ kind: "group", partyId: party, groupId: "group-g" });
    expect(card.kind).toBe("added");
    expect(card.allReady).toBe(false);
    expect(card.items).toHaveLength(3);
    expect(itemOf(card, "grill-1")).toMatchObject({
      visible: true,
      informational: false,
      phase: "requested",
    });
    expect(itemOf(card, "cold-1")).toMatchObject({
      visible: false,
      informational: true,
      phase: "preparing",
    });
    expect(itemOf(card, "bar-1")).toMatchObject({ visible: false, informational: true });
    expect(card.orders.map((order) => order.orderId)).toEqual([bill1, bill2]);
  });

  it("2. is ready only when every part is ready", () => {
    const readyRows = [
      released({ id: "grill-1", state: "ready", readyAt: at("12:01") }),
      released({
        id: "cold-1",
        orderId: bill2,
        stationId: cold,
        state: "ready",
        readyAt: at("12:03"),
      }),
      released({ id: "bar-1", stationId: bar, state: "ready", readyAt: at("12:02") }),
    ];
    const board = buildPassBoard(readyRows, HOT);
    expect(board.ready).toHaveLength(1);
    expect(board.ready[0]!.allReady).toBe(true);
    expect(board.ready[0]!.readyAt).toBe(at("12:03"));

    const coldBack = readyRows.map((r) =>
      r.item.id === "cold-1"
        ? released({ id: "cold-1", orderId: bill2, stationId: cold, state: "preparing" })
        : r,
    );
    const narrowed = buildPassBoard(coldBack, HOT);
    expect(narrowed.ready).toHaveLength(0);
    expect(narrowed.inProgress).toHaveLength(1);
    expect(narrowed.inProgress[0]!.allReady).toBe(false);
  });

  it("3. shows a held group as held, informational by its station's setting now", () => {
    const heldGroup: Group = { ...groupG, id: "group-h", state: "held" };
    const board = buildPassBoard(
      [
        held({ id: "waits", group: heldGroup, stationWaitsNow: true }),
        held({ id: "does-not-wait", group: heldGroup, stationWaitsNow: false, lineNo: 2 }),
      ],
      HOT,
    );
    expect(board.held).toHaveLength(1);
    const card = board.held[0]!;
    expect(card.kind).toBe("held");
    expect(card.requestedAt).toBeNull();
    expect(card.allReady).toBe(false);
    expect(itemOf(card, "waits").informational).toBe(false);
    expect(itemOf(card, "does-not-wait").informational).toBe(true);
  });

  it("4. leaves a card whose only Requested part is another pass's in progress", () => {
    const board = buildPassBoard(
      [
        row({ id: "cold-req", stationId: cold }),
        released({ id: "grill-prep", state: "preparing", lineNo: 2 }),
      ],
      HOT,
    );
    expect(board.toFire).toHaveLength(0);
    expect(board.inProgress).toHaveLength(1);
    expect(itemOf(board.inProgress[0]!, "cold-req")).toMatchObject({
      phase: "requested",
      visible: false,
    });
  });

  it("5. puts no recalled or fully served row on a card", () => {
    const group: Group = { ...groupG, id: "group-5" };
    const gone = [
      row({ id: "recalled", group, recalled: true }),
      row({ id: "served", group, remaining: 0, lineNo: 2 }),
    ];
    expect(cards(buildPassBoard(gone, EVERY))).toEqual([]);

    const board = buildPassBoard([...gone, row({ id: "live", group, lineNo: 3 })], EVERY);
    expect(board.toFire).toHaveLength(1);
    expect(board.toFire[0]!.items.map((item) => item.id)).toEqual(["live"]);
    expect(cards(board)).toHaveLength(1);
  });

  it("6. waits for two separately routed extras", () => {
    const board = buildPassBoard(caseSixRows(), EVERY);
    expect(board.toFire).toHaveLength(1);
    expect(board.toFire[0]!.allReady).toBe(false);

    const later = caseSixRows().map((r) =>
      r.item.id === "chips"
        ? released({
            id: "chips",
            stationId: fryer,
            extra: true,
            lineNo: 2,
            state: "ready",
            readyAt: at("12:04"),
          })
        : r,
    );
    const done = buildPassBoard(later, EVERY);
    expect(done.ready).toHaveLength(1);
    expect(done.ready[0]!.allReady).toBe(true);
  });

  it("7. gives each bill's ungrouped dishes a card of their own", () => {
    const counter = { group: null, partyId: null, partyRevision: null };
    const board = buildPassBoard(
      [
        row({ id: "c1-3", orderId: "bill-c1", lineNo: 3, ...counter }),
        row({ id: "c1-1", orderId: "bill-c1", lineNo: 1, ...counter }),
        row({ id: "c1-2", orderId: "bill-c1", lineNo: 2, ...counter }),
        row({ id: "c2-1", orderId: "bill-c2", lineNo: 1, ...counter }),
      ],
      EVERY,
    );
    expect(cards(board)).toHaveLength(2);
    for (const card of cards(board)) {
      expect(card.target.kind).toBe("bill");
      expect(card.kind).toBe("new_order");
      expect(card.group).toBeUndefined();
      expect(card.party).toBeUndefined();
    }
    const c1 = cards(board).find((card) => card.key === "bill:bill-c1")!;
    expect(c1.target).toEqual({ kind: "bill", workingOrderId: "bill-c1" });
    expect(c1.items.map((item) => item.id)).toEqual(["c1-1", "c1-2", "c1-3"]);
    expect(cards(board).find((card) => card.key === "bill:bill-c2")!.target).toEqual({
      kind: "bill",
      workingOrderId: "bill-c2",
    });

    const ungrouped = buildPassBoard(
      [
        row({ id: "p-b1", orderId: "bill-b1", group: null }),
        row({ id: "p-b2", orderId: "bill-b2", group: null }),
      ],
      EVERY,
    );
    expect(
      cards(ungrouped)
        .map((card) => card.key)
        .sort(),
    ).toEqual(["bill:bill-b1", "bill:bill-b2"]);
    for (const card of cards(ungrouped)) expect(card.party).toBeUndefined();
  });

  it("8. shows a dish in no zone only to a pass on every zone", () => {
    const rows = [row({ id: "no-zone", zoneId: null })];
    expect(cards(buildPassBoard(rows, EVERY))).toHaveLength(1);
    expect(cards(buildPassBoard(rows, { stationIds: null, zoneIds: null }))).toHaveLength(1);
    expect(cards(buildPassBoard(rows, HOT))).toEqual([]);
    expect(cards(buildPassBoard(rows, { stationIds: null, zoneIds: [inside] }))).toEqual([]);
  });

  it("9. hides informational items only, never changing the column", () => {
    const rows = [
      released({ id: "grill-ready", state: "ready", readyAt: at("12:02") }),
      released({ id: "cold-prep", orderId: bill2, stationId: cold, state: "preparing" }),
    ];
    const shown = buildPassBoard(rows, HOT);
    expect(shown.inProgress).toHaveLength(1);
    expect(shown.inProgress[0]!.allReady).toBe(false);
    expect(shown.inProgress[0]!.readyAt).toBeNull();

    const hidden = buildPassBoard(rows, HOT, { showNonPassStations: false });
    expect(hidden.inProgress).toHaveLength(1);
    const card = hidden.inProgress[0]!;
    expect(card.items.map((item) => item.id)).toEqual(["grill-ready"]);
    expect(hidden.overview.map((fact) => fact.lineId)).toEqual(["line-grill-ready"]);
    const facts = (c: PassCard) => [c.kind, c.allReady, c.requestedAt, c.readyAt];
    expect(facts(card)).toEqual(facts(shown.inProgress[0]!));
    expect(columnOf(hidden, card.key)).toBe(columnOf(shown, card.key));
  });

  it("10. sorts each column (D63)", () => {
    const a = "aaaaaaaa-0000-4000-8000-000000000000";
    const b = "bbbbbbbb-0000-4000-8000-000000000000";
    const toFire = buildPassBoard(
      [
        row({ id: "a", group: { ...groupG, id: a }, requestedAt: at("12:05") }),
        row({ id: "b", group: { ...groupG, id: b }, requestedAt: at("12:01") }),
      ],
      EVERY,
    );
    expect(toFire.toFire.map((card) => card.key)).toEqual([`group:${b}`, `group:${a}`]);

    const twoParts = buildPassBoard(
      [
        row({ id: "a1", group: { ...groupG, id: a }, requestedAt: at("12:03") }),
        row({ id: "a2", group: { ...groupG, id: a }, requestedAt: at("12:01"), lineNo: 2 }),
        row({ id: "b", group: { ...groupG, id: b }, requestedAt: at("12:02") }),
      ],
      EVERY,
    );
    expect(twoParts.toFire.map((card) => [card.key, card.requestedAt])).toEqual([
      [`group:${a}`, at("12:01")],
      [`group:${b}`, at("12:02")],
    ]);

    const inProgress = buildPassBoard(
      [
        released({
          id: "a",
          group: { ...groupG, id: a },
          state: "preparing",
          requestedAt: at("12:05"),
        }),
        released({
          id: "b",
          group: { ...groupG, id: b },
          state: "preparing",
          requestedAt: at("12:01"),
        }),
      ],
      EVERY,
    );
    expect(inProgress.inProgress.map((card) => card.key)).toEqual([`group:${b}`, `group:${a}`]);

    const ready = buildPassBoard(
      [
        released({ id: "a", group: { ...groupG, id: a }, state: "ready", readyAt: at("12:10") }),
        released({ id: "b", group: { ...groupG, id: b }, state: "ready", readyAt: at("12:04") }),
      ],
      EVERY,
    );
    expect(ready.ready.map((card) => card.key)).toEqual([`group:${b}`, `group:${a}`]);

    const heldGroup = (
      id: string,
      createdAt: string,
      position: number,
      partyId = party,
      partyFirstCreatedAt = createdAt,
    ): Group => ({
      ...groupG,
      id,
      partyId,
      state: "held",
      createdAt,
      position,
      partyFirstCreatedAt,
    });
    const oneParty = buildPassBoard(
      [
        held({ id: "g1", group: heldGroup(a, at("12:00"), 2, party, at("12:00")) }),
        held({ id: "g2", group: heldGroup(b, at("12:05"), 1, party, at("12:00")) }),
      ],
      EVERY,
    );
    expect(oneParty.held.map((card) => card.key)).toEqual([`group:${b}`, `group:${a}`]);

    const twoParties = buildPassBoard(
      [
        held({ id: "pa", partyId: a, group: heldGroup(a, at("12:10"), 1, a) }),
        held({ id: "pb", partyId: b, group: heldGroup(b, at("12:00"), 2, b) }),
      ],
      EVERY,
    );
    expect(twoParties.held.map((card) => card.key)).toEqual([`group:${b}`, `group:${a}`]);

    const firstCourseServed = buildPassBoard(
      [
        held({ id: "pa", partyId: a, group: heldGroup(a, at("12:10"), 2, a, at("11:00")) }),
        held({ id: "pb", partyId: b, group: heldGroup(b, at("12:00"), 1, b) }),
      ],
      EVERY,
    );
    expect(firstCourseServed.held.map((card) => card.key)).toEqual([`group:${a}`, `group:${b}`]);
  });

  it("11. fires a held group's Requested extras as its request kind", () => {
    const heldGroup: Group = {
      ...groupG,
      id: "group-11",
      state: "held",
      requestKind: "next_course",
    };
    const board = buildPassBoard(
      [
        held({ id: "dish", group: heldGroup }),
        row({ id: "chips", group: heldGroup, stationId: fryer, extra: true, lineNo: 2 }),
      ],
      EVERY,
    );
    expect(board.toFire).toHaveLength(1);
    expect(board.toFire[0]!.kind).toBe("next_course");
    expect(itemOf(board.toFire[0]!, "dish").phase).toBe("held");
  });

  it("12. keeps a Requested item pass work at a station that no longer waits", () => {
    const board = buildPassBoard(
      [row({ id: "moved", passControlled: true, stationWaitsNow: false })],
      HOT,
    );
    expect(board.toFire).toHaveLength(1);
    expect(itemOf(board.toFire[0]!, "moved").informational).toBe(false);
  });

  it("13. lists every item's facts in the overview, in card order", () => {
    const board = buildPassBoard(caseSixRows(), EVERY);
    expect(board.overview).toEqual(
      ["burger", "chips", "rings"].map((id, index) => ({
        lineId: `line-${id}`,
        stationId: [grill, fryer, bar][index],
        name: `NAME ${id}`,
        qty: "1",
        phase: ["ready", "requested", "ready"][index],
        informational: false,
        unitName: null,
        soldInEach: true,
      })),
    );
  });

  it("14. keeps a card with a dish at a closed station in To fire, flagging it", () => {
    const rows = caseOneRows().map((r) =>
      r.item.id === "grill-1" ? { ...r, stationClosed: true } : r,
    );
    const board = buildPassBoard(rows, HOT);
    expect(board.toFire).toHaveLength(1);
    const card = board.toFire[0]!;
    expect(itemOf(card, "grill-1").stationClosed).toBe(true);
    expect(itemOf(card, "cold-1").stationClosed).toBe(false);
    expect(itemOf(card, "bar-1").stationClosed).toBe(false);

    const withChips = buildPassBoard(
      [
        row({ id: "burger", lineNo: 1 }),
        row({ id: "chips", stationId: fryer, extra: true, stationClosed: true, lineNo: 2 }),
      ],
      EVERY,
    );
    expect(withChips.toFire).toHaveLength(1);
    const chipsCard = withChips.toFire[0]!;
    expect(itemOf(chipsCard, "chips")).toMatchObject({ extra: true, stationClosed: true });
    expect(itemOf(chipsCard, "burger").extra).toBe(false);
  });

  it("15. carries what today's Ready levers send (D62)", () => {
    const board = buildPassBoard(caseOneRows(), HOT);
    expect(board.toFire).toHaveLength(1);
    const card = board.toFire[0]!;
    expect(card.party).toEqual({ id: party, revision: 7 });
    expect(itemOf(card, "grill-1").course).toEqual(mains);
    expect(itemOf(card, "cold-1").course).toBeNull();

    const counter = buildPassBoard(
      [row({ id: "c", orderId: "bill-c", group: null, partyId: null, partyRevision: null })],
      EVERY,
    );
    expect(counter.toFire[0]!.party).toBeUndefined();
  });

  it("16. orders a card's items by bill opening, then course with none first, then line", () => {
    const starters = { id: "course-starters", name: "Starters", displayOrder: 1 };
    const board = buildPassBoard(
      [
        row({ id: "b2-none", orderId: bill2, lineNo: 1 }),
        row({ id: "b1-mains", lineNo: 1, course: mains }),
        row({ id: "b1-starters", lineNo: 2, course: starters }),
        row({ id: "b1-none", lineNo: 3 }),
      ],
      EVERY,
    );
    expect(board.toFire[0]!.items.map((item) => item.id)).toEqual([
      "b1-none",
      "b1-starters",
      "b1-mains",
      "b2-none",
    ]);
  });
});

function caseSixRows(): PassRow[] {
  return [
    released({ id: "burger", state: "ready", readyAt: at("12:02"), lineNo: 1 }),
    row({ id: "chips", stationId: fryer, extra: true, lineNo: 2 }),
    released({
      id: "rings",
      stationId: bar,
      extra: true,
      state: "ready",
      readyAt: at("12:03"),
      lineNo: 3,
    }),
  ];
}

const targetG: PassTarget = { kind: "group", partyId: party, groupId: "group-g" };
const DIGEST = /^[0-9a-f]{64}$/;
const contextOf = (rows: readonly PassRow[], scope: PassScope) =>
  passCardRelease(targetG, rows, scope).context;
const changed = (rows: PassRow[], id: string, change: Partial<PassRow>) =>
  rows.map((r) => (r.item.id === id ? { ...r, ...change } : r));

describe("A773 pass board: release set", () => {
  it("1. offers only this pass's Requested ids", () => {
    const hot = passCardRelease(targetG, caseOneRows(), HOT);
    expect(hot.ticketItemIds).toEqual(["grill-1"]);
    expect(hot.context).toEqual(expect.stringMatching(DIGEST));
    expect(passCardRelease(targetG, caseOneRows(), COLD)).toEqual({
      ticketItemIds: [],
      context: null,
    });
    const card = buildPassBoard(caseOneRows(), HOT).toFire[0]!;
    expect(card.releaseTicketItemIds).toEqual(["grill-1"]);
    expect(card.releaseContext).toBe(hot.context);
    expect(buildPassBoard(caseOneRows(), HOT, { release: false }).toFire).toEqual([
      { ...card, releaseTicketItemIds: [], releaseContext: null },
    ]);
  });

  it("2. changes the context with each candidate fact", () => {
    const base = [row({ id: "grill-1", lineNo: 1 }), row({ id: "grill-2", lineNo: 2 })];
    const digest = contextOf(base, EVERY);
    expect(digest).toEqual(expect.stringMatching(DIGEST));
    expect(contextOf(changed(base, "grill-1", { remaining: 500 }), EVERY)).not.toBe(digest);
    expect(contextOf(changed(base, "grill-1", { stationId: cold }), EVERY)).not.toBe(digest);
    expect(contextOf(changed(base, "grill-1", { zoneId: "zone-terrace" }), EVERY)).not.toBe(digest);
    expect(contextOf(changed(base, "grill-1", { requestedAt: at("12:07") }), EVERY)).not.toBe(
      digest,
    );
    expect(contextOf(changed(base, "grill-1", { passControlled: false }), EVERY)).not.toBe(digest);
    expect(contextOf(changed(base, "grill-1", { orderId: bill2 }), EVERY)).not.toBe(digest);
    expect(contextOf(changed(base, "grill-1", { lineId: "line-other" }), EVERY)).not.toBe(digest);
    const otherGroup = { group: { ...groupG, id: "group-other" } };
    expect(contextOf(changed(base, "grill-1", otherGroup), EVERY)).not.toBe(digest);
    const billTarget: PassTarget = { kind: "bill", workingOrderId: bill1 };
    expect(passCardRelease(billTarget, base, EVERY).context).not.toBe(digest);
    const served = changed(base, "grill-1", { remaining: 0 });
    expect(passCardRelease(targetG, served, EVERY).ticketItemIds).toEqual(["grill-2"]);
    const recalled = changed(base, "grill-1", { recalled: true });
    expect(passCardRelease(targetG, recalled, EVERY).ticketItemIds).toEqual(["grill-2"]);
    expect(contextOf(recalled, EVERY)).not.toBe(digest);
  });

  it("3. ignores everything but the candidates' facts", () => {
    const base = [
      ...changed(caseOneRows(), "bar-1", {
        item: { ...caseOneRows()[2]!.item, state: "preparing" },
      }),
      row({ id: "cold-2", stationId: cold, lineNo: 3 }),
      row({ id: "grill-2", lineNo: 4 }),
    ];
    const digest = contextOf(base, HOT);
    expect(digest).toEqual(expect.stringMatching(DIGEST));
    const barReady = changed(base, "bar-1", { item: { ...base[2]!.item, state: "ready" } });
    expect(contextOf(barReady, HOT)).toBe(digest);
    const coldFired = changed(base, "cold-2", {
      firedAt: at("12:06"),
      item: { ...base[3]!.item, firedAt: at("12:06") },
    });
    expect(contextOf(coldFired, HOT)).toBe(digest);
    expect(contextOf(changed(base, "bar-1", { remaining: 250 }), HOT)).toBe(digest);
    expect(contextOf(changed(base, "cold-2", { stationClosed: true }), HOT)).toBe(digest);
    expect(contextOf([...base].reverse(), HOT)).toBe(digest);
  });

  it("4. offers nothing on a held card", () => {
    const heldGroup = { ...groupG, state: "held" as const };
    const burger = held({ id: "burger", group: heldGroup });
    expect(passCardRelease(targetG, [burger], HOT)).toEqual({ ticketItemIds: [], context: null });
    const fired = row({ id: "burger" });
    const release = passCardRelease(targetG, [fired], HOT);
    expect(release.ticketItemIds).toEqual(["burger"]);
    expect(release.context).toEqual(expect.stringMatching(DIGEST));
  });

  it("5. keeps the hot and cold passes' contexts independent", () => {
    const base = [
      row({ id: "grill-1", lineNo: 1 }),
      row({ id: "cold-1", stationId: cold, lineNo: 2 }),
    ];
    const hot = contextOf(base, HOT);
    const coldContext = contextOf(base, COLD);
    expect(hot).toEqual(expect.stringMatching(DIGEST));
    expect(coldContext).toEqual(expect.stringMatching(DIGEST));
    expect(contextOf(changed(base, "cold-1", { firedAt: at("12:06") }), HOT)).toBe(hot);
    expect(contextOf(changed(base, "grill-1", { firedAt: at("12:06") }), COLD)).toBe(coldContext);
    expect(buildPassBoard(base, HOT).toFire[0]!.releaseTicketItemIds).toEqual(["grill-1"]);
  });

  it("7. blocks the whole card while a dish candidate's station is closed (D51)", () => {
    const open = [row({ id: "grill-1", lineNo: 1 }), row({ id: "grill-2", lineNo: 2 })];
    const digest = contextOf(open, HOT);
    expect(digest).toEqual(expect.stringMatching(DIGEST));
    expect(
      passCardRelease(targetG, changed(open, "grill-2", { stationClosed: true }), HOT),
    ).toEqual({ ticketItemIds: [], context: null });
    const reopened = changed(changed(open, "grill-2", { stationClosed: true }), "grill-2", {
      stationClosed: false,
    });
    expect(passCardRelease(targetG, reopened, HOT)).toEqual({
      ticketItemIds: ["grill-1", "grill-2"],
      context: digest,
    });

    const chips = (stationClosed: boolean) => [
      row({ id: "burger", lineNo: 1 }),
      row({ id: "chips", stationId: fryer, extra: true, stationClosed, lineNo: 2 }),
    ];
    const withExtra = passCardRelease(targetG, chips(true), EVERY);
    expect(withExtra.ticketItemIds).toEqual(["burger", "chips"]);
    expect(withExtra.context).toEqual(expect.stringMatching(DIGEST));
    expect(withExtra.context).toBe(contextOf(chips(false), EVERY));
  });

  it("8. takes exactly the dishes that put the card in To fire", () => {
    const notPassWork = [row({ id: "grill-1", passControlled: false })];
    expect(passCardRelease(targetG, notPassWork, EVERY)).toEqual({
      ticketItemIds: [],
      context: null,
    });
    const board = buildPassBoard(notPassWork, EVERY);
    expect(board.toFire).toEqual([]);
    expect(board.inProgress.map((card) => card.releaseTicketItemIds)).toEqual([[]]);
  });
});

describe("A773 pass board: dimming", () => {
  it("5. dims non-pass-work dishes in view only when a station in view waits, and Hide drops only those", () => {
    const scope: PassScope = { stationIds: [grill, fryer, bar], zoneIds: null };
    const rows = [
      released({ id: "grill-1", state: "preparing", passControlled: false, lineNo: 1 }),
      released({
        id: "fryer-1",
        stationId: fryer,
        state: "queued",
        passControlled: false,
        lineNo: 2,
      }),
      held({ id: "bar-1", stationId: bar, stationWaitsNow: false, lineNo: 3 }),
      released({
        id: "cold-1",
        stationId: cold,
        state: "queued",
        passControlled: false,
        lineNo: 4,
      }),
    ];
    const informational = (board: PassBoard) =>
      Object.fromEntries(
        cards(board).flatMap((card) => card.items.map((item) => [item.id, item.informational])),
      );

    const calm = buildPassBoard(rows, scope, {
      showNonPassStations: true,
      aStationInViewWaits: false,
    });
    expect(informational(calm)).toEqual({
      "grill-1": false,
      "fryer-1": false,
      "bar-1": false,
      "cold-1": true,
    });

    const waiting = buildPassBoard(rows, scope, {
      showNonPassStations: true,
      aStationInViewWaits: true,
    });
    expect(informational(waiting)).toEqual({
      "grill-1": true,
      "fryer-1": true,
      "bar-1": true,
      "cold-1": true,
    });

    const calmHidden = buildPassBoard(rows, scope, {
      showNonPassStations: false,
      aStationInViewWaits: false,
    });
    expect(cards(calmHidden).flatMap((card) => card.items.map((item) => item.id))).toEqual([
      "grill-1",
      "fryer-1",
      "bar-1",
    ]);

    const waitingHidden = buildPassBoard(rows, scope, {
      showNonPassStations: false,
      aStationInViewWaits: true,
    });
    expect(cards(waitingHidden).flatMap((card) => card.items)).toEqual([]);
    expect(waitingHidden.overview).toEqual([]);

    const release = (board: PassBoard) =>
      cards(board).map((card) => [card.releaseTicketItemIds, card.releaseContext]);
    for (const board of [waiting, calmHidden, waitingHidden])
      expect(release(board)).toEqual(release(calm));
  });

  it("5c. keeps a card Hide empties in its column, with its party and levers (D83)", () => {
    const rows = [
      released({ id: "grill-1", state: "preparing", passControlled: false, lineNo: 1 }),
      released({ id: "grill-2", state: "ready", passControlled: false, lineNo: 2 }),
    ];
    const options = { aStationInViewWaits: true };
    const shown = buildPassBoard(rows, HOT, { ...options, showNonPassStations: true });
    const hidden = buildPassBoard(rows, HOT, { ...options, showNonPassStations: false });
    expect(cards(shown)).toHaveLength(1);
    const card = cards(shown)[0]!;
    expect(card.items.every((item) => item.informational)).toBe(true);
    expect(card.party).toEqual({ id: party, revision: 7 });
    expect(hidden.inProgress).toEqual([{ ...card, items: [] }]);
    expect(columnOf(hidden, card.key)).toBe(columnOf(shown, card.key));
    expect(hidden.overview).toEqual([]);
  });

  it("5b. lets no recalled pass work dim the board", () => {
    const rows = [
      row({ id: "grill-recalled", recalled: true, lineNo: 1 }),
      released({
        id: "bar-1",
        stationId: bar,
        state: "preparing",
        passControlled: false,
        lineNo: 2,
      }),
    ];
    const board = buildPassBoard(rows, EVERY, {
      showNonPassStations: true,
      aStationInViewWaits: false,
    });
    expect(cards(board).flatMap((card) => card.items.map((item) => item.id))).toEqual(["bar-1"]);
    expect(itemOf(cards(board)[0]!, "bar-1").informational).toBe(false);
  });
});
