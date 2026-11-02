import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Theme,
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  resetPage,
} from "./test-helpers.js";
import { type ColumnState, PASS_COLUMNS } from "../state/kitchen-columns.js";
import type { OverviewFact } from "../api/client.js";
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
import type { TillPassBoard } from "./pass-board.js";
import "./pass-board.js";

afterEach(resetPage);
afterEach(cleanupWidgets);

const overview: OverviewFact[] = [
  {
    lineId: "o-1",
    stationId: "st-grill",
    name: "Paella",
    qty: "2",
    phase: "waiting",
    informational: false,
  },
  {
    lineId: "o-2",
    stationId: "st-grill",
    name: "Croquetas",
    qty: "1",
    phase: "held",
    informational: false,
  },
];

/** One card per column, a blocked card, a dimmed dish and Overview's facts. */
const board = passBoard({
  held: [
    passCard({
      key: "bill:order-6",
      kind: "held",
      requestedAt: null,
      orders: [{ orderId: "order-6", orderNumber: 17, tableLabel: "T9", kitchenNote: null }],
      items: [passItem({ id: "held-1", orderId: "order-6", phase: "held", firedAt: null })],
    }),
  ],
  toFire: [
    passCard({
      key: "group:p1:g1",
      target: { kind: "group", partyId: "p1", groupId: "g1" },
      group: { displayNumber: 2, position: 1 },
      items: [
        passItem({ id: "req-1", phase: "requested", firedAt: null, requestedAt: minutesAgo(7) }),
      ],
      releaseTicketItemIds: ["req-1"],
      releaseContext: "ctx-1",
    }),
    passCard({
      key: "bill:order-2",
      target: { kind: "bill", workingOrderId: "order-2" },
      kind: "next_course",
      orders: [{ orderId: "order-2", orderNumber: 13, tableLabel: "T5", kitchenNote: null }],
      items: [
        passItem({
          id: "blocked-1",
          orderId: "order-2",
          phase: "requested",
          stationName: "Fryer",
          stationClosed: true,
        }),
      ],
      releaseContext: "ctx-2",
    }),
  ],
  inProgress: [
    passCard({
      key: "bill:order-5",
      target: { kind: "bill", workingOrderId: "order-5" },
      orders: [{ orderId: "order-5", orderNumber: 16, tableLabel: "T8", kitchenNote: null }],
      items: [
        passItem({ id: "b-1", orderId: "order-5", queuedAt: minutesAgo(7) }),
        passItem({ id: "dim-1", orderId: "order-5", informational: true, stationName: "Bar" }),
      ],
    }),
  ],
  ready: [
    passCard({
      key: "bill:order-7",
      target: { kind: "bill", workingOrderId: "order-7" },
      readyAt: minutesAgo(3),
      allReady: true,
      orders: [{ orderId: "order-7", orderNumber: 18, tableLabel: "T10", kitchenNote: null }],
      items: [passItem({ id: "ready-1", orderId: "order-7", phase: "ready", state: "ready" })],
    }),
  ],
  overview,
});

const allShown: ColumnState = { order: PASS_COLUMNS.order, hidden: [], collapsed: [] };

async function mountBoard(theme: Theme, columns: ColumnState) {
  const { el, host } = await mountWidget<TillPassBoard>(
    "till-pass-board",
    {
      board,
      mode: "pass",
      runsPass: true,
      columns,
      now: PASS_NOW,
      sending: new Set<string>(),
      reducedMotion: true,
      showReprint: true,
    },
    theme,
  );
  return { el, host };
}

describe("A773 pass board widget: accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [width, layout] of [
      [1280, "wide"],
      [390, "narrow"],
    ] as const) {
      it(`has no axe violations ${layout} in the ${theme} theme, Overview shown`, async () => {
        await page.viewport(width, 900);
        expect(window.innerWidth).toBe(width);
        const { el, host } = await mountBoard(theme, allShown);
        expect(el.shadowRoot!.querySelector("[data-overview]")).not.toBeNull();
        expect(el.shadowRoot!.querySelector("[data-dimmed]")).not.toBeNull();
        await expectNoA11yViolations(host);
      });
    }

    it(`has no axe violations with a collapsed column in the ${theme} theme`, async () => {
      await page.viewport(1280, 900);
      const { el, host } = await mountBoard(theme, { ...allShown, collapsed: ["toFire"] });
      expect(
        el
          .shadowRoot!.querySelector('[data-column-toggle="toFire"]')!
          .getAttribute("aria-expanded"),
      ).toBe("false");
      await expectNoA11yViolations(host);
    });
  }
});
