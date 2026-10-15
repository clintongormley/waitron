import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import type { StaffingApi } from "./client.js";
import type { RotaWeek } from "../staffing-types.js";
import { STAFFING_DASHBOARD } from "./index.js";
import type { LitElement } from "lit";

const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
type View = LitElement & {
  api: StaffingApi;
  week: string;
  params: Record<string, string>;
  canWrite: boolean;
  open: ReturnType<typeof vi.fn>;
};
async function mount(client = rotaApi().api, width = "1280px") {
  const f = document.createElement("div");
  f.style.width = width;
  document.body.append(f);
  frames.push(f);
  applyTokens(f);
  const el = document.createElement("staffing-rota") as View;
  el.api = client;
  el.week = "2026-11-30";
  el.params = {};
  el.canWrite = true;
  el.open = vi.fn();
  f.append(el);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("rota-by-area")).toBeTruthy());
  return el;
}
const area = (el: View) => el.shadowRoot!.querySelector<LitElement>("rota-by-area")!;
const text = (el: View) => area(el).shadowRoot!.textContent!;

describe("the Rota by area", () => {
  it("offers a Rota calendar contribution restricted to schedule managers", () => {
    const view = STAFFING_DASHBOARD.calendarViews!.find((v) => v.id === "rota");
    expect(view).toMatchObject({
      labelKey: "staffing.rota.tab",
      order: 20,
      requiresPermission: "schedule.manage",
      readPermission: "schedule.manage",
    });
  });
  it("draws staff roles in position order and every slot state, overflow, closed days and week hours", async () => {
    const el = await mount();
    const r = area(el).shadowRoot!;
    expect([...r.querySelectorAll("th[scope=row]")].map((n) => n.textContent!.trim())).toEqual([
      "Head chef",
      "Sous chef",
      "Not in a slot",
    ]);
    for (const label of [
      "Ana",
      "uncovered 14:00–17:00",
      "outside staff role",
      "not needed",
      "+ unfilled",
      "belongs to the previous week",
      "Closed",
    ])
      expect(text(el)).toContain(label);
    expect(el.shadowRoot!.querySelector("[data-test=attention]")!.textContent).toContain(
      "1 unfilled · 1 partly uncovered · 1 over",
    );
    expect(el.shadowRoot!.querySelector("[data-person=joan]")!.textContent).toContain("41 / 40 h");
    expect(
      el.shadowRoot!.querySelector("[data-person=joan]")!.hasAttribute("data-over-contract"),
    ).toBe(true);
  });
  it("steps real weeks through the host and keeps the selected area in the address", async () => {
    const el = await mount();
    el.params = { area: "station:kitchen" };
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
    expect(el.open).toHaveBeenCalledWith("rota", { week: "2026-12-07", area: "station:kitchen" });
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox",
    )!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "department:restaurant" } }));
    expect(el.open).toHaveBeenCalledWith("rota", {
      week: "2026-11-30",
      area: "department:restaurant",
    });
  });
  it("opens a slot picker, fills the slot with a non-passive request and refreshes", async () => {
    let filled = false;
    const { api, request } = rotaApi(async (week) => {
      const r = rotaWeek(week);
      if (filled)
        r.days[4]!.areas[0]!.match.slots[0]!.status = {
          kind: "filled",
          shiftId: "filled",
          outsideRole: false,
        };
      return r;
    });
    const el = await mount(api);
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<LitElement>("slot-picker")!;
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain("Show everyone");
    filled = true;
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
    expect(request).toHaveBeenCalledWith("/management-api/staffing/rota/shifts", "POST", {
      week: "2026-11-30",
      businessDay: "2026-12-04",
      area: { kind: "station", id: "kitchen" },
      staffRoleId: "sous",
      startsAt: "09:00",
      endsAt: "17:00",
      personId: "marc",
    });
    await vi.waitFor(() =>
      expect(area(el).shadowRoot!.querySelector("[data-slot=empty]")!.textContent).toContain("Ana"),
    );
    expect(request.mock.calls.slice(-2)).toEqual([
      ["/management-api/staffing/rota?week=2026-11-30", "GET", undefined, { passive: true }],
      [
        "/management-api/roster/breaches?locationId=location&period=2026-11-30",
        "GET",
        undefined,
        { passive: true },
      ],
    ]);
  });
  it("shows published weeks without slot actions", async () => {
    const el = await mount(
      rotaApi(async (w) => {
        const r = rotaWeek(w);
        r.version = { id: "pub", status: "published", changedSincePublished: false };
        return r;
      }).api,
    );
    expect(area(el).shadowRoot!.querySelector("button[data-slot]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Published");
  });
  it("keeps the new week's snapshot when an older read answers late", async () => {
    let old!: (r: RotaWeek) => void;
    const el = await (async () => {
      const { api } = rotaApi((w) =>
        w === "2026-11-30"
          ? new Promise((resolve) => (old = resolve))
          : Promise.resolve(rotaWeek(w)),
      );
      const f = document.createElement("div");
      document.body.append(f);
      frames.push(f);
      applyTokens(f);
      const v = document.createElement("staffing-rota") as View;
      v.api = api;
      v.week = "2026-11-30";
      v.open = vi.fn();
      f.append(v);
      await vi.waitFor(() => expect(old).toBeTypeOf("function"));
      return v;
    })();
    el.week = "2026-12-07";
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-area")).toBeTruthy());
    old(rotaWeek());
    await el.updateComplete;
    await Promise.resolve();
    expect(el.shadowRoot!.querySelector("[data-test=week]")!.textContent).toContain("7 Dec");
  });
  it("updates from live changes and recovers load errors without hiding action errors", async () => {
    const live = new LiveData();
    const { api, request } = rotaApi(undefined, live);
    const el = await mount(api);
    expect(live.interests.map((i) => i.type)).toContain("shift_assignments");
    request.mockRejectedValueOnce({ code: "connection.failed" });
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=load-error]")).toBeTruthy(),
    );
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=load-error]")).toBeNull(),
    );
  });
  it.each(["390px", "900px", "1280px"])(
    "keeps the page width at %s and lets the grid scroll",
    async (width) => {
      const el = await mount(undefined, width);
      const r = area(el).shadowRoot!;
      const scroller = r.querySelector<HTMLElement>("[data-test=grid-scroll]")!;
      expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(parseInt(width));
      expect(scroller.scrollWidth).toBeGreaterThanOrEqual(scroller.clientWidth);
      if (parseInt(width) >= 900) expect(scroller.scrollWidth).toBe(scroller.clientWidth);
    },
  );
});

describe("the Rota's request lifecycle", () => {
  it("closes a picker when its week is published on another screen", async () => {
    const live = new LiveData();
    let published = false;
    const client = rotaApi(async (w) => {
      const r = rotaWeek(w);
      if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
      return r;
    }, live);
    const el = await mount(client.api);
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeTruthy();
    published = true;
    live.invalidate([{ type: "roster_versions" }]);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
  });
  it("retains a refused fill for retry, and closes the picker after a successful write even when refresh fails", async () => {
    const client = rotaApi();
    const el = await mount(client.api);
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<LitElement>("slot-picker")!;
    await picker.updateComplete;
    client.request.mockRejectedValueOnce({ code: "connection.failed" });
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(picker.shadowRoot!.querySelector("[role=alert]")).toBeTruthy());
    client.request
      .mockResolvedValueOnce({ shiftId: "new" })
      .mockRejectedValueOnce({ code: "connection.failed" });
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=load-error]")).toBeTruthy(),
    );
  });
});

describe("Rota address and person details", () => {
  it("lists staff roles in the people panel", async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector("[data-person=ana]")!.textContent).toContain("Head chef");
  });
  it("does not show a picker for another area after an address change", async () => {
    const el = await mount();
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    el.params = { area: "department:restaurant" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
  });
});
