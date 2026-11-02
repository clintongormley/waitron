import { afterEach, describe, expect, it } from "vitest";
import type { OverviewFact, PassCard, PassCardItem } from "../api/client.js";
import { es } from "../i18n/strings.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
import { overviewRows } from "./kitchen-overview.js";
import {
  type CardView,
  type PassMode,
  passCardViews,
  passItemBand,
  passOverdueCount,
  passOverviewDishes,
} from "./pass-view.js";

const COLUMNS = ["held", "toFire", "inProgress", "ready"] as const;

function viewsOf(
  column: (typeof COLUMNS)[number],
  cards: PassCard[],
  mode: PassMode = "pass",
  runsPass = true,
  now = PASS_NOW,
): CardView[] {
  return passCardViews(passBoard({ [column]: cards }), mode, runsPass, now).get(column) ?? [];
}

function onlyView(
  column: (typeof COLUMNS)[number],
  card: PassCard,
  mode?: PassMode,
  runsPass?: boolean,
) {
  const [view] = viewsOf(column, [card], mode, runsPass);
  expect(view).toBeDefined();
  return view!;
}

function heldItem(overrides: Partial<PassCardItem> = {}): PassCardItem {
  return passItem({ phase: "held", firedAt: null, requestedAt: null, ...overrides });
}

function requestedItem(overrides: Partial<PassCardItem> = {}): PassCardItem {
  return passItem({ phase: "requested", firedAt: null, ...overrides });
}

function fact(overrides: Partial<OverviewFact>): OverviewFact {
  return {
    lineId: "line-1",
    stationId: "st-grill",
    name: "Steak",
    qty: "1",
    phase: "waiting",
    informational: false,
    ...overrides,
  };
}

describe("A773 pass view", () => {
  const startLocale = currentLocale();
  afterEach(() => setLocale(startLocale));

  it("puts each card in its board array's column, in the board's order", () => {
    const board = passBoard({
      held: [passCard({ key: "h-2", kind: "held" }), passCard({ key: "h-1", kind: "held" })],
      toFire: [passCard({ key: "f-9" }), passCard({ key: "f-1" })],
      inProgress: [passCard({ key: "p-5" }), passCard({ key: "p-2" }), passCard({ key: "p-7" })],
      ready: [passCard({ key: "r-3" }), passCard({ key: "r-0" })],
    });
    const views = passCardViews(board, "pass", true, PASS_NOW);
    expect([...views.keys()]).toEqual([...COLUMNS]);
    for (const column of COLUMNS) {
      expect(views.get(column)!.map((view) => view.card.key)).toEqual(
        board[column].map((card) => card.key),
      );
      expect(views.get(column)!.every((view) => view.column === column)).toBe(true);
      expect(views.get(column)!.map((view) => view.card)).toEqual(board[column]);
    }
  });

  it("captions and dims each dish by its phase and whether it is this pass's work", () => {
    const items = [
      heldItem({ id: "held" }),
      requestedItem({ id: "mine-requested" }),
      requestedItem({
        id: "other-requested",
        stationName: "Bar",
        visible: false,
        informational: true,
      }),
      passItem({ id: "mine-waiting", state: "queued", phase: "waiting" }),
      passItem({ id: "mine-preparing", state: "preparing", phase: "preparing" }),
      passItem({ id: "mine-ready", state: "ready", phase: "ready", readyAt: minutesAgo(0) }),
      passItem({
        id: "already-at",
        stationName: "Bar",
        state: "queued",
        phase: "waiting",
        visible: true,
        passControlled: false,
        informational: true,
      }),
      passItem({ id: "closed-dish", stationName: "Wok", stationClosed: true, extra: false }),
      passItem({ id: "closed-extra", stationName: "Wok", stationClosed: true, extra: true }),
    ];
    const view = onlyView("inProgress", passCard({ items }));
    const rows = Object.fromEntries(
      view.items.map((row) => [
        row.item.id,
        { caption: row.caption, dimmed: row.dimmed, closed: row.closed },
      ]),
    );
    expect(view.items.map((row) => row.item)).toEqual(items);
    expect(rows).toEqual({
      held: { caption: { kind: "none" }, dimmed: false, closed: null },
      "mine-requested": {
        caption: { kind: "waitingForPass", station: "Grill" },
        dimmed: false,
        closed: null,
      },
      "other-requested": {
        caption: { kind: "otherPass", station: "Bar" },
        dimmed: true,
        closed: null,
      },
      "mine-waiting": {
        caption: { kind: "state", state: "queued", station: "Grill" },
        dimmed: false,
        closed: null,
      },
      "mine-preparing": {
        caption: { kind: "state", state: "preparing", station: "Grill" },
        dimmed: false,
        closed: null,
      },
      "mine-ready": {
        caption: { kind: "state", state: "ready", station: "Grill" },
        dimmed: false,
        closed: null,
      },
      "already-at": {
        caption: { kind: "alreadyAt", state: "queued", station: "Bar" },
        dimmed: true,
        closed: null,
      },
      "closed-dish": {
        caption: { kind: "state", state: "queued", station: "Wok" },
        dimmed: false,
        closed: "blocked",
      },
      "closed-extra": {
        caption: { kind: "state", state: "queued", station: "Wok" },
        dimmed: false,
        closed: "extra",
      },
    });
  });

  it("words each card's kind from the catalogue, and a held card's not at all", () => {
    setLocale("es");
    expect(onlyView("held", passCard({ kind: "held", items: [heldItem()] })).kindWord).toBeNull();
    expect(onlyView("toFire", passCard({ kind: "new_order" })).kindWord).toBe(
      es["pass.kind.new_order"],
    );
    expect(onlyView("toFire", passCard({ kind: "next_course" })).kindWord).toBe(
      es["pass.kind.next_course"],
    );
    expect(onlyView("inProgress", passCard({ kind: "added" })).kindWord).toBe(
      es["pass.kind.added"],
    );
  });

  it("ages cards from their request or readiness and bands every dish in view on the clock", () => {
    const asked = minutesAgo(3);
    const readyAt = minutesAgo(2);
    for (const column of ["toFire", "inProgress"] as const) {
      const view = onlyView(column, passCard({ requestedAt: asked }));
      expect([view.ageFrom, view.ageWord]).toEqual([asked, "minutes"]);
    }
    const ready = onlyView("ready", passCard({ requestedAt: asked, readyAt }));
    expect([ready.ageFrom, ready.ageWord]).toEqual([readyAt, "ready"]);
    const held = onlyView(
      "held",
      passCard({
        kind: "held",
        requestedAt: null,
        items: [heldItem({ queuedAt: minutesAgo(40) })],
      }),
    );
    expect([held.ageFrom, held.ageWord, held.band]).toEqual([null, null, null]);
    expect(held.items[0]).toMatchObject({ band: null, forgotten: false });

    const requested = requestedItem({ queuedAt: minutesAgo(30), requestedAt: minutesAgo(1) });
    expect(passItemBand(requested, PASS_NOW)).toBe("fresh");
    const late = passItem({ queuedAt: minutesAgo(16) });
    expect(passItemBand(late, PASS_NOW)).toBe("forgotten");
    expect(passItemBand(heldItem({ queuedAt: minutesAgo(40) }), PASS_NOW)).toBeNull();
    const released = onlyView("inProgress", passCard({ items: [requested, late] }));
    expect(released.items.map((row) => [row.band, row.forgotten])).toEqual([
      ["fresh", false],
      ["forgotten", true],
    ]);

    const dimmedLate = passItem({
      id: "dimmed-late",
      queuedAt: minutesAgo(16),
      informational: true,
      passControlled: false,
    });
    const dimmedLateCard = onlyView("inProgress", passCard({ items: [passItem(), dimmedLate] }));
    expect(dimmedLateCard.band).toBe("forgotten");
    expect(dimmedLateCard.items[1]).toMatchObject({ dimmed: true, forgotten: true });

    const outOfView = passItem({
      id: "out-of-view",
      queuedAt: minutesAgo(16),
      visible: false,
      informational: true,
    });
    expect(onlyView("inProgress", passCard({ items: [passItem(), outOfView] })).band).toBe("fresh");

    const board = passBoard({
      held: [
        passCard({ key: "held", kind: "held", items: [heldItem({ queuedAt: minutesAgo(40) })] }),
      ],
      toFire: [
        passCard({ key: "overdue", items: [requestedItem({ requestedAt: minutesAgo(11) })] }),
      ],
      inProgress: [
        passCard({ key: "forgotten", items: [passItem({ queuedAt: minutesAgo(20) })] }),
        passCard({ key: "fresh", items: [passItem({ queuedAt: minutesAgo(1) })] }),
        passCard({ key: "warm", items: [passItem({ queuedAt: minutesAgo(6) })] }),
      ],
    });
    const now = passCardViews(board, "pass", true, PASS_NOW);
    expect(passOverdueCount(now)).toBe(2);
    const later = passCardViews(board, "pass", true, PASS_NOW + 10 * 60_000);
    expect(later.get("inProgress")!.map((view) => view.band)).toEqual([
      "forgotten",
      "overdue",
      "forgotten",
    ]);
    expect(later.get("held")![0]!.band).toBeNull();
    expect(passOverdueCount(later)).toBe(4);
  });

  it("offers Fire on a To fire card on a pass that runs it, off where the board blocked it", () => {
    const fire = onlyView(
      "toFire",
      passCard({ releaseTicketItemIds: ["ti-1"], releaseContext: "c" }),
    );
    expect(fire.fire).toEqual({ shown: true, enabled: true });

    const blocked = onlyView(
      "toFire",
      passCard({
        releaseTicketItemIds: [],
        releaseContext: "c",
        items: [requestedItem({ id: "blocked", stationClosed: true, extra: false })],
      }),
    );
    expect(blocked.fire).toEqual({ shown: true, enabled: false });
    expect(blocked.items[0]!.closed).toBe("blocked");

    const extra = onlyView(
      "toFire",
      passCard({
        releaseTicketItemIds: ["ti-1", "extra"],
        releaseContext: "c",
        items: [requestedItem(), requestedItem({ id: "extra", stationClosed: true, extra: true })],
      }),
    );
    expect(extra.fire).toEqual({ shown: true, enabled: true });
    expect(extra.items[1]!.closed).toBe("extra");

    const card = passCard({ releaseTicketItemIds: ["ti-1"], releaseContext: "c" });
    for (const [mode, runsPass] of [
      ["monitor", true],
      ["all_stations", true],
      ["pass", false],
    ] as const) {
      expect(onlyView("toFire", card, mode, runsPass).fire.shown).toBe(false);
    }
    expect(onlyView("inProgress", card).fire.shown).toBe(false);
  });

  it("offers group Ready on an In progress group card and course Ready per released course", () => {
    const group = passCard({
      key: "group",
      target: { kind: "group", partyId: "party-1", groupId: "group-1" },
      party: { id: "party-1", revision: 4 },
    });
    expect(onlyView("inProgress", group).groupReady).toBe(true);
    for (const column of ["held", "toFire", "ready"] as const) {
      expect(onlyView(column, group).groupReady).toBe(false);
    }
    expect(onlyView("inProgress", group, "monitor").groupReady).toBe(false);
    expect(onlyView("inProgress", group, "pass", false).groupReady).toBe(false);

    const starters = { id: "course-starters", name: "Starters", displayOrder: 1 };
    const mains = { id: "course-mains", name: "Mains", displayOrder: 2 };
    const bill = passCard({
      items: [
        passItem({ id: "s1", course: starters, phase: "waiting", state: "queued" }),
        passItem({ id: "s2", course: starters, phase: "ready", state: "ready" }),
        passItem({ id: "m1", course: mains, phase: "waiting", state: "queued" }),
        requestedItem({ id: "m2", course: mains }),
      ],
    });
    expect(onlyView("inProgress", bill).courseReady).toEqual([
      { orderId: "order-1", courseId: "course-starters" },
    ]);
    expect(onlyView("inProgress", bill).groupReady).toBe(false);
    expect(onlyView("inProgress", bill, "monitor").courseReady).toEqual([]);
  });

  it("counts the pass's own dishes for Overview, requested as held and ready left out", () => {
    const board = passBoard({
      overview: [
        fact({ lineId: "a", name: "Steak", phase: "waiting" }),
        fact({ lineId: "b", name: "Soup", phase: "requested" }),
        fact({ lineId: "c", name: "Fish", phase: "held" }),
        fact({ lineId: "d", name: "Cake", phase: "ready" }),
        fact({ lineId: "e", name: "Salad", phase: "preparing", informational: true }),
        fact({ lineId: "f", name: "Steak", phase: "preparing", qty: "2" }),
      ],
    });
    expect(overviewRows(passOverviewDishes(board))).toEqual([
      { name: "Steak", making: 3000, held: 0 },
      { name: "Soup", making: 0, held: 1000 },
      { name: "Fish", making: 0, held: 1000 },
    ]);

    const defaultVenue = passBoard({
      overview: [
        fact({ lineId: "a", stationId: "st-grill", name: "Steak", phase: "waiting" }),
        fact({ lineId: "b", stationId: "st-bar", name: "Wine", phase: "preparing" }),
        fact({ lineId: "c", stationId: "st-cold", name: "Salad", phase: "held" }),
      ],
    });
    expect(overviewRows(passOverviewDishes(defaultVenue))).toEqual([
      { name: "Steak", making: 1000, held: 0 },
      { name: "Wine", making: 1000, held: 0 },
      { name: "Salad", making: 0, held: 1000 },
    ]);
  });
});
