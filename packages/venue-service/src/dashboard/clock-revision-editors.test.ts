import { LitElement } from "lit";
import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-week.js";
import "./opening-hours-zone-week.js";
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const el of hosts.splice(0)) el.remove();
});
const department = {
  id: "dept",
  name: "Restaurant",
  active: true,
  periods: [
    {
      id: "period",
      name: "Lunch",
      colour: "green" as const,
      menuId: "menu",
      staffMenuIds: [],
      endOffsetMinutes: 0,
      weekdays: [1],
      routingUses: [],
    },
  ],
  week: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    slots: weekday === 1 ? [{ periodId: "period", startsAt: "10:00", endsAt: "14:00" }] : [],
  })),
  dates: [],
};
const zone = {
  id: "zone",
  name: "Terrace",
  week: [{ weekday: 1, ranges: [{ startsAt: "10:00", endsAt: "11:00" }] }],
  dates: [],
};
for (const kind of ["department", "zone"] as const) {
  it(`${kind} keeps a dirty draft's opening clock revision through a live model replacement`, async () => {
    const writes: unknown[] = [];
    const api = new OpeningHoursApi((async (_path, _method, body) => {
      writes.push(body);
    }) as DashboardRequest);
    const el = document.createElement(
      kind === "department" ? "opening-hours-week" : "opening-hours-zone-week",
    ) as unknown as LitElement & {
      api: OpeningHoursApi;
      department: typeof department;
      zone: typeof zone;
      clockRevision: number;
    };
    Object.assign(el, {
      api,
      department: structuredClone(department),
      zone: structuredClone(zone),
      clockRevision: 7,
    });
    applyTokens(el);
    hosts.push(el);
    document.body.append(el);
    await el.updateComplete;
    const grid = el.shadowRoot!.querySelector("service-grid")!;
    grid.dispatchEvent(
      new CustomEvent("grid-block-change", {
        detail: {
          columnKey: "1",
          index: 0,
          startsAt: "10:00",
          endsAt: kind === "department" ? "15:00" : "12:00",
        },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.clockRevision = 8;
    el.department = structuredClone(department);
    if (kind === "zone") el.zone = structuredClone(zone);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      expectedClockRevision: 7,
      days: expect.arrayContaining([
        kind === "department"
          ? { weekday: 1, slots: [{ periodId: "period", startsAt: "10:00", endsAt: "15:00" }] }
          : { weekday: 1, ranges: [{ startsAt: "10:00", endsAt: "12:00" }] },
      ]),
    });
  });
}
