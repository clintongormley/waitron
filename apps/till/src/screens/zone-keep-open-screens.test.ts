import { afterEach, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { MenuState } from "../api/client.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { TillTableOrderScreen } from "./till-table-order-screen.js";
import { TillFloorScreen } from "./till-floor-screen.js";
import type { TillKeepOpen } from "../widgets/keep-open.js";
import { currentLocale, setLocale } from "../i18n/t.js";
afterEach(cleanupWidgets);
for (const kind of ["counter", "table"] as const) {
  it.each(["closing", "closed", "extended", "no closing"])(
    `${kind} shows zone recovery when %s`,
    async (state) => {
      const previous = currentLocale();
      setLocale("en");
      try {
        const service: MenuState["service"] = {
          open: true,
          zoneOpen: state !== "closed",
          periodName: "Dinner",
          keepOpen: null,
          zoneKeepOpen:
            state === "no closing"
              ? null
              : {
                  zoneId: "terrace",
                  zoneName: "Terrace",
                  closesAt: "22:00",
                  running: state !== "closed",
                  extendedUntil: state === "extended" ? "22:30" : null,
                },
        };
        const props = { service, zoneName: "Terrace", departmentName: "Restaurant" };
        const { el } =
          kind === "counter"
            ? await mountWidget<TillCounterScreen>("till-counter-screen", {
                ...props,
                selectedServiceZoneId: "terrace",
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
                ...props,
                zoneId: "terrace",
                draftStore: new WorkingOrderStore(),
              });
        const widget = el.shadowRoot!.querySelector<TillKeepOpen>('till-keep-open[subject="zone"]');
        if (state === "no closing") {
          expect(widget).toBeNull();
          return;
        }
        expect(widget, "a zone's closure leaves recovery reachable").not.toBeNull();
        await widget!.updateComplete;
        expect(widget!.zoneId).toBe("terrace");
        expect(widget!.shadowRoot!.querySelector("[data-action]")!.textContent!.trim()).toBe(
          "Keep Terrace open later",
        );
        expect(
          widget!.parentElement!.querySelector(
            state === "closed" ? "[data-zone-closed]" : "[data-service-period]",
          ),
        ).not.toBeNull();
      } finally {
        setLocale(previous);
      }
    },
  );
}
it.each([true, false])(
  "the floor bar offers recovery for the selected closing zone (closed=%s)",
  async (closed) => {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [
        {
          id: "terrace",
          name: "Terrace",
          displayOrder: 0,
          active: true,
          closed,
          closesAt: "22:00",
        },
        { id: "bar", name: "Bar", displayOrder: 1, active: true, closed: false, closesAt: null },
      ],
      tables: [],
    } as Partial<TillFloorScreen>);
    const widget = el.shadowRoot!.querySelector<TillKeepOpen>('till-keep-open[subject="zone"]');
    expect(widget, "the selected zone has its own control").not.toBeNull();
    expect(widget!.zoneId).toBe("terrace");
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="bar"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('till-keep-open[subject="zone"]')).toBeNull();
  },
);
