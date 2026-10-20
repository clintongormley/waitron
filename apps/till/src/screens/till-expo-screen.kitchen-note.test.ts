import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillExpoScreen } from "./till-expo-screen.js";
import type { ExpoOrder, TillApi } from "../api/client.js";

const order: ExpoOrder = {
  orderId: "order-a",
  orderNumber: 7,
  openedMinutes: 1,
  worstBand: "fresh",
  kitchenNote: "Train at 14:30 <keep together>",
  groups: [],
  courses: [
    {
      courseId: null,
      courseName: null,
      displayOrder: null,
      fired: true,
      away: false,
      items: [
        {
          allergy: null,
          id: "item-a",
          name: "Burger",
          qty: "1.000",
          stationName: "Grill",
          state: "queued",
          firedAt: new Date().toISOString(),
          awayAt: null,
          queuedAt: new Date().toISOString(),
          note: "No onions",
          thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
          band: "fresh",
        },
      ],
    },
  ],
};
const realSetTimeout = globalThis.setTimeout;
const previousLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  setLocale(previousLocale);
});

describe("whole-order instructions on pass boards", () => {
  it("wraps an unbroken instruction above the pass dishes at phone width", async () => {
    await page.viewport(390, 900);
    const api = {
      getExpoQueue: vi.fn(async () => [{ ...order, kitchenNote: "instruction".repeat(180) }]),
      getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillExpoScreen>("till-expo-screen", { api });
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Burger"));
    const heading = el.shadowRoot!.querySelector<HTMLElement>("[data-kitchen-note]")!;
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
      let orders: ExpoOrder[] = [order];
      const board = () => ({
        orders: orders.map((order) => ({
          ...order,
          courses: order.courses.map((course) => ({ ...course, allReady: false })),
          groups: (order.groups ?? []).map((group) => ({ ...group, allReady: false })),
        })),
        stations: [],
        zones: null,
      });
      const api = {
        getExpoQueue: vi.fn(async () => orders),
        getDeviceIdentity: vi.fn(async () => ({
          deviceId: "d",
          formFactor: "till",
          name: "Pass",
          kitchenScreens: [],
        })),
        getDevicePassScreen: vi.fn(async () => board()),
        getDevicePassMonitor: vi.fn(async () => board()),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillExpoScreen>("till-expo-screen", {
        api,
        deviceMode: mode === "pass",
        monitor: mode === "monitor",
        ...(mode === "pass" ? { initialDevicePass: board() } : {}),
        ...(mode === "monitor" ? { initialDevicePassMonitor: board() } : {}),
      });
      await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Burger"));
      const heading = el.shadowRoot!.querySelector("[data-kitchen-note]");
      expect(heading?.textContent).toContain("For the kitchen: Train at 14:30 <keep together>");
      expect(
        heading!.compareDocumentPosition(el.shadowRoot!.querySelector(".item-name")!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(el.shadowRoot!.textContent).toContain("No onions");
      orders = [{ ...order, kitchenNote: "Later departure" }];
      await vi.advanceTimersByTimeAsync(15_000);
      await new Promise((resolve) => realSetTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-kitchen-note]")?.textContent).toContain(
        "Later departure",
      );
      expect(el.shadowRoot!.textContent).not.toContain("Train at 14:30");
      orders = [{ ...order, kitchenNote: null }];
      await vi.advanceTimersByTimeAsync(15_000);
      await new Promise((resolve) => realSetTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-kitchen-note]")).toBeNull();
      expect(el.shadowRoot!.textContent).toContain("No onions");
    },
  );
});
