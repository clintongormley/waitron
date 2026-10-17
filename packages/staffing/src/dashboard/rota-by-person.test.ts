import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import type { RotaWeek } from "../staffing-types.js";
import type { RosterBreach } from "@waitron/workforce/roster-validation";
import "./rota-view.js";
const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
type View = LitElement & {
  api: ReturnType<typeof rotaApi>["api"];
  week: string;
  params: Record<string, string>;
  canWrite: boolean;
  open: ReturnType<typeof vi.fn>;
};
async function mount(
  published = false,
  width = "1280px",
  prepare: (week: RotaWeek) => RotaWeek = (r) => r,
  live?: LiveData,
) {
  const frame = document.createElement("div");
  frame.style.width = width;
  frames.push(frame);
  document.body.append(frame);
  applyTokens(frame);
  const el = document.createElement("staffing-rota") as View;
  const client = rotaApi(async (w) => {
    const r = rotaWeek(w);
    if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
    return prepare(r);
  }, live);
  el.api = client.api;
  el.week = "2026-11-30";
  el.params = { area: "everyone" };
  el.canWrite = true;
  el.open = vi.fn();
  frame.append(el);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("rota-by-person")).toBeTruthy());
  const grid = el.shadowRoot!.querySelector<
    LitElement & { week: RotaWeek; breaches: RosterBreach[] }
  >("rota-by-person")!;
  await grid.updateComplete;
  return { el, grid, root: grid.shadowRoot!, request: client.request };
}
type Menu = LitElement & { personId: string; businessDay: string };
async function menu(el: LitElement) {
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("rota-popup > rota-open-slots")).toBeTruthy(),
  );
  const found = el.shadowRoot!.querySelector<Menu>("rota-open-slots")!;
  await found.updateComplete;
  await vi.waitFor(() =>
    expect(
      el
        .shadowRoot!.querySelector("rota-popup")!
        .shadowRoot!.querySelector("[popover]")!
        .matches(":popover-open"),
    ).toBe(true),
  );
  return found;
}
const dayAdd = (root: ShadowRoot, person: string, day: string) =>
  root.querySelector<HTMLElement>(
    `[data-person=${person}] [data-day="${day}"] [data-test=day-add]`,
  )!;
async function useViewport(width: number, height: number) {
  const before = [innerWidth, innerHeight] as const;
  await page.viewport(width, height);
  await vi.waitFor(() => expect(innerWidth).toBe(width));
  onTestFinished(() => page.viewport(...before));
}
describe("the Rota by person", () => {
  it("lists each person with staff roles, contract hours, shifts and business-day overflow", async () => {
    const { root } = await mount();
    expect([...root.querySelectorAll("th[scope=row]")].map((e) => e.textContent)).toHaveLength(5);
    expect(root.querySelector("[data-person=ana]")!.textContent).toContain("Head chef");
    expect(root.querySelector("[data-person=joan]")!.textContent).toContain("41 / 40 h");
    expect(root.querySelector("[data-shift=filled]")!.textContent).toContain("09:00–17:00");
    expect(root.querySelector("[data-shift=filled]")!.textContent).toContain("Kitchen · Head chef");
    expect(root.querySelector("[data-shift=unlinked]")!.textContent).toContain(
      "belongs to the previous week",
    );
  });
  it("places shift warnings, daily warnings and week warnings on their named targets", async () => {
    const { grid, root } = await mount();
    grid.breaches = [
      {
        kind: "rest_too_short",
        personId: "ana",
        shiftId: "filled",
        previousShiftId: "past",
        restMinutes: 540,
        requiredMinutes: 720,
      },
      {
        kind: "break_owed",
        personId: "ana",
        shiftId: "filled",
        plannedMinutes: 480,
        thresholdMinutes: 360,
        minBreakMinutes: 15,
      },
      { kind: "night_work", personId: "ana", shiftId: "filled", nightMinutes: 120 },
      {
        kind: "exceeds_daily_max",
        personId: "ana",
        workDate: "2026-12-01",
        plannedMinutes: 600,
        maxMinutes: 540,
      },
      {
        kind: "exceeds_weekly_max",
        personId: "joan",
        weekStart: "2026-11-30",
        plannedMinutes: 2460,
        maxMinutes: 2400,
      },
      {
        kind: "weekly_rest_insufficient",
        personId: "joan",
        weekStart: "2026-11-30",
        longestRestMinutes: 1440,
        requiredMinutes: 2160,
      },
    ];
    await grid.updateComplete;
    const shift = root.querySelector("[data-shift=filled]")!.textContent!;
    expect(shift).toContain("9 h rest");
    expect(shift).toContain("0.25 h break owed");
    expect(shift).toContain("2 h night work");
    expect(root.querySelector('[data-person=ana] [data-day="2026-12-01"]')!.textContent).toContain(
      "daily maximum 9 h",
    );
    expect(root.querySelector("[data-person=joan] th")!.textContent).toContain(
      "weekly maximum 40 h",
    );
    expect(root.querySelector("[data-person=joan] th")!.textContent).toContain("24 h weekly rest");
    expect(root.querySelector("[data-person=marc]")!.textContent).not.toContain("9 h rest");
  });
  it("opens prefilled new shifts and existing shifts, preserving the view in week navigation", async () => {
    const { el, root } = await mount();
    root
      .querySelector<HTMLElement>('[data-person=ana] [data-day="2026-12-04"] [data-test=day-add]')!
      .click();
    (await menu(el)).shadowRoot!.querySelector<HTMLElement>("[data-test=another-shift]")!.click();
    await el.updateComplete;
    const editor = el.shadowRoot!.querySelector<
      LitElement & { businessDay: string; personId: string; shiftId?: string }
    >("rota-shift-dialog")!;
    await editor.updateComplete;
    expect(editor.businessDay).toBe("2026-12-04");
    expect(editor.personId).toBe("ana");
    expect(editor.shiftId).toBeUndefined();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
    expect(el.open).toHaveBeenCalledWith("rota", { week: "2026-12-07", area: "everyone" });
  });
  it("offers no add or edit controls in a published week", async () => {
    const { root } = await mount(true);
    expect(root.querySelector("button[data-shift]")).toBeNull();
    expect(root.querySelector("[data-test=day-add]")).toBeNull();
  });
  it.each(["390px", "1280px"])("contains its scrolling grid at %s", async (width) => {
    const { grid, root } = await mount(false, width);
    expect(grid.getBoundingClientRect().width).toBeLessThanOrEqual(parseInt(width));
    const scroll = root.querySelector<HTMLElement>("[data-test=grid-scroll]")!;
    expect(scroll.clientWidth).toBeLessThanOrEqual(parseInt(width));
    if (width === "1280px") expect(scroll.scrollWidth).toBe(scroll.clientWidth);
  });
});

it("offers only the Show menu, set to Everyone, in the all-areas person view", async () => {
  const { el } = await mount();
  const boxes =
    el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox");
  expect(boxes).toHaveLength(1);
  expect(boxes[0]!.getAttribute("name")).toBe("area");
  expect(boxes[0]!.value).toBe("everyone");
  expect(el.shadowRoot!.querySelector("[data-test=by-area]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=by-person]")).toBeNull();
});

it("counts every area's open slots in the person view", async () => {
  const { el } = await mount(false, "1280px", (r) => {
    r.days[4]!.areas.push({
      area: r.areas[1]!.area,
      match: {
        slots: [
          {
            slot: {
              ...r.days[4]!.areas[0]!.match.slots[0]!.slot,
              key: "restaurant",
              area: r.areas[1]!.area,
            },
            status: { kind: "unfilled" },
          },
        ],
        over: [],
      },
    });
    return r;
  });
  expect(el.shadowRoot!.querySelector("[data-test=attention]")!.textContent).toContain(
    "2 unfilled",
  );
});
it("shows a daily warning once on its calendar date when the shift starts before changeover", async () => {
  const { grid, root } = await mount();
  grid.week = {
    ...grid.week,
    shifts: grid.week.shifts.map((s) =>
      s.shiftId === "filled"
        ? { ...s, businessDay: "2026-11-30", startsAt: "2026-12-01T00:00:00Z" }
        : s,
    ),
  };
  grid.breaches = [
    {
      kind: "exceeds_daily_max",
      personId: "ana",
      workDate: "2026-12-01",
      plannedMinutes: 600,
      maxMinutes: 540,
    },
  ];
  await grid.updateComplete;
  expect(
    root.querySelector('[data-person=ana] [data-day="2026-11-30"]')!.textContent,
  ).not.toContain("daily maximum");
  expect(root.querySelector('[data-person=ana] [data-day="2026-12-01"]')!.textContent).toContain(
    "daily maximum 9 h",
  );
});
it("Everyone's day headers name their attention across areas and a closed day reads Closed once", async () => {
  const { root } = await mount();
  const head = (day: string) =>
    root.querySelector(`th[data-day-head="${day}"]`)!.textContent!.replace(/\s+/g, " ");
  expect(head("2026-12-04")).toContain("1 unfilled");
  expect(head("2026-12-03")).toContain("1 over");
  expect(head("2026-11-30")).toContain("Closed");
  expect([...root.querySelectorAll("td")].filter((c) => c.textContent!.includes("Closed"))).toEqual(
    [],
  );
});
it("a grid reports a target it does not draw", async () => {
  const { el, grid } = await mount();
  const people = grid as unknown as { focusTarget(t: object): boolean };
  expect(people.focusTarget({ businessDay: "2026-12-04", slotKey: "empty" })).toBe(false);
  expect(people.focusTarget({ businessDay: "2026-12-04", shiftId: "gone" })).toBe(false);
  el.params = { area: "station:kitchen" };
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-area")).toBeTruthy());
  const byArea = el.shadowRoot!.querySelector("rota-by-area") as unknown as {
    focusTarget(t: object): boolean;
  };
  expect(byArea.focusTarget({ businessDay: "2026-12-04", slotKey: "gone" })).toBe(false);
  expect(byArea.focusTarget({ businessDay: "2026-12-04", slotKey: "empty" })).toBe(true);
});
it("rows follow each person's first staff role, then name", async () => {
  const { root } = await mount();
  expect(
    [...root.querySelectorAll<HTMLElement>("[data-person]")].map((r) => r.dataset.person),
  ).toEqual(["ana", "marc", "joan", "laia", "ibra"]);
});
it("each card carries its staff role's colour, its time, its area and staff role, and keeps its warnings", async () => {
  const { root, grid } = await mount();
  const filled = root.querySelector<HTMLElement>("[data-shift=filled]")!;
  const swatch = filled.querySelector<HTMLElement>(".swatch")!;
  expect(swatch.dataset.colour).toBe("purple");
  const probe = document.createElement("span");
  probe.style.background = "var(--wt-color-palette-purple)";
  frames[0]!.append(probe);
  const painted = getComputedStyle(swatch).backgroundColor;
  expect(painted).toBe(getComputedStyle(probe).backgroundColor);
  expect(painted).not.toBe("rgba(0, 0, 0, 0)");
  expect(filled.textContent).toContain("09:00–17:00");
  expect(filled.textContent).toContain("Kitchen · Head chef");
  expect(root.querySelector("[data-shift=part] .swatch")!.getAttribute("data-colour")).toBe(
    "green",
  );
  expect(root.querySelector("[data-shift=over]")!.textContent).toContain("not needed");
  expect(root.querySelector("[data-shift=part]")!.textContent!.replace(/\s+/g, " ")).toContain(
    "uncovered 14:00–17:00",
  );
  expect(root.querySelector("[data-shift=filled]")!.textContent).not.toContain("uncovered");
  expect(root.querySelector("[data-shift=unlinked] .swatch")).toBeNull();
  grid.breaches = [{ kind: "night_work", personId: "ana", shiftId: "filled", nightMinutes: 120 }];
  await grid.updateComplete;
  expect(root.querySelector("[data-shift=filled]")!.textContent).toContain("2 h night work");
});
it("under each name its staff roles and the week's hours, marked when over contract", async () => {
  const { root } = await mount();
  const joan = root.querySelector("[data-person=joan] th")!;
  expect(joan.textContent).toContain("Sous chef");
  expect(joan.textContent).toContain("41 / 40 h");
  expect(joan.hasAttribute("data-over-contract")).toBe(true);
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-warning)";
  frames[0]!.append(probe);
  const warning = getComputedStyle(probe).color;
  expect(getComputedStyle(joan.querySelector(".hours")!).color).toBe(warning);
  const ana = root.querySelector("[data-person=ana] th")!;
  expect(ana.hasAttribute("data-over-contract")).toBe(false);
  expect(getComputedStyle(ana.querySelector(".hours")!).color).not.toBe(warning);
  expect(root.querySelector("[data-person=ibra] th")!.hasAttribute("data-over-contract")).toBe(
    false,
  );
});
it("names its scrolling grid Everyone", async () => {
  const { root } = await mount();
  expect(root.querySelector("[data-test=grid-scroll]")!.getAttribute("aria-label")).toBe(
    "Everyone",
  );
});

describe("filling the rota from Everyone", () => {
  const normal = (s: string) => s.replace(/\s+/g, " ").trim();
  it("the empty part of a day shows + Add shift on hover or focus, named with the person and day", async () => {
    const { root } = await mount();
    const add = dayAdd(root, "marc", "2026-12-04");
    expect(normal(add.textContent!)).toBe("+ Add shift");
    expect(add.getAttribute("aria-label")).toBe("Add shift: Marc, Fri 4 Dec");
    expect(getComputedStyle(add).opacity).toBe("0");
    await userEvent.hover(add);
    expect(getComputedStyle(add).opacity).toBe("1");
    const cell = root.querySelector('[data-person=ana] [data-day="2026-12-01"]')!;
    const inCell = cell.querySelector("[data-test=day-add]")!.getBoundingClientRect();
    expect(inCell.top).toBeGreaterThanOrEqual(
      cell.querySelector("[data-shift=filled]")!.getBoundingClientRect().bottom,
    );
    expect(cell.getBoundingClientRect().bottom - inCell.bottom).toBeLessThanOrEqual(
      parseFloat(getComputedStyle(cell).paddingBottom) + 1,
    );
    setLocale("es");
    const es = await mount();
    const spanish = dayAdd(es.root, "marc", "2026-12-04");
    expect(normal(spanish.textContent!)).toBe("+ Añadir turno");
    expect(spanish.getAttribute("aria-label")).toBe("Añadir turno: Marc, vie 4 dic");
  });
  it("clicking the empty part of a day opens that day's open slots beside it, and choosing one fills it for that person", async () => {
    await useViewport(1280, 900);
    const { el, root, request } = await mount();
    const add = dayAdd(root, "marc", "2026-12-04");
    await userEvent.click(add);
    const found = await menu(el);
    expect(found.personId).toBe("marc");
    expect(found.businessDay).toBe("2026-12-04");
    expect(el.shadowRoot!.querySelector("rota-popup")!.heading).toBe("Fri 4 Dec · Marc");
    const popup = el
      .shadowRoot!.querySelector("rota-popup")!
      .shadowRoot!.querySelector("[popover]")!
      .getBoundingClientRect();
    const at = add.getBoundingClientRect();
    expect(Math.abs(popup.top - at.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(popup.left - at.right) <= 1 || Math.abs(popup.right - at.left) <= 1).toBe(true);
    found.shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull());
    expect(request).toHaveBeenCalledWith("/management-api/staffing/rota/shifts", "POST", {
      week: "2026-11-30",
      businessDay: "2026-12-04",
      area: { kind: "station", id: "kitchen" },
      staffRoleId: "sous",
      startsAt: "09:00",
      endsAt: "17:00",
      personId: "marc",
    });
    await vi.waitFor(() => expect(root.activeElement).toBe(dayAdd(root, "marc", "2026-12-04")));
  });
  it("a refused fill stays in the menu beside its day, and once the menu is dismissed shows under the bar", async () => {
    await useViewport(1280, 900);
    const { el, root, request } = await mount();
    const original = request.getMockImplementation()!;
    let refuse!: (e: unknown) => void;
    request.mockImplementation((async (path: string, method: string, body: unknown) => {
      if (method === "POST" && path.endsWith("/rota/shifts"))
        return new Promise((_, reject) => (refuse = reject));
      return original(path, method, body);
    }) as unknown as typeof original);
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    let found = await menu(el);
    found.shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await vi.waitFor(() => expect(refuse).toBeTypeOf("function"));
    // While the fill is in flight no day button is drawn; the menu follows the day's cell.
    await vi.waitFor(() => expect(dayAdd(root, "marc", "2026-12-04")).toBeNull());
    onTestFinished(() => scrollTo(0, 0));
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    frames[0]!.append(spacer);
    const cell = root.querySelector<HTMLElement>('[data-person=marc] td[data-day="2026-12-04"]')!;
    const before = cell.getBoundingClientRect().top;
    scrollTo(0, 30);
    await vi.waitFor(() => {
      expect(cell.getBoundingClientRect().top).toBeLessThan(before - 1);
      expect(
        Math.abs(
          el
            .shadowRoot!.querySelector("rota-popup")!
            .shadowRoot!.querySelector("[popover]")!
            .getBoundingClientRect().top - cell.getBoundingClientRect().top,
        ),
      ).toBeLessThanOrEqual(1);
    });
    expect(el.shadowRoot!.querySelector("rota-open-slots")).toBe(found);
    refuse({ code: "connection.failed" });
    await vi.waitFor(() =>
      expect(found.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        "Could not fill the slot",
      ),
    );
    await vi.waitFor(() => expect(dayAdd(root, "marc", "2026-12-04")).toBeTruthy());
    const popupBox = () =>
      el
        .shadowRoot!.querySelector("rota-popup")!
        .shadowRoot!.querySelector("[popover]")!
        .getBoundingClientRect();
    await vi.waitFor(() =>
      expect(
        Math.abs(popupBox().top - dayAdd(root, "marc", "2026-12-04").getBoundingClientRect().top),
      ).toBeLessThanOrEqual(1),
    );
    expect(el.shadowRoot!.querySelector("[data-test=fill-error]")).toBeNull();
    refuse = undefined as unknown as typeof refuse;
    found.shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await vi.waitFor(() => expect(refuse).toBeTypeOf("function"));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull());
    refuse({ code: "connection.failed" });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=fill-error]")?.textContent).toContain(
        "Could not fill the slot",
      ),
    );
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    found = await menu(el);
    expect(el.shadowRoot!.querySelector("[data-test=fill-error]")).toBeNull();
  });
  it("Another shift… opens the shift editor for that person and day", async () => {
    const { el, root } = await mount();
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    (await menu(el)).shadowRoot!.querySelector<HTMLElement>("[data-test=another-shift]")!.click();
    const editor = el.shadowRoot!.querySelector<
      LitElement & { open: boolean; businessDay: string; personId: string; shiftId?: string }
    >("rota-shift-dialog")!;
    await vi.waitFor(() => expect(editor.open).toBe(true));
    expect(editor.businessDay).toBe("2026-12-04");
    expect(editor.personId).toBe("marc");
    expect(editor.shiftId).toBeUndefined();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull());
  });
  it("closes the open-slots menu when its week is published on another screen", async () => {
    const live = new LiveData();
    let published = false;
    const { el, root } = await mount(
      false,
      "1280px",
      (r) => {
        if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
        return r;
      },
      live,
    );
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    await menu(el);
    published = true;
    live.invalidate([{ type: "roster_versions" }]);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull());
  });
  it("closes the open-slots menu when its last offered slot is filled on another screen, and keeps a menu that offered none", async () => {
    const live = new LiveData();
    let filled = false;
    const { el, root } = await mount(
      false,
      "1280px",
      (r) => {
        if (filled)
          r.days[4]!.areas[0]!.match.slots[0]!.status = {
            kind: "filled",
            shiftId: "filled",
            outsideRole: false,
          };
        return r;
      },
      live,
    );
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    await menu(el);
    filled = true;
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull());

    await userEvent.click(dayAdd(root, "marc", "2026-12-02"));
    const none = await menu(el);
    expect(none.shadowRoot!.querySelector("[data-slot]")).toBeNull();
    const before = (none as unknown as { week: RotaWeek }).week;
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() => expect((none as unknown as { week: RotaWeek }).week).not.toBe(before));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("rota-open-slots")).toBe(none);
    expect(none.businessDay).toBe("2026-12-02");
  });
  it("closes the open-slots menu when its person leaves the rota on another screen, and keeps it when someone else leaves", async () => {
    const live = new LiveData();
    const gone = new Set<string>();
    const { el, root } = await mount(
      false,
      "1280px",
      (r) => {
        r.people = r.people.filter((p) => !gone.has(p.personId));
        r.shifts = r.shifts.filter((s) => !gone.has(s.personId));
        return r;
      },
      live,
    );
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    const found = await menu(el);
    gone.add("ibra");
    live.invalidate([{ type: "persons" }]);
    await vi.waitFor(() => expect(root.querySelector("[data-person=ibra]")).toBeNull());
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("rota-open-slots")).toBe(found);
    gone.add("marc");
    live.invalidate([{ type: "persons" }]);
    await vi.waitFor(() => expect(root.querySelector("[data-person=marc]")).toBeNull());
    expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull();
  });
  it("closes the open-slots menu when its person leaves the rota while a fill from it is in flight", async () => {
    const live = new LiveData();
    const gone = new Set<string>();
    const { el, root, request } = await mount(
      false,
      "1280px",
      (r) => {
        r.people = r.people.filter((p) => !gone.has(p.personId));
        r.shifts = r.shifts.filter((s) => !gone.has(s.personId));
        return r;
      },
      live,
    );
    const original = request.getMockImplementation()!;
    let refuse!: (e: unknown) => void;
    request.mockImplementation((async (path: string, method: string, body: unknown) => {
      if (method === "POST" && path.endsWith("/rota/shifts"))
        return new Promise((_, reject) => (refuse = reject));
      return original(path, method, body);
    }) as unknown as typeof original);
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    (await menu(el)).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await vi.waitFor(() => expect(refuse).toBeTypeOf("function"));
    gone.add("marc");
    live.invalidate([{ type: "persons" }]);
    await vi.waitFor(() => expect(root.querySelector("[data-person=marc]")).toBeNull());
    expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull();
    refuse({ code: "connection.failed" });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=fill-error]")?.textContent).toContain(
        "Could not fill the slot",
      ),
    );
  });
  it("a fill that settles while focus is on another control leaves focus there", async () => {
    const { el, root, request } = await mount();
    const original = request.getMockImplementation()!;
    let accept!: (v: unknown) => void;
    request.mockImplementation((async (path: string, method: string, body: unknown) => {
      if (method === "POST" && path.endsWith("/rota/shifts"))
        return new Promise((resolve) => (accept = resolve));
      return original(path, method, body);
    }) as unknown as typeof original);
    const elsewhere = document.createElement("button");
    elsewhere.textContent = "elsewhere";
    frames[0]!.append(elsewhere);
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    (await menu(el)).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await vi.waitFor(() => expect(accept).toBeTypeOf("function"));
    elsewhere.focus();
    accept({ shiftId: "new" });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-open-slots")).toBeNull());
    await vi.waitFor(() => expect(dayAdd(root, "marc", "2026-12-04")).toBeTruthy());
    await el.updateComplete;
    await new Promise(requestAnimationFrame);
    expect(document.activeElement).toBe(elsewhere);
    expect(root.activeElement).toBeNull();
  });
  it("a day picked before the previous day's menu has drawn shows only the newer day's menu", async () => {
    const { el, root } = await mount();
    const popup = el.shadowRoot!.querySelector("rota-popup")!;
    const show = vi.spyOn(popup, "show");
    const ana = dayAdd(root, "ana", "2026-12-03");
    dayAdd(root, "marc", "2026-12-04").click();
    await el.updateComplete;
    // Marc's menu has been asked for but has not drawn yet: pick another day now.
    ana.click();
    const found = await menu(el);
    expect([found.personId, found.businessDay]).toEqual(["ana", "2026-12-03"]);
    expect(show.mock.calls).toEqual([[ana]]);
  });
  it("clicking another day while a menu is open opens that day's menu", async () => {
    await useViewport(1280, 900);
    const { el, root } = await mount();
    await userEvent.click(dayAdd(root, "marc", "2026-12-04"));
    await menu(el);
    await userEvent.click(dayAdd(root, "ana", "2026-12-03"));
    await new Promise(requestAnimationFrame);
    await el.updateComplete;
    const found = await menu(el);
    expect([found.personId, found.businessDay]).toEqual(["ana", "2026-12-03"]);
    expect(normal(found.shadowRoot!.querySelector("[data-test=open-title]")!.textContent!)).toBe(
      "Thu 3 Dec · Ana",
    );
  });
});
