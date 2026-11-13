import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import type { PassBoard, PassCard, PassCardItem, TillApi } from "../api/client.js";
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
import type { TillPassScreen } from "./till-pass-screen.js";
import "./till-pass-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

type Kind = "course" | "group";
type Mode = "all" | "pass" | "device" | "monitor";

function dish(overrides: Partial<PassCardItem> = {}): PassCardItem {
  return passItem({
    id: "ready-item",
    name: "Soup",
    stationName: "Kitchen",
    state: "ready",
    phase: "ready",
    firedAt: minutesAgo(20),
    queuedAt: minutesAgo(20),
    requestedAt: minutesAgo(20),
    readyAt: minutesAgo(1),
    orderId: "bill-1",
    course: { id: "course-1", name: "Starter", displayOrder: 1 },
    ...overrides,
  });
}

function card(kind: Kind, items: PassCardItem[], allReady: boolean): PassCard {
  const orders = [{ orderId: "bill-1", orderNumber: 12, tableLabel: "Table 4", kitchenNote: null }];
  return kind === "course"
    ? passCard({
        key: "bill:bill-1",
        target: { kind: "bill", workingOrderId: "bill-1" },
        requestedAt: minutesAgo(20),
        readyAt: allReady ? minutesAgo(1) : null,
        allReady,
        orders,
        items,
      })
    : passCard({
        key: "group:group-1",
        target: { kind: "group", partyId: "party-1", groupId: "group-1" },
        kind: "next_course",
        party: { id: "party-1", revision: 7 },
        group: { displayNumber: 1, position: 1 },
        requestedAt: minutesAgo(20),
        readyAt: allReady ? minutesAgo(1) : null,
        allReady,
        orders,
        items,
      });
}

/** A card whose only dish is ready and was sent twenty minutes ago, past its forgotten flag. */
const readyBoard = (kind: Kind): PassBoard => passBoard({ ready: [card(kind, [dish()], true)] });

/** An In progress card with its own dish ready and another station's dish still cooking. */
const cookingBoard = (kind: Kind): PassBoard =>
  passBoard({
    inProgress: [
      card(
        kind,
        [
          dish(),
          dish({
            id: "bar-item",
            name: "Wine",
            stationName: "Bar",
            stationId: "st-bar",
            state: "preparing",
            phase: "preparing",
            readyAt: null,
            queuedAt: minutesAgo(2),
          }),
        ],
        false,
      ),
    ],
  });

const realSetTimeout = globalThis.setTimeout;

async function mount(mode: Mode, board: PassBoard) {
  const read = {
    board,
    stations: [],
    zones: null,
    display: { showNonPassStations: true, nonPassStationsOverride: null },
  };
  const api = {
    getExpoBoard: vi.fn().mockResolvedValue({ board }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "dev-1",
      formFactor: "till",
      name: "Till 1",
      kitchenScreens:
        mode === "pass" ? [{ kind: "pass", available: true, stations: [], zones: null }] : [],
    }),
    getDevicePassBoard: vi.fn().mockResolvedValue(read),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(read),
    bumpBillReady: vi.fn().mockResolvedValue(undefined),
    bumpGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    bumpDeviceBillReady: vi.fn().mockResolvedValue(undefined),
    bumpDeviceGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
  };
  const { el } = await mountWidget<TillPassScreen>("till-pass-screen", {
    api: api as unknown as TillApi,
    runsPass: true,
    deviceId: "dev-1",
    serverOrigin: "https://box.local",
    now: PASS_NOW,
    reducedMotion: true,
    deviceMode: mode === "device" || mode === "monitor",
    monitor: mode === "monitor",
    ...(mode === "device" || mode === "monitor" ? { initialBoard: read } : {}),
  });
  const root = () => el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")!.shadowRoot!;
  await vi.waitFor(() => expect(root().querySelector("[data-card]")).not.toBeNull());
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
  return { el, api, root };
}

const AWAY = "[data-away], [data-group-away]";

describe("A773 no dispatch presentation", () => {
  for (const kind of ["course", "group"] as const)
    for (const mode of ["all", "pass", "device", "monitor"] as const)
      it(`${kind} on ${mode} keeps ready food and its late flags with no Away and no Ready`, async () => {
        setLocale("en");
        const { root } = await mount(mode, readyBoard(kind));
        const dishRow = root().querySelector('[data-column="ready"] [data-item="ready-item"]');
        expect(dishRow).not.toBeNull();
        expect(dishRow!.textContent).toContain(t("station.state.ready"));
        expect(dishRow!.textContent).not.toContain("Sent out");
        expect(dishRow!.querySelector("[data-forgotten]")).not.toBeNull();
        expect(root().querySelector("[data-card]")!.classList.contains("age-forgotten")).toBe(true);
        expect(root().querySelector("[data-overdue-count]")!.textContent).toContain("1");
        expect(root().querySelector(`${AWAY}, [data-ready], [data-group-ready]`)).toBeNull();
        const readyCard = root().querySelector('[data-column="ready"] [data-card]')!;
        const buttons = [...readyCard.querySelectorAll("button, wt-button, [role='button']")];
        // A till reprints the bill; a kitchen display and a monitor draw no button on a Ready card.
        expect(buttons.map((button) => button.getAttribute("data-reprint"))).toEqual(
          mode === "all" || mode === "pass" ? ["bill-1"] : [],
        );
      });

  for (const kind of ["course", "group"] as const)
    it(`${kind} on a kitchen display keeps an enabled Ready while another station's dish cooks`, async () => {
      const { api, root } = await mount("device", cookingBoard(kind));
      const ready = root().querySelector<HTMLButtonElement>(
        kind === "course" ? '[data-ready="bill-1"]' : '[data-group-ready="group-1"]',
      );
      expect(ready).not.toBeNull();
      expect(ready!.disabled).toBe(false);
      await userEvent.click(ready!);
      const call = kind === "course" ? api.bumpDeviceBillReady : api.bumpDeviceGroupReady;
      await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
      if (kind === "course") expect(call).toHaveBeenCalledWith("bill-1");
      else
        expect(call).toHaveBeenCalledWith("party-1", "group-1", {
          submissionId: expect.any(String),
          expectedPartyRevision: 7,
        });
      expect(root().querySelector(AWAY)).toBeNull();
    });
});
