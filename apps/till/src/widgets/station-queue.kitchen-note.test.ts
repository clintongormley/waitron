import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, resetPage } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { TillStationQueue } from "./station-queue.js";
import type { KitchenNotice, StationQueueGroup } from "../api/client.js";

const queuedAt = new Date().toISOString();
const group = {
  orderId: "order-a",
  orderNumber: 7,
  label: "Table 4",
  status: "placed",
  queuedAt,
  kitchenNote: "Train at 14:30 <keep together>",
  thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
  bumpMode: "line",
  items: [
    {
      allergy: null,
      id: "item-a",
      workingOrderLineId: "line-a",
      state: "queued",
      name: "Burger",
      quantity: "1.000",
      course: null,
      firedAt: new Date().toISOString(),
      queuedAt,
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
beforeEach(async () => {
  await page.viewport(1280, 900);
});
afterEach(resetPage);
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});

describe("kitchen instructions on station work", () => {
  it("places the whole note above dishes and replaces it independently", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [group],
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
  });

  it("wraps an unbroken instruction at phone width", async () => {
    await page.viewport(390, 900);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [{ ...group, kitchenNote: "instruction".repeat(180) }],
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-tab="waiting"]')!.click();
    await el.updateComplete;
    const heading = el.shadowRoot!.querySelector<HTMLElement>("[data-kitchen-note]")!;
    const bounds = heading.getBoundingClientRect();
    expect(window.innerWidth).toBe(390);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
    expect(bounds.height).toBeGreaterThan(40);
  });

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

  it.each(["en-GB", "es-ES"] as const)(
    "A807 lists every dish of one note-change notice and acknowledges it once in %s",
    async (locale) => {
      setLocale(locale);
      await page.viewport(390, 900);
      const dish = { unitName: null, soldInEach: true, note: null, wasStarted: false };
      // The server copies the first dish onto the notice's own fields.
      const many = {
        ...notice,
        wasStarted: true,
        orderNoteChange: { before: "Old train", after: "New train" },
        dishes: [
          { ...dish, lineName: "Burger", quantity: "1.000", note: "No onions", wasStarted: true },
          { ...dish, lineName: "Croquetas", quantity: "2.000", wasStarted: true },
          { ...dish, lineName: "Flan", quantity: "1.000" },
        ],
      } satisfies KitchenNotice;
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [group],
        notices: [many],
      });
      el.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-tab="waiting"]')?.click();
      await el.updateComplete;

      const rows = el.shadowRoot!.querySelectorAll("[data-notice]");
      expect(rows).toHaveLength(1);
      const dishes = [...rows[0]!.querySelectorAll<HTMLElement>("[data-notice-dish]")];
      expect(dishes.map((row) => row.querySelector(".notice-line")!.textContent!.trim())).toEqual([
        "1× Burger",
        "2× Croquetas",
        "1× Flan",
      ]);
      expect(rows[0]!.querySelectorAll(".notice-line")).toHaveLength(3);
      expect(dishes[0]!.textContent).toContain("No onions");
      const notes = [...rows[0]!.querySelectorAll(".notice-note")].map((n) => n.textContent);
      expect(notes.filter((text) => text === "No onions")).toHaveLength(1);
      const started = locale === "en-GB" ? "Started" : es["station.notice.started"];
      expect(dishes.map((row) => row.querySelector(".notice-started")?.textContent)).toEqual([
        started,
        started,
        undefined,
      ]);
      expect(rows[0]!.querySelectorAll(".notice-started")).toHaveLength(2);
      const button = rows[0]!.querySelector("wt-button")!;
      for (const name of ["1× Burger", "2× Croquetas", "1× Flan"])
        expect(button.getAttribute("aria-label")).toContain(name);

      const body = rows[0]!.querySelector<HTMLElement>(".notice-body")!.getBoundingClientRect();
      const boxes = dishes.map((row) => row.getBoundingClientRect());
      for (let index = 1; index < boxes.length; index += 1)
        expect(boxes[index]!.top).toBeGreaterThan(boxes[index - 1]!.top);
      for (const [index, box] of boxes.entries()) {
        expect(box.width).toBeCloseTo(body.width, 0);
        expect(box.right).toBeLessThanOrEqual(window.innerWidth);
        expect(dishes[index]!.scrollWidth).toBeLessThanOrEqual(dishes[index]!.clientWidth);
      }

      const acknowledged = vi.fn();
      el.addEventListener("acknowledge-notice", acknowledged);
      await userEvent.click(button);
      expect(acknowledged).toHaveBeenCalledTimes(1);
      expect(acknowledged.mock.calls[0]![0].detail).toEqual({ noticeId: notice.id });
    },
  );
});
