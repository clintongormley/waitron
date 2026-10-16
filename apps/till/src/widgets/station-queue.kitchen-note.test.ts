import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { TillStationQueue } from "./station-queue.js";
import type { KitchenNotice, StationQueueGroup } from "../api/client.js";

const group = {
  orderId: "order-a",
  orderNumber: 7,
  label: "Table 4",
  status: "placed",
  queuedAt: new Date().toISOString(),
  kitchenNote: "Train at 14:30 <keep together>",
  thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
  items: [
    {
      id: "item-a",
      workingOrderLineId: "line-a",
      state: "queued",
      name: "Burger",
      quantity: "1.000",
      course: null,
      firedAt: new Date().toISOString(),
      note: "No onions",
    },
  ],
} satisfies StationQueueGroup & { kitchenNote: string | null };
const notice = {
  id: "notice-a",
  stationId: "station-a",
  workingOrderId: "order-a",
  orderLabel: "#7 Table 4",
  kind: "changed",
  lineName: "Burger",
  unitName: null,
  soldInEach: true,
  quantity: "1.000",
  note: "No onions",
  wasStarted: false,
  movedTo: null,
  reroutedTo: null,
  direction: null,
  cancelledExtra: null,
  createdAt: new Date().toISOString(),
} satisfies KitchenNotice;
const previousLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});

describe("kitchen instructions on station work", () => {
  it.each(["rail", "kanban"] as const)(
    "places the whole note above dishes in %s and replaces it independently",
    async (view) => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [group],
        view,
      });
      const heading = el.shadowRoot!.querySelector("[data-kitchen-note]");
      expect(heading?.textContent).toContain("For the kitchen: Train at 14:30 <keep together>");
      expect(
        heading!.compareDocumentPosition(el.shadowRoot!.querySelector(".line-name")!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(el.shadowRoot!.textContent).toContain("No onions");
      expect(heading!.querySelector("keep")).toBeNull();
      el.groups = [{ ...group, kitchenNote: "Later departure" }];
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-kitchen-note]")?.textContent).toContain(
        "Later departure",
      );
      expect(el.shadowRoot!.textContent).not.toContain("Train at 14:30");
      el.groups = [{ ...group, kitchenNote: null }];
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-kitchen-note]")).toBeNull();
      expect(el.shadowRoot!.textContent).toContain("No onions");
    },
  );

  it.each(["rail", "kanban"] as const)(
    "wraps an unbroken instruction in %s at phone width",
    async (view) => {
      await page.viewport(390, 900);
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [{ ...group, kitchenNote: "instruction".repeat(180) }],
        view,
      });
      const heading = el.shadowRoot!.querySelector<HTMLElement>("[data-kitchen-note]")!;
      const bounds = heading.getBoundingClientRect();
      expect(window.innerWidth).toBe(390);
      expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
      expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
      expect(bounds.height).toBeGreaterThan(40);
    },
  );

  it.each(["en-GB", "es-ES"] as const)(
    "distinguishes edits and removals and acknowledges the copied notice in %s",
    async (locale) => {
      setLocale(locale);
      const changed = { ...notice, orderNoteChange: { before: "Old train", after: "New train" } };
      const removed = {
        ...notice,
        id: "removed",
        orderNoteChange: { before: "New train", after: null },
      };
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [group],
        notices: [
          changed,
          removed,
          { ...notice, id: "added", orderNoteChange: { before: null, after: "New instruction" } },
        ],
      });
      const rows = el.shadowRoot!.querySelectorAll("[data-notice]");
      expect(rows[0]!.textContent).toContain(
        locale === "en-GB" ? "Kitchen note changed" : es["kitchen_note.changed"],
      );
      expect(rows[0]!.textContent).toContain("Old train");
      expect(rows[0]!.textContent).toContain("New train");
      expect(rows[1]!.textContent).toContain(
        locale === "en-GB" ? "Kitchen note removed" : es["kitchen_note.removed"],
      );
      expect(rows[1]!.textContent).toContain("New train");
      expect(rows[1]!.textContent).toContain("No onions");
      expect(rows[2]!.textContent).toContain("New instruction");
      expect(rows[2]!.textContent).not.toContain(
        locale === "en-GB" ? "Before:" : `${es["kitchen_note.before"]}:`,
      );
      const acknowledged = vi.fn();
      el.addEventListener("acknowledge-notice", acknowledged);
      await userEvent.click(rows[1]!.querySelector("wt-button")!);
      expect(acknowledged.mock.calls[0]![0].detail).toEqual({ noticeId: "removed" });
    },
  );
});
