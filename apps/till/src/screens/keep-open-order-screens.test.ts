import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TillApi } from "../api/client.js";
import type { MenuState } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillKeepOpen } from "../widgets/keep-open.js";
import type { TillKeepOpenDialog } from "../widgets/keep-open-dialog.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { TillTableOrderScreen } from "./till-table-order-screen.js";

const subject = {
  periodId: "lunch",
  periodName: "Lunch",
  endsAt: "14:00",
  running: true,
  extendedUntil: null,
};
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

for (const kind of ["counter", "table"] as const) {
  describe(`${kind} keep-open order screen`, () => {
    async function mount(service: MenuState["service"]) {
      const calls: string[] = [];
      const api = new TillApi(
        "",
        vi.fn(async (path: string | URL | Request) => {
          calls.push(String(path));
          return new Response(
            JSON.stringify({
              period: {
                id: "lunch",
                name: "Lunch",
                endsAt: "14:00",
                running: true,
                extendedUntil: null,
                dayEndsAt: "05:00",
                choices: ["14:15", "14:30"],
                next: null,
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }),
      );
      const shared = { api, service, departmentName: "Restaurant" };
      const { el } =
        kind === "counter"
          ? await mountWidget<TillCounterScreen>("till-counter-screen", {
              ...shared,
              selectedServiceZoneId: "counter /1",
              embedded: true,
              store: new WorkingOrderStore(),
              counterTab: {
                key: "counter",
                title: "Counter",
                columns: 4,
                cards: [{ type: "basket", colSpan: 4, rowSpan: 2, config: {} }],
              },
            })
          : await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
              ...shared,
              zoneId: "dining /2",
              draftStore: new WorkingOrderStore(),
            });
      return { el, calls };
    }
    it.each([
      { extendedUntil: null, want: "Lunch · until 14:00" },
      { extendedUntil: "14:30", want: "Lunch · kept open until 14:30" },
    ])("shows the effective endpoint: $want", async ({ extendedUntil, want }) => {
      const { el } = await mount({
        open: true,
        zoneOpen: true,
        periodName: "Lunch",
        keepOpen: { ...subject, extendedUntil },
      });
      const line = el.shadowRoot!.querySelector("[data-service-period]")!;
      expect(line.textContent!.trim()).toBe(want);
      const widget = el.shadowRoot!.querySelector<TillKeepOpen>("till-keep-open")!;
      expect(widget, "the control is beside the period line").not.toBeNull();
      expect(widget.parentElement).toBe(line.parentElement);
      await widget.updateComplete;
      expect(widget.shadowRoot!.querySelector("wt-button")!.textContent!.trim()).toBe(
        "Keep Lunch open later",
      );
    });
    it("keeps recovery reachable in the closed-department notice and uses this screen's zone", async () => {
      const { el, calls } = await mount({
        open: false,
        zoneOpen: true,
        periodName: null,
        keepOpen: { ...subject, running: false },
      });
      const notice = el.shadowRoot!.querySelector("[data-service-closed]")!;
      expect(notice.textContent!.trim()).toBe("Restaurant is closed: no period is running");
      const widget = el.shadowRoot!.querySelector<TillKeepOpen>("till-keep-open")!;
      expect(widget, "the closed notice keeps the recovery control").not.toBeNull();
      expect(widget.parentElement).toBe(notice.parentElement);
      await widget.updateComplete;
      widget.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
      await expect
        .poll(() => widget.shadowRoot!.querySelector("till-keep-open-dialog"))
        .not.toBeNull();
      const dialog = widget.shadowRoot!.querySelector<TillKeepOpenDialog>("till-keep-open-dialog")!;
      await dialog.updateComplete;
      expect(dialog.shadowRoot!.querySelector("wt-combobox")).not.toBeNull();
      expect(calls).toEqual([
        kind === "counter"
          ? "/api/service-zones/counter%20%2F1/keep-open"
          : "/api/service-zones/dining%20%2F2/keep-open",
      ]);
    });
    it("omits both the period line and recovery control when no period ran today", async () => {
      const { el } = await mount({ open: false, zoneOpen: true, periodName: null, keepOpen: null });
      expect(el.shadowRoot!.querySelector("[data-service-period]")).toBeNull();
      expect(el.shadowRoot!.querySelector("till-keep-open")).toBeNull();
    });
  });
}
