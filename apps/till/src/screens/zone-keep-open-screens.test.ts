import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillFloorScreen } from "./till-floor-screen.js";

afterEach(cleanupWidgets);

it.each([true, false])(
  "the floor bar shows the scheduled closing time without an extension control (closed=%s)",
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
          hasPlan: false,
          layoutSetName: null,
          layoutDue: null,
          serviceMode: "table_tab",
        },
        {
          id: "bar",
          name: "Bar",
          displayOrder: 1,
          active: true,
          closed: false,
          closesAt: null,
          hasPlan: false,
          layoutSetName: null,
          layoutDue: null,
          serviceMode: "table_tab",
        },
      ],
      tables: [],
    } as Partial<TillFloorScreen>);
    expect(el.shadowRoot!.querySelector("[data-zone-control] p")!.textContent!.trim()).toBe(
      closed ? "Terrace is closed now." : "Terrace closes at 22:00 today.",
    );
    expect(el.shadowRoot!.querySelector("till-keep-open")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="bar"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-zone-control]")).toBeNull();
  },
);
it("the floor bar names a closing zone exactly as typed when its name spells the time's slot", async () => {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [
      {
        id: "terrace",
        name: "Terrace {time}",
        displayOrder: 0,
        active: true,
        closed: false,
        closesAt: "22:00",
        hasPlan: false,
        layoutSetName: null,
        layoutDue: null,
        serviceMode: "table_tab",
      },
    ],
    tables: [],
  } as Partial<TillFloorScreen>);
  const line = el.shadowRoot!.querySelector("[data-zone-control] p")!.textContent!.trim();
  expect(line).toBe("Terrace {time} closes at 22:00 today.");
});
