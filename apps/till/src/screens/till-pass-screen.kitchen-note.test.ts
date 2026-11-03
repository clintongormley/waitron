import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import type { PassBoard, TillApi } from "../api/client.js";
import { passBoard, passCard, passItem } from "../../test/pass-board-fixtures.js";
import type { TillPassScreen } from "./till-pass-screen.js";
import "./till-pass-screen.js";

function board(kitchenNote: string | null): PassBoard {
  return passBoard({
    inProgress: [
      passCard({
        key: "bill:order-a",
        target: { kind: "bill", workingOrderId: "order-a" },
        orders: [{ orderId: "order-a", orderNumber: 7, kitchenNote }],
        items: [passItem({ id: "item-a", name: "Burger", orderId: "order-a", note: "No onions" })],
      }),
    ],
  });
}

const realSetTimeout = globalThis.setTimeout;
const previousLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  setLocale(previousLocale);
});

const boardRoot = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")!.shadowRoot!;

describe("whole-order instructions on pass boards", () => {
  it("wraps an unbroken instruction above the pass dishes at phone width, on a till's All stations", async () => {
    await page.viewport(390, 900);
    const api = {
      getExpoBoard: vi.fn(async () => ({ board: board("instruction".repeat(180)) })),
      getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillPassScreen>("till-pass-screen", { api });
    await vi.waitFor(() => expect(boardRoot(el).textContent).toContain("Burger"));
    const heading = boardRoot(el).querySelector<HTMLElement>("[data-kitchen-note]")!;
    const bounds = heading.getBoundingClientRect();
    expect(window.innerWidth).toBe(390);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
    expect(bounds.height).toBeGreaterThan(40);
  });

  it.each(["expo", "pass", "monitor"] as const)(
    "keeps the whole heading above dish notes and adopts a later %s poll",
    async (mode) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      let note: string | null = "Train at 14:30 <keep together>";
      const read = () => ({
        board: board(note),
        stations: [],
        zones: null,
        display: { showNonPassStations: true, nonPassStationsOverride: null },
      });
      const api = {
        getExpoBoard: vi.fn(async () => ({ board: board(note) })),
        getDeviceIdentity: vi.fn(async () => ({
          deviceId: "d",
          formFactor: "till",
          name: "Pass",
          kitchenScreens: [],
        })),
        getDevicePassBoard: vi.fn(async () => read()),
        getDevicePassMonitorBoard: vi.fn(async () => read()),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillPassScreen>("till-pass-screen", {
        api,
        deviceMode: mode === "pass",
        monitor: mode === "monitor",
        ...(mode === "expo" ? {} : { initialBoard: read() }),
      });
      await vi.waitFor(() => expect(boardRoot(el).textContent).toContain("Burger"));
      const heading = boardRoot(el).querySelector("[data-kitchen-note]");
      expect(heading?.textContent).toContain("For the kitchen: Train at 14:30 <keep together>");
      expect(
        heading!.compareDocumentPosition(boardRoot(el).querySelector(".item-name")!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(boardRoot(el).textContent).toContain("No onions");
      const settle = async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await new Promise((resolve) => realSetTimeout(resolve, 0));
        await el.updateComplete;
        await el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")!.updateComplete;
      };
      note = "Later departure";
      await settle();
      expect(boardRoot(el).querySelector("[data-kitchen-note]")?.textContent).toContain(
        "Later departure",
      );
      expect(boardRoot(el).textContent).not.toContain("Train at 14:30");
      note = null;
      await settle();
      expect(boardRoot(el).querySelector("[data-kitchen-note]")).toBeNull();
      expect(boardRoot(el).textContent).toContain("No onions");
    },
  );
});
