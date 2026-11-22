import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { setLocale, type CalendarViewHost, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, captureAppLinks, LeaveController, NavigationGuard } from "@waitron/ui";
import { isDashboardPath } from "@waitron/shared";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursYear } from "../opening-hours-calendar.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SeasonPainter } from "./season-painter.js";
import { monthModel } from "../testing/opening-hours-month-fixture.js";
import { drag, frame, grid, settle, withBar } from "../testing/season-painter-fixture.js";
import "./opening-hours-screen.js";

type Screen = HTMLElementTagNameMap["dashboard-opening-hours-screen"];

function yearRead(year: number): OpeningHoursYear {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 4,
    currentBusinessDay: "2026-12-14",
    pending: null,
    year,
    timeZone: "Europe/Madrid",
    today: "2026-12-14",
    seasons: [
      { id: "spring", name: "Spring", startsOn: "03-01", lastDay: "11-30", colour: "green" },
      { id: "winter", name: "Winter", startsOn: "12-01", lastDay: "02-28", colour: "blue" },
    ],
    days: [],
    publicHolidaysAvailable: true,
    holidayCoverage: [],
    area: { addressKey: "a", readiness: "ready", options: [], required: false, chosen: null },
  };
}
const stations = [{ id: "s1", name: "Upstairs bar", active: true }];
function request(model: () => OpeningHoursModel, writes: unknown[] = []): DashboardRequest {
  return (async (path: string, method: string, body: unknown) => {
    if (method !== "GET") {
      writes.push([path, method, body]);
      return method === "PUT" && path.endsWith("/venue-service/seasons") ? model().seasons : {};
    }
    if (path === "/management-api/stations") return stations;
    const year = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (year) return yearRead(Number(year[1]));
    const month = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
    if (month) return monthModel({ month: month[1]! });
    if (path.endsWith("/special-days")) return [];
    if (path.endsWith("/menu-periods/painted-in"))
      return [{ periodId: "p1", seasons: [{ id: "spring", name: "Spring" }], specialDays: [] }];
    if (path.includes("/service-times?"))
      return {
        days: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-12-${14 + index}`,
          departments: [],
        })),
      };
    return model();
  }) as DashboardRequest;
}

class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly writes: unknown[] = [];
  model = withBar();
  calendar?: Screen["calendar"];
  readonly api = new OpeningHoursApi(request(() => this.model, this.writes));
  private releaseLinks?: () => void;
  override connectedCallback() {
    super.connectedCallback();
    this.releaseLinks = captureAppLinks(this, isDashboardPath);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.releaseLinks?.();
  }
  override render() {
    return html`<dashboard-opening-hours-screen
        .api=${this.api}
        .calendar=${this.calendar}
      ></dashboard-opening-hours-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("opening-hours-painter-test-app", PainterApp);

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-14T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) host.remove();
  history.replaceState(null, "", originalUrl);
});

async function mount(
  address: string,
  model = () => withBar(),
  writes: unknown[] = [],
  readOnly = false,
) {
  history.replaceState(null, "", address);
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(request(model, writes));
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => drawnView(el)).toBeDefined();
  await el.updateComplete;
  return el;
}
/** Mounts at `address`, or where the guard has already gone, keeping its history positions. */
async function mountApp(address?: string, calendar?: Screen["calendar"]) {
  if (address) history.replaceState(null, "", address);
  const app = document.createElement("opening-hours-painter-test-app") as PainterApp;
  app.calendar = calendar;
  applyTokens(app);
  hosts.push(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
  if (!calendar) await expect.poll(() => drawnView(el)).toBeDefined();
  return { app, el };
}
/** Records each pushed entry's path. Chromium caps a tab's history at 50 entries, and earlier
 *  files in a shard can reach it, so `history.length` cannot show a push. */
function pushedPaths() {
  const pushed = vi.spyOn(history, "pushState");
  return () => pushed.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname);
}
const painterOf = (el: Screen) => el.shadowRoot!.querySelector<SeasonPainter>("season-painter");
async function shownPainter(el: Screen) {
  await expect.poll(() => painterOf(el)?.shadowRoot?.querySelector("paint-grid")).toBeTruthy();
  const painter = painterOf(el)!;
  await settle(painter);
  return painter;
}
/** Which Opening hours view is drawn, known by its own heading. */
const drawnView = (el: Screen) =>
  el.shadowRoot!.querySelector("opening-hours-year")?.shadowRoot?.querySelector("[data-test=year]")
    ? "year"
    : el
          .shadowRoot!.querySelector("opening-hours-month")
          ?.shadowRoot?.querySelector("[data-test=month]")
      ? "month"
      : undefined;
async function cancel(painter: SeasonPainter) {
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await settle(painter);
}
async function choose(app: PainterApp, decision: "keep" | "discard") {
  await app.updateComplete;
  const question =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await expect.poll(() => question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}

describe("the season painter's address", () => {
  it("replaces Staffing steps and switches, then closes in Opening hours at the Staffing month", async () => {
    let host: CalendarViewHost | undefined;
    const march = "/opening-hours/view/month/month/2026-03";
    history.replaceState(null, "", march);
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      const { app: mountedApp, el } = await mountApp(undefined, {
        ctx: { request: request(withBar) },
        views: [
          {
            canWrite: true,
            view: {
              id: "staffing",
              order: 10,
              labelKey: "staffing",
              requiresPermission: "schedule.manage",
              create(_ctx, viewHost) {
                host = viewHost;
                return { render: () => html`<p>Staffing</p>` };
              },
            },
          },
        ],
      });
      app = mountedApp;
      await expect.poll(() => drawnView(el)).toBe("month");
      await guard.write(
        new URL(
          "/opening-hours/view/staffing/month/2026-12/painter/season/season/winter",
          location.href,
        ),
      );
      await expect.poll(() => host).toBeDefined();
      const pushed = vi.spyOn(history, "pushState");
      const replaced = vi.spyOn(history, "replaceState");
      const step = "/opening-hours/view/staffing/month/2026-12/painter/season/season/spring";
      const switchTo = "/opening-hours/view/season/season/spring/department/d1";
      host!.open(
        "staffing",
        { month: "2026-12", painter: "season", season: "spring" },
        { replace: true },
      );
      await expect.poll(() => location.pathname).toBe(step);
      host!.open("season", { season: "spring", department: "d1" }, { replace: true });
      await expect.poll(() => painterOf(el)?.seasonId).toBe("spring");
      expect(location.pathname).toBe(switchTo);
      expect(pushed).not.toHaveBeenCalled();
      expect(
        replaced.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname),
      ).toEqual([step, switchTo]);
      await cancel(await shownPainter(el));
      await expect.poll(() => location.pathname).toBe("/opening-hours/view/month/month/2026-12");
    } finally {
      guard.dispose();
    }
  });

  it("opens over the Year on a direct load, fed the screen's live model and api", async () => {
    const el = await mount("/opening-hours/view/season/season/spring/department/d1/zone/z2");
    const painter = await shownPainter(el);
    expect(painter.open).toBe(true);
    expect([painter.seasonId, painter.departmentId, painter.zoneId]).toEqual([
      "spring",
      "d1",
      "z2",
    ]);
    expect(painter.api).toBe(el.api);
    expect(painter.model.departments.map(({ id }) => id)).toEqual(["d1", "d2", "d3"]);
    expect(drawnView(el)).toBe("year");
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
    el.api.rereadWatches();
    await expect.poll(() => painterOf(el)!.model).not.toBe(painter.model);
  });

  it("takes the current season for an unknown one, the first active department for a missing one, and the department's own week for a zone it does not have", async () => {
    const el = await mount("/opening-hours/view/season/season/autumn");
    const painter = await shownPainter(el);
    expect([painter.seasonId, painter.departmentId, painter.zoneId]).toEqual(["winter", "d1", ""]);
    history.replaceState(
      null,
      "",
      "/opening-hours/view/season/season/spring/department/d2/zone/z1",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => painter.seasonId).toBe("spring");
    expect([painter.departmentId, painter.zoneId]).toEqual(["d1", "z1"]);
    history.replaceState(
      null,
      "",
      "/opening-hours/view/season/season/spring/department/d3/zone/z1",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => painter.departmentId).toBe("d3");
    expect(painter.zoneId).toBe("");
  });

  it("replaces the address as the painter moves, so Back leaves it", async () => {
    const el = await mount("/opening-hours/view/season/season/winter/department/d1");
    const painter = await shownPainter(el);
    const pushed = pushedPaths();
    painter.shadowRoot!.querySelector("[name=department]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "zone:z2" },
        bubbles: true,
        composed: true,
      }),
    );
    await expect
      .poll(() => location.pathname)
      .toBe("/opening-hours/view/season/season/winter/department/d1/zone/z2");
    painter.shadowRoot!.querySelector<HTMLElement>("[data-test=next-season]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/opening-hours/view/season/season/spring/department/d1/zone/z2");
    expect(pushed()).toEqual([]);
    expect(painterOf(el)).toBe(painter);
  });

  it("closes to the Year on a direct load", async () => {
    const el = await mount("/opening-hours/view/season/season/winter/department/d1");
    await cancel(await shownPainter(el));
    await expect.poll(() => location.pathname).toBe("/opening-hours/view/year");
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
  });
  it("closes a painter opened by Painted in to the Periods page", async () => {
    const el = await mount("/opening-hours/view/season/season/winter/department/d1?back=/periods");
    await cancel(await shownPainter(el));
    await expect.poll(() => location.pathname).toBe("/periods");
  });
});

describe("links into the painter", () => {
  async function chips(el: Screen) {
    const year = await expect
      .poll(() =>
        el
          .shadowRoot!.querySelector("opening-hours-year")
          ?.shadowRoot?.querySelector("season-chips")
          ?.shadowRoot?.querySelector("[data-season=spring]"),
      )
      .toBeTruthy()
      .then(() => el.shadowRoot!.querySelector("opening-hours-year")!);
    return year.shadowRoot!.querySelector("season-chips")!;
  }

  it("a season chip's body opens that season's week over the Year, and closing returns to that year", async () => {
    const el = await mount("/opening-hours/view/year/year/2027");
    const seasonChips = await chips(el);
    const pushed = pushedPaths();
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
      .click();
    await expect
      .poll(() => location.pathname)
      .toBe("/opening-hours/view/season/season/spring/department/d1");
    expect(pushed()).toEqual(["/opening-hours/view/season/season/spring/department/d1"]);
    const painter = await shownPainter(el);
    expect(painter.seasonId).toBe("spring");
    expect(el.shadowRoot!.querySelector("opening-hours-year")!.year).toBe(2027);
    expect(el.shadowRoot!.querySelector("[data-window=seasons]")).toBeNull();
    await cancel(painter);
    await expect.poll(() => location.pathname).toBe("/opening-hours/view/year/year/2027");
    await expect.poll(() => painterOf(el)).toBeNull();
  });

  it("closing a painter opened in the app goes back, so the first Back after it leaves the year", async () => {
    history.replaceState(null, "", "/before");
    history.pushState(null, "", "/opening-hours/view/year/year/2027");
    const el = await mount("/opening-hours/view/year/year/2027");
    const seasonChips = await chips(el);
    const pushed = pushedPaths();
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
      .click();
    await cancel(await shownPainter(el));
    await expect.poll(() => location.pathname).toBe("/opening-hours/view/year/year/2027");
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(pushed()).toEqual(["/opening-hours/view/season/season/spring/department/d1"]);
    history.back();
    await expect.poll(() => location.pathname).toBe("/before");
  });

  it("with the app's guard, closing a painter a chip opened goes back too", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/year/year/2027");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const pushed = pushedPaths();
      (await chips(el))
        .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
        .click();
      await cancel(await shownPainter(el));
      await expect.poll(() => painterOf(el)).toBeNull();
      expect(location.pathname).toBe("/opening-hours/view/year/year/2027");
      expect(pushed()).toEqual(["/opening-hours/view/season/season/spring/department/d1"]);
      history.back();
      await expect.poll(() => location.pathname).toBe("/before");
    } finally {
      guard.dispose();
    }
  });

  it("closing a painter reached by Back to an address naming a department replaces it with the view it drew over", async () => {
    history.replaceState(null, "", "/before");
    history.pushState(null, "", "/opening-hours/department/d1");
    history.pushState(null, "", "/opening-hours/view/year");
    const el = await mount("/opening-hours/view/year");
    history.back();
    await expect
      .poll(() => location.pathname)
      .toBe("/opening-hours/view/season/season/winter/department/d1");
    await cancel(await shownPainter(el));
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(location.pathname).toBe("/opening-hours/view/year");
  });

  it.each([
    ["a department", "/opening-hours/view/old/department/d3", "winter/department/d3"],
    [
      "a zone and a season",
      "/opening-hours/view/old/department/d1/zone/z1/season/spring",
      "spring/department/d1/zone/z1",
    ],
    ["no view and a department", "/opening-hours/department/d1", "winter/department/d1"],
  ])("an address naming %s opens the painter in its place", async (_, address, painted) => {
    history.replaceState(null, "", "/before");
    history.pushState(null, "", "/before-hours");
    const pushed = pushedPaths();
    const el = await mount(address);
    await expect.poll(() => location.pathname).toBe(`/opening-hours/view/season/season/${painted}`);
    expect(pushed()).toEqual([]);
    await shownPainter(el);
    expect(drawnView(el)).toBe("year");
  });

  it.each([["a station's query", "/opening-hours?view=week&station=s1"]])(
    "an old Week address naming %s opens the painter in its place",
    async (_, address) => {
      history.replaceState(null, "", "/before");
      const pushed = pushedPaths();
      const el = await mount(address);
      await expect
        .poll(() => location.pathname)
        .toBe("/opening-hours/view/season/season/winter/department/d1");
      expect(new URLSearchParams(location.search).has("station")).toBe(false);
      expect(pushed()).toEqual([]);
      await shownPainter(el);
      expect(drawnView(el)).toBe("year");
    },
  );

  it("a season chip asking for a week while the painter is open changes nothing", async () => {
    const el = await mount("/opening-hours/view/year/year/2027");
    const seasonChips = await chips(el);
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
      .click();
    const painter = await shownPainter(el);
    const pushed = pushedPaths();
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=winter] [data-test=season-week]")!
      .click();
    await settle(painter);
    expect(location.pathname).toBe("/opening-hours/view/season/season/spring/department/d1");
    expect(pushed()).toEqual([]);
    expect(painterOf(el)).toBe(painter);
    expect(painter.seasonId).toBe("spring");
  });

  it("a painter address on a venue with no active department names no department and draws nothing", async () => {
    const el = await mount("/opening-hours/view/season/season/winter/department/d1", () => {
      const model = withBar();
      return {
        ...model,
        departments: model.departments.map((department) => ({ ...department, active: false })),
      };
    });
    await expect.poll(() => painterOf(el)).not.toBeNull();
    const painter = painterOf(el)!;
    await painter.updateComplete;
    expect([painter.seasonId, painter.departmentId, painter.zoneId]).toEqual(["winter", "", ""]);
    expect(painter.shadowRoot!.querySelector("painter-frame")).toBeNull();
  });
});

describe("Save closes the season painter", () => {
  const saveButton = (painter: SeasonPainter) =>
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!;
  async function openFromChip(el: Screen) {
    const chip = await expect
      .poll(() =>
        el
          .shadowRoot!.querySelector("opening-hours-year")
          ?.shadowRoot?.querySelector("season-chips")
          ?.shadowRoot?.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]"),
      )
      .toBeTruthy()
      .then(() =>
        el
          .shadowRoot!.querySelector("opening-hours-year")!
          .shadowRoot!.querySelector("season-chips")!
          .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!,
      );
    chip.click();
    return shownPainter(el);
  }

  it("Save closes the painter and returns to the view it opened over", async () => {
    const writes: unknown[] = [];
    const el = await mount("/opening-hours/view/year/year/2027", () => withBar(), writes);
    const painter = await openFromChip(el);
    const back = vi.spyOn(history, "back");
    await drag(painter, "3", 7 * 60, 9 * 60);
    saveButton(painter).click();
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(writes.filter((write) => (write as unknown[])[1] === "PUT")).toHaveLength(1);
    expect(back).toHaveBeenCalledTimes(1);
    await expect.poll(() => location.pathname).toBe("/opening-hours/view/year/year/2027");
    expect(drawnView(el)).toBe("year");
    expect(el.shadowRoot!.querySelector("opening-hours-year")!.year).toBe(2027);
  });

  it("with the app's guard, Save closes the painter a chip opened without asking", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    let sampler: ReturnType<typeof setInterval> | undefined;
    try {
      await guard.write("/opening-hours/view/year/year/2027");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const question =
        app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
          "wt-unsaved-changes",
        )!;
      const asked: boolean[] = [];
      sampler = setInterval(() => asked.push(question.open), 5);
      const painter = await openFromChip(el);
      await drag(painter, "3", 7 * 60, 9 * 60);
      saveButton(painter).click();
      await expect.poll(() => painterOf(el)).toBeNull();
      await expect.poll(() => location.pathname).toBe("/opening-hours/view/year/year/2027");
      await new Promise((resolve) => setTimeout(resolve, 50));
      clearInterval(sampler);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.includes(true)).toBe(false);
      expect(question.open).toBe(false);
      expect(app.writes.filter((write) => (write as unknown[])[1] === "PUT")).toHaveLength(1);
      history.back();
      await expect.poll(() => location.pathname).toBe("/before");
    } finally {
      clearInterval(sampler);
      guard.dispose();
    }
  });

  it("a save left in flight when Back moved to another season leaves the newer painter open", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/season/season/winter/department/d1");
      await guard.write("/opening-hours/view/season/season/spring/department/d1");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const painter = await shownPainter(el);
      await expect.poll(() => painter.seasonId).toBe("spring");
      let succeed!: () => void;
      const save = vi.spyOn(app.api, "saveSeasonWeeks").mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            succeed = resolve;
          }),
      );
      const saved = vi.fn();
      painter.addEventListener("season-week-saved", saved);
      await drag(painter, "3", 7 * 60, 9 * 60);
      saveButton(painter).click();
      await expect.poll(() => save.mock.calls.length).toBe(1);
      history.back();
      await choose(app, "discard");
      await expect.poll(() => painter.seasonId).toBe("winter");
      const back = vi.spyOn(history, "back");
      succeed();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(painter);
      expect(painterOf(el)).toBe(painter);
      expect(painter.seasonId).toBe("winter");
      expect(back).not.toHaveBeenCalled();
      expect(location.pathname).toBe("/opening-hours/view/season/season/winter/department/d1");
      expect(frame(painter).dirty).toBe(false);
      expect(saved).not.toHaveBeenCalled();
    } finally {
      guard.dispose();
    }
  });

  it("Save on a painter loaded directly closes onto the Year by replacement", async () => {
    const el = await mount("/opening-hours/view/season/season/winter/department/d1");
    const painter = await shownPainter(el);
    const pushed = pushedPaths();
    const replaced = vi.spyOn(history, "replaceState");
    const back = vi.spyOn(history, "back");
    await drag(painter, "3", 7 * 60, 9 * 60);
    saveButton(painter).click();
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(location.pathname).toBe("/opening-hours/view/year");
    expect(
      replaced.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname),
    ).toContain("/opening-hours/view/year");
    expect(pushed()).toEqual([]);
    expect(back).not.toHaveBeenCalled();
    expect(drawnView(el)).toBe("year");
  });

  it("a refused Save keeps the painter open with its message beside Save", async () => {
    const el = await mount("/opening-hours/view/year/year/2027");
    const painter = await openFromChip(el);
    vi.spyOn(el.api, "saveSeasonWeeks").mockRejectedValueOnce({
      code: "season.not_found",
      params: { seasonId: "spring" },
    });
    const back = vi.spyOn(history, "back");
    await drag(painter, "3", 7 * 60, 9 * 60);
    saveButton(painter).click();
    await expect.poll(() => frame(painter).refusal).toBe("This could not be saved. Try again.");
    await expect.poll(() => frame(painter).busy).toBe(false);
    await settle(painter);
    expect(painterOf(el)).toBe(painter);
    expect(frame(painter).dirty).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/opening-hours/view/season/season/spring/department/d1");
  });

  it("a paint made while the save is in flight keeps the painter open, unsaved", async () => {
    const el = await mount("/opening-hours/view/year/year/2027");
    const painter = await openFromChip(el);
    let succeed!: () => void;
    const save = vi.spyOn(el.api, "saveSeasonWeeks").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          succeed = resolve;
        }),
    );
    const back = vi.spyOn(history, "back");
    await drag(painter, "3", 7 * 60, 9 * 60);
    saveButton(painter).click();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    await drag(painter, "4", 7 * 60, 9 * 60);
    succeed();
    await expect.poll(() => frame(painter).busy).toBe(false);
    await settle(painter);
    expect(painterOf(el)).toBe(painter);
    expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
    expect(frame(painter).dirty).toBe(true);
    expect(grid(painter).days.get("4")).toEqual([
      { periodId: "p1", startsAt: "13:00", endsAt: "15:00" },
    ]);
    expect(back).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/opening-hours/view/season/season/spring/department/d1");
  });
});

describe("leaving a painter with edits", () => {
  it("Back to another season goes through the leave question, keeping the draft on keep", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/season/season/spring/department/d1");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      await shownPainter(el);
      await guard.write("/opening-hours/view/season/season/winter/department/d1");
      const painter = await shownPainter(el);
      await expect.poll(() => painter.seasonId).toBe("winter");
      await drag(painter, "3", 120, 240);
      const painted = () => painter.edited();
      expect(painted()).toEqual({ departments: ["d1"], zones: [] });
      history.back();
      await choose(app, "keep");
      await expect
        .poll(() => location.pathname)
        .toBe("/opening-hours/view/season/season/winter/department/d1");
      expect(painter.seasonId).toBe("winter");
      expect(painted()).toEqual({ departments: ["d1"], zones: [] });
      history.back();
      await choose(app, "discard");
      await expect.poll(() => painter.seasonId).toBe("spring");
      expect(location.pathname).toBe("/opening-hours/view/season/season/spring/department/d1");
      expect(painted()).toEqual({ departments: [], zones: [] });
    } finally {
      guard.dispose();
    }
  });

  it("switching department with edits rewrites the address without asking and keeps the draft", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/season/season/winter/department/d1");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const painter = await shownPainter(el);
      await drag(painter, "3", 120, 240);
      painter
        .shadowRoot!.querySelector("[name=department]")!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "d3" }, bubbles: true, composed: true }),
        );
      await expect
        .poll(() => location.pathname)
        .toBe("/opening-hours/view/season/season/winter/department/d3");
      expect(new URL(guard.href).pathname).toBe(location.pathname);
      await app.updateComplete;
      expect(
        app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
          "wt-unsaved-changes",
        )!.open,
      ).toBe(false);
      expect(painter.departmentId).toBe("d3");
      expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
    } finally {
      guard.dispose();
    }
  });

  it.each([
    ["after painting", true],
    ["before painting (control)", false],
  ])("a department switch %s keeps the Year behind the painter for Back", async (_, paintFirst) => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/year");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      await guard.write("/opening-hours/view/season/season/winter/department/d1");
      const painter = await shownPainter(el);
      const switchTo = async (departmentId: string) => {
        painter.shadowRoot!.querySelector("[name=department]")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: departmentId },
            bubbles: true,
            composed: true,
          }),
        );
        await expect
          .poll(() => location.pathname)
          .toBe(`/opening-hours/view/season/season/winter/department/${departmentId}`);
      };
      if (paintFirst) await drag(painter, "3", 120, 240);
      await switchTo("d3");
      if (!paintFirst) await drag(painter, "3", 120, 240);
      expect(painter.edited().departments.length).toBe(1);
      history.back();
      await choose(app, "keep");
      expect(location.pathname).toBe("/opening-hours/view/season/season/winter/department/d3");
      history.back();
      await choose(app, "discard");
      await expect.poll(() => location.pathname).toBe("/opening-hours/view/year");
      await expect.poll(() => painterOf(el)).toBeNull();
    } finally {
      guard.dispose();
    }
  });

  it.each([
    ["season", "Winter", "/opening-hours/view/season/season/spring/department/d1"],
    ["department", "Restaurant", "/opening-hours/view/season/season/winter/department/d3"],
  ])(
    "removing the %s being painted drops its painting, says so, and moves the address",
    async (kind, name, address) => {
      let model = withBar();
      const el = await mount("/opening-hours/view/season/season/winter/department/d1", () => model);
      const painter = await shownPainter(el);
      await drag(painter, "3", 7 * 60, 9 * 60);
      expect(painter.edited().departments).toEqual(["d1"]);
      model =
        kind === "season"
          ? {
              ...withBar(),
              seasons: withBar().seasons.filter(({ id }) => id !== "winter"),
              currentSeasonId: "spring",
            }
          : { ...withBar(), departments: withBar().departments.filter(({ id }) => id !== "d1") };
      el.api.rereadWatches();
      await expect.poll(() => painter.model).toBe(painterOf(el)!.model);
      await expect.poll(() => location.pathname).toBe(address);
      await settle(painter);
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual({ departments: [], zones: [] });
      expect(frame(painter).refusal).toBe(`${name} was removed; its changes were dropped.`);
    },
  );

  it("with the app's guard, removing the season being painted moves the address without asking", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/season/season/winter/department/d1");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const painter = await shownPainter(el);
      await drag(painter, "3", 7 * 60, 9 * 60);
      app.model = {
        ...app.model,
        seasons: app.model.seasons.filter(({ id }) => id !== "winter"),
        currentSeasonId: "spring",
      };
      app.api.rereadWatches();
      await expect
        .poll(() => location.pathname)
        .toBe("/opening-hours/view/season/season/spring/department/d1");
      expect(new URL(guard.href).pathname).toBe(location.pathname);
      await settle(painter);
      expect(painter.seasonId).toBe("spring");
      expect(painter.edited()).toEqual({ departments: [], zones: [] });
      expect(frame(painter).refusal).toBe("Winter was removed; its changes were dropped.");
      await app.updateComplete;
      expect(
        app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
          "wt-unsaved-changes",
        )!.open,
      ).toBe(false);
    } finally {
      guard.dispose();
    }
  });

  it("stepping to the next season with edits asks first, keeping the season and address on keep", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/season/season/winter/department/d1");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const painter = await shownPainter(el);
      await drag(painter, "3", 7 * 60, 9 * 60);
      const next = () =>
        painter.shadowRoot!.querySelector<HTMLElement>("[data-test=next-season]")!.click();
      next();
      await choose(app, "keep");
      await settle(painter);
      expect(painter.seasonId).toBe("winter");
      expect(painter.edited().departments).toEqual(["d1"]);
      expect(location.pathname).toBe("/opening-hours/view/season/season/winter/department/d1");
      next();
      await choose(app, "discard");
      await expect
        .poll(() => location.pathname)
        .toBe("/opening-hours/view/season/season/spring/department/d1");
      await settle(painter);
      expect(painter.seasonId).toBe("spring");
      expect(painter.edited()).toEqual({ departments: [], zones: [] });
      expect(frame(painter).refusal).toBe("");
    } finally {
      guard.dispose();
    }
  });

  it("Close with edits asks once, then goes back to the view the painter opened over", async () => {
    history.replaceState(null, "", "/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/opening-hours/view/year");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      await guard.write("/opening-hours/view/season/season/winter/department/d1");
      const pushed = pushedPaths();
      const painter = await shownPainter(el);
      await drag(painter, "3", 120, 240);
      frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
      await choose(app, "discard");
      await expect.poll(() => location.pathname).toBe("/opening-hours/view/year");
      await expect.poll(() => painterOf(el)).toBeNull();
      await app.updateComplete;
      expect(
        app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
          "wt-unsaved-changes",
        )!.open,
      ).toBe(false);
      expect(pushed()).toEqual([]);
      expect(app.writes).toEqual([]);
    } finally {
      guard.dispose();
    }
  });
});

describe("a viewer's painter", () => {
  it("a read-only season chip's name opens that season's read-only week, with no ✎", async () => {
    const el = await mount("/opening-hours/view/year/year/2027", undefined, [], true);
    const seasonChips = await expect
      .poll(() =>
        el
          .shadowRoot!.querySelector("opening-hours-year")
          ?.shadowRoot?.querySelector("season-chips")
          ?.shadowRoot?.querySelector("[data-season=spring]"),
      )
      .toBeTruthy()
      .then(() =>
        el
          .shadowRoot!.querySelector("opening-hours-year")!
          .shadowRoot!.querySelector("season-chips")!,
      );
    expect(seasonChips.shadowRoot!.querySelector("[data-test=season-edit]")).toBeNull();
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
      .click();
    await expect
      .poll(() => location.pathname)
      .toBe("/opening-hours/view/season/season/spring/department/d1");
    const painter = await shownPainter(el);
    expect(painter.seasonId).toBe("spring");
    expect(painter.readOnly).toBe(true);
    expect(frame(painter).shadowRoot!.querySelector("[data-test=save]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-window=seasons]")).toBeNull();
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
    await expect.poll(() => location.pathname).toBe("/opening-hours/view/year/year/2027");
    await expect.poll(() => painterOf(el)).toBeNull();
  });

  it("a department address with no view opens a painter with no Save, whose drag changes and sends nothing", async () => {
    const writes: unknown[] = [];
    const el = await mount("/opening-hours/department/d1", undefined, writes, true);
    await expect
      .poll(() => location.pathname)
      .toBe("/opening-hours/view/season/season/winter/department/d1");
    const painter = await shownPainter(el);
    expect(painter.readOnly).toBe(true);
    expect(frame(painter).shadowRoot!.querySelector("[data-test=save]")).toBeNull();
    expect(painter.shadowRoot!.querySelector("[data-test=hint]")).toBeNull();
    await drag(painter, "3", 120, 240);
    expect(painter.edited()).toEqual({ departments: [], zones: [] });
    await settle(painter);
    expect(writes).toEqual([]);
  });
});

it("a same-path station query still resolves the old address after the Calendar has loaded", async () => {
  const el = await mount("/opening-hours");
  history.pushState(null, "", "/opening-hours?station=s1");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => painterOf(el)?.seasonId).toBe("winter");
  expect(location.pathname).toBe("/opening-hours/view/season/season/winter/department/d1");
});

class AddingApp extends PainterApp {
  override readonly api = new OpeningHoursApi((async (
    path: string,
    method: string,
    body: unknown,
  ) => {
    if (method === "POST" && path.endsWith("/departments/d1/menu-periods")) {
      this.writes.push([path, method, body]);
      const restaurant = this.model.departments[0]!;
      this.model = {
        ...this.model,
        departments: [
          {
            ...restaurant,
            periods: [
              ...restaurant.periods,
              { ...restaurant.periods[0]!, id: "p-new", name: "Brunch", colour: "blue" },
            ],
          },
          ...this.model.departments.slice(1),
        ],
      };
      return { id: "p-new" };
    }
    return request(() => this.model, this.writes)(path, method, body);
  }) as DashboardRequest);
}
customElements.define("opening-hours-adding-test-app", AddingApp);

/** Deleting p1 takes it out of the periods and out of every saved week, as the server does. */
class DeletingApp extends PainterApp {
  override readonly api = new OpeningHoursApi((async (
    path: string,
    method: string,
    body: unknown,
  ) => {
    if (method === "GET" && path.split("?")[0]!.endsWith("/menu-periods/p1/delete-impact"))
      return {
        seasons: 1,
        specialDays: 0,
        routingUses: [],
        replacements: [],
        clockRevision: 4,
      };
    if (method === "POST" && path.endsWith("/menu-periods/p1/delete")) {
      this.writes.push([path, method, body]);
      const next = structuredClone(this.model);
      const restaurant = next.departments[0]!;
      restaurant.periods = restaurant.periods.filter(({ id }) => id !== "p1");
      for (const season of restaurant.seasonWeeks)
        for (const day of season.week)
          day.slots = day.slots.filter(({ periodId }) => periodId !== "p1");
      this.model = next;
      return {};
    }
    return request(() => this.model, this.writes)(path, method, body);
  }) as DashboardRequest);
}
customElements.define("opening-hours-deleting-test-app", DeletingApp);

/** Deleting p1 with Dinner (p2) as its replacement moves p1's saved slots to p2, as the server
 *  does. */
class ReplacingApp extends PainterApp {
  override readonly api = new OpeningHoursApi((async (
    path: string,
    method: string,
    body: unknown,
  ) => {
    if (method === "GET" && path.split("?")[0]!.endsWith("/menu-periods/p1/delete-impact"))
      return {
        seasons: 1,
        specialDays: 0,
        routingUses: [],
        replacements: [{ id: "p2", name: "Dinner" }],
        clockRevision: 4,
      };
    if (method === "POST" && path.endsWith("/menu-periods/p1/delete")) {
      this.writes.push([path, method, body]);
      const replacement = (body as { replacementPeriodId: string | null }).replacementPeriodId;
      const next = structuredClone(this.model);
      const restaurant = next.departments[0]!;
      restaurant.periods = restaurant.periods.filter(({ id }) => id !== "p1");
      for (const season of restaurant.seasonWeeks)
        for (const day of season.week)
          day.slots = day.slots.flatMap((slot) =>
            slot.periodId !== "p1"
              ? [slot]
              : replacement === null
                ? []
                : [{ ...slot, periodId: replacement }],
          );
      this.model = next;
      return {};
    }
    return request(() => this.model, this.writes)(path, method, body);
  }) as DashboardRequest);
}
customElements.define("opening-hours-replacing-test-app", ReplacingApp);

describe("period updates while painting", () => {
  const base = "/opening-hours/view/season/season/winter/department/d1";

  it("a newly stored period reaches the painter without losing its draft", async () => {
    history.replaceState(null, "", base);
    const app = document.createElement("opening-hours-adding-test-app") as AddingApp;
    applyTokens(app);
    hosts.push(app);
    document.body.append(app);
    await app.updateComplete;
    const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
    await expect.poll(() => drawnView(el)).toBeDefined();
    const painter = await shownPainter(el);
    await drag(painter, "3", 120, 240);
    const before = painter.edited();
    expect(before).toEqual({ departments: ["d1"], zones: [] });
    expect(painter.shadowRoot!.querySelector('[data-test="paint-p-new"]')).toBeNull();
    await app.api.createPeriod("d1", {
      name: "Brunch",
      menuId: "m1",
      colour: "blue",
      staffMenuIds: [],
    });
    app.api.rereadWatches();
    expect(painterOf(el)).toBe(painter);
    await expect
      .poll(() => painter.shadowRoot!.querySelector('[data-test="paint-p-new"]'))
      .not.toBeNull();
    expect(painter.shadowRoot!.querySelector('[data-test="paint-p-new"]')!.textContent).toContain(
      "Brunch",
    );
    expect(painter.edited()).toEqual(before);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    expect(app.writes).toHaveLength(1);
  });

  it("a deleted period leaves the painter's remaining draft, and Save sends only the other edits", async () => {
    history.replaceState(null, "", base);
    const app = document.createElement("opening-hours-deleting-test-app") as DeletingApp;
    applyTokens(app);
    hosts.push(app);
    document.body.append(app);
    await app.updateComplete;
    const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
    await expect.poll(() => drawnView(el)).toBeDefined();
    const painter = await shownPainter(el);
    const blocks = (column: string) =>
      grid(painter).shadowRoot!.querySelectorAll(`.day[data-column="${column}"] .block`).length;
    painter.shadowRoot!.querySelector<HTMLElement>('[data-test="paint-p2"]')!.click();
    await settle(painter);
    await drag(painter, "4", 120, 240);
    painter.shadowRoot!.querySelector<HTMLElement>('[data-test="paint-p1"]')!.click();
    await settle(painter);
    await drag(painter, "3", 120, 240);
    expect(grid(painter).days.get("3")).toEqual([
      { periodId: "p1", startsAt: "08:00", endsAt: "10:00" },
    ]);
    expect(blocks("3")).toBe(1);
    await app.api.deletePeriod("p1", null, 4);
    app.api.rereadWatches();
    expect(painterOf(el)).toBe(painter);
    await expect.poll(() => painter.shadowRoot!.querySelector('[data-test="paint-p1"]')).toBeNull();
    await settle(painter);
    expect(grid(painter).days.get("3")).toEqual([]);
    expect(blocks("3")).toBe(0);
    expect(grid(painter).days.get("4")).toEqual([
      { periodId: "p2", startsAt: "08:00", endsAt: "10:00" },
    ]);
    expect(blocks("4")).toBe(1);
    expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect
      .poll(() => app.writes.filter((write) => (write as unknown[])[1] === "PUT"))
      .toHaveLength(1);
    const [, , sent] = app.writes.find((write) => (write as unknown[])[1] === "PUT") as [
      string,
      string,
      { departments: { departmentId: string; days: { weekday: number; slots: unknown[] }[] }[] },
    ];
    expect(sent.departments).toEqual([
      {
        departmentId: "d1",
        days: [{ weekday: 4, slots: [{ periodId: "p2", startsAt: "08:00", endsAt: "10:00" }] }],
      },
    ]);
  });

  async function saveAfterReplacingLunch(weekday: string, pot = "p2", from = 120, to = 240) {
    history.replaceState(null, "", base);
    const app = document.createElement("opening-hours-replacing-test-app") as ReplacingApp;
    applyTokens(app);
    hosts.push(app);
    document.body.append(app);
    await app.updateComplete;
    const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
    await expect.poll(() => drawnView(el)).toBeDefined();
    const painter = await shownPainter(el);
    painter.shadowRoot!.querySelector<HTMLElement>(`[data-test="paint-${pot}"]`)!.click();
    await settle(painter);
    await drag(painter, weekday, from, to);
    await app.api.deletePeriod("p1", "p2", 4);
    app.api.rereadWatches();
    expect(app.writes).toContainEqual([
      "/management-api/venue-service/menu-periods/p1/delete",
      "POST",
      expect.objectContaining({ replacementPeriodId: "p2" }),
    ]);
    await expect.poll(() => painter.shadowRoot!.querySelector('[data-test="paint-p1"]')).toBeNull();
    await settle(painter);
    const shown = (key: string) => grid(painter).days.get(key);
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect
      .poll(() => app.writes.filter((write) => (write as unknown[])[1] === "PUT"))
      .toHaveLength(1);
    const [, , sent] = app.writes.find((write) => (write as unknown[])[1] === "PUT") as [
      string,
      string,
      { departments: { departmentId: string; days: { weekday: number; slots: unknown[] }[] }[] },
    ];
    return { shown, sent: sent.departments };
  }
  const dinner = (startsAt: string, endsAt: string) => ({ periodId: "p2", startsAt, endsAt });

  it("a period deleted with a replacement keeps the replacement's saved block on a day the draft changed, beside the painted one", async () => {
    const { shown, sent } = await saveAfterReplacingLunch("1");
    expect(shown("1")).toEqual([dinner("08:00", "10:00"), dinner("13:00", "16:00")]);
    expect(sent).toEqual([
      {
        departmentId: "d1",
        days: [{ weekday: 1, slots: [dinner("08:00", "10:00"), dinner("13:00", "16:00")] }],
      },
    ]);
  });

  it("a period deleted with a replacement fills both ends of a saved block the draft split", async () => {
    const { shown, sent } = await saveAfterReplacingLunch("1", "closed", 480, 540);
    expect(shown("1")).toEqual([dinner("13:00", "14:00"), dinner("15:00", "16:00")]);
    expect(sent).toEqual([
      {
        departmentId: "d1",
        days: [{ weekday: 1, slots: [dinner("13:00", "14:00"), dinner("15:00", "16:00")] }],
      },
    ]);
  });

  it("a period deleted with a replacement keeps the replacement's saved block on a day the draft did not change", async () => {
    const { shown, sent } = await saveAfterReplacingLunch("4");
    expect(shown("1")).toEqual([dinner("13:00", "16:00")]);
    expect(sent).toEqual([
      {
        departmentId: "d1",
        days: [{ weekday: 4, slots: [dinner("08:00", "10:00")] }],
      },
    ]);
  });
});
