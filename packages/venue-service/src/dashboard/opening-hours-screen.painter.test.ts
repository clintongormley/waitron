import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, NavigationGuard } from "@waitron/ui";
import { userEvent } from "vitest/browser";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursYear } from "../opening-hours-calendar.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SeasonPainter } from "./season-painter.js";
import { drag, frame, settle, withBar } from "../testing/season-painter-fixture.js";
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
      { id: "spring", name: "Spring", startsOn: "03-01", lastDay: "11-30" },
      { id: "winter", name: "Winter", startsOn: "12-01", lastDay: "02-28" },
    ],
    days: [],
    publicHolidaysAvailable: true,
    missingHolidays: [],
    holidayCoverage: [],
    area: { addressKey: "a", readiness: "ready", options: [], required: false, chosen: null },
  };
}
const stations = [{ id: "s1", name: "Upstairs bar", active: true }];
function request(model: () => OpeningHoursModel, writes: unknown[] = []): DashboardRequest {
  return (async (path: string, method: string, body: unknown) => {
    if (method !== "GET") {
      writes.push([path, method, body]);
      return {};
    }
    if (path === "/management-api/stations") return stations;
    const year = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (year) return yearRead(Number(year[1]));
    if (path.endsWith("/special-days")) return [];
    if (path.endsWith("/menu-periods/painted-in")) return [];
    if (path.includes("/service-times?"))
      return {
        always: null,
        days: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-12-${14 + index}`,
          departments: [],
        })),
      };
    if (path.includes("/named-days?")) return { days: [], stations: [], departments: [] };
    return model();
  }) as DashboardRequest;
}

class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly writes: unknown[] = [];
  model = withBar();
  readonly api = new OpeningHoursApi(request(() => this.model, this.writes));
  override render() {
    return html`<dashboard-opening-hours-screen .api=${this.api}></dashboard-opening-hours-screen
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
async function mountApp(address?: string) {
  if (address) history.replaceState(null, "", address);
  const app = document.createElement("opening-hours-painter-test-app") as PainterApp;
  applyTokens(app);
  hosts.push(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
  await expect.poll(() => drawnView(el)).toBeDefined();
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
  it("opens over the Year on a direct load, fed the screen's live model and api", async () => {
    const el = await mount("/manage/opening-hours/view/season/season/spring/department/d1/zone/z2");
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
    const el = await mount("/manage/opening-hours/view/season/season/autumn");
    const painter = await shownPainter(el);
    expect([painter.seasonId, painter.departmentId, painter.zoneId]).toEqual(["winter", "d1", ""]);
    history.replaceState(
      null,
      "",
      "/manage/opening-hours/view/season/season/spring/department/d2/zone/z1",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => painter.seasonId).toBe("spring");
    expect([painter.departmentId, painter.zoneId]).toEqual(["d1", "z1"]);
    history.replaceState(
      null,
      "",
      "/manage/opening-hours/view/season/season/spring/department/d3/zone/z1",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => painter.departmentId).toBe("d3");
    expect(painter.zoneId).toBe("");
  });

  it("replaces the address as the painter moves, so Back leaves it", async () => {
    const el = await mount("/manage/opening-hours/view/season/season/winter/department/d1");
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
      .toBe("/manage/opening-hours/view/season/season/winter/department/d1/zone/z2");
    painter.shadowRoot!.querySelector<HTMLElement>("[data-test=next-season]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/season/spring/department/d1/zone/z2");
    expect(pushed()).toEqual([]);
    expect(painterOf(el)).toBe(painter);
  });

  it("closes to the Year on a direct load", async () => {
    const el = await mount("/manage/opening-hours/view/season/season/winter/department/d1");
    await cancel(await shownPainter(el));
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
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
    const el = await mount("/manage/opening-hours/view/year/year/2027");
    const seasonChips = await chips(el);
    const pushed = pushedPaths();
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
      .click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/season/spring/department/d1");
    expect(pushed()).toEqual(["/manage/opening-hours/view/season/season/spring/department/d1"]);
    const painter = await shownPainter(el);
    expect(painter.seasonId).toBe("spring");
    expect(el.shadowRoot!.querySelector("opening-hours-year")!.year).toBe(2027);
    expect(seasonChips.shadowRoot!.querySelector("season-dialog")).toBeNull();
    await cancel(painter);
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    await expect.poll(() => painterOf(el)).toBeNull();
  });

  it("closing a painter opened in the app goes back, so the first Back after it leaves the year", async () => {
    history.replaceState(null, "", "/manage/before");
    history.pushState(null, "", "/manage/opening-hours/view/year/year/2027");
    const el = await mount("/manage/opening-hours/view/year/year/2027");
    const seasonChips = await chips(el);
    const pushed = pushedPaths();
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
      .click();
    await cancel(await shownPainter(el));
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(pushed()).toEqual(["/manage/opening-hours/view/season/season/spring/department/d1"]);
    history.back();
    await expect.poll(() => location.pathname).toBe("/manage/before");
  });

  it("with the app's guard, closing a painter a chip opened goes back too", async () => {
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/year/year/2027");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const pushed = pushedPaths();
      (await chips(el))
        .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
        .click();
      await cancel(await shownPainter(el));
      await expect.poll(() => painterOf(el)).toBeNull();
      expect(location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
      expect(pushed()).toEqual(["/manage/opening-hours/view/season/season/spring/department/d1"]);
      history.back();
      await expect.poll(() => location.pathname).toBe("/manage/before");
    } finally {
      guard.dispose();
    }
  });

  it("closing a painter reached by Back to an address naming a department replaces it with the view it drew over", async () => {
    history.replaceState(null, "", "/manage/before");
    history.pushState(null, "", "/manage/opening-hours/department/d1");
    history.pushState(null, "", "/manage/opening-hours/view/year");
    const el = await mount("/manage/opening-hours/view/year");
    history.back();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/season/winter/department/d1");
    await cancel(await shownPainter(el));
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/year");
  });

  it("closing a painter loaded directly, after its Periods link and Back, closes onto the Year view", async () => {
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/season/season/winter/department/d1");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      (await shownPainter(el))
        .shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!
        .click();
      await expect.poll(() => location.pathname).toBe("/manage/periods");
      history.back();
      await expect
        .poll(() => location.pathname)
        .toBe("/manage/opening-hours/view/season/season/winter/department/d1");
      await cancel(await shownPainter(el));
      await expect.poll(() => painterOf(el)).toBeNull();
      expect(location.pathname).toBe("/manage/opening-hours/view/year");
    } finally {
      guard.dispose();
    }
  });

  it("a season chip's ✎ still opens the season dialog and not the painter", async () => {
    const el = await mount("/manage/opening-hours/view/year/year/2027");
    const seasonChips = await chips(el);
    seasonChips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-edit]")!
      .click();
    await expect.poll(() => seasonChips.shadowRoot!.querySelector("season-dialog")).not.toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    expect(painterOf(el)).toBeNull();
  });

  it.each([
    ["a department", "/manage/opening-hours/view/old/department/d3", "winter/department/d3"],
    [
      "a zone and a season",
      "/manage/opening-hours/view/old/department/d1/zone/z1/season/spring",
      "spring/department/d1/zone/z1",
    ],
    ["no view and a department", "/manage/opening-hours/department/d1", "winter/department/d1"],
  ])("an address naming %s opens the painter in its place", async (_, address, painted) => {
    history.replaceState(null, "", "/manage/before");
    history.pushState(null, "", "/manage/before-hours");
    const pushed = pushedPaths();
    const el = await mount(address);
    await expect
      .poll(() => location.pathname)
      .toBe(`/manage/opening-hours/view/season/season/${painted}`);
    expect(pushed()).toEqual([]);
    await shownPainter(el);
    expect(drawnView(el)).toBe("year");
  });

  it.each([["a station's query", "/manage/opening-hours?view=week&station=s1"]])(
    "an old Week address naming %s opens the painter in its place",
    async (_, address) => {
      history.replaceState(null, "", "/manage/before");
      const pushed = pushedPaths();
      const el = await mount(address);
      await expect
        .poll(() => location.pathname)
        .toBe("/manage/opening-hours/view/season/season/winter/department/d1");
      expect(new URLSearchParams(location.search).has("station")).toBe(false);
      expect(pushed()).toEqual([]);
      await shownPainter(el);
      expect(drawnView(el)).toBe("year");
    },
  );

  it("a season chip asking for a week while the painter is open changes nothing", async () => {
    const el = await mount("/manage/opening-hours/view/year/year/2027");
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
    expect(location.pathname).toBe("/manage/opening-hours/view/season/season/spring/department/d1");
    expect(pushed()).toEqual([]);
    expect(painterOf(el)).toBe(painter);
    expect(painter.seasonId).toBe("spring");
  });

  it("a painter address on a venue with no active department names no department and draws nothing", async () => {
    const el = await mount("/manage/opening-hours/view/season/season/winter/department/d1", () => {
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

describe("leaving a painter with edits", () => {
  it("the Periods link asks first, staying on keep and reaching the Periods page on discard", async () => {
    const { app, el } = await mountApp(
      "/manage/opening-hours/view/season/season/winter/department/d1",
    );
    const painter = await shownPainter(el);
    await drag(painter, "3", 120, 240);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    const link = () =>
      painterOf(el)!.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!;
    link().click();
    await choose(app, "keep");
    expect(location.pathname).toBe("/manage/opening-hours/view/season/season/winter/department/d1");
    expect(painterOf(el)).toBe(painter);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    link().click();
    await choose(app, "discard");
    await expect.poll(() => location.pathname).toBe("/manage/periods");
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(painterOf(el)!.edited()).toEqual({ departments: [], zones: [] });
    expect(app.writes).toEqual([]);
  });

  it("Back to another season goes through the leave question, keeping the draft on keep", async () => {
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/season/season/spring/department/d1");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      await shownPainter(el);
      await guard.write("/manage/opening-hours/view/season/season/winter/department/d1");
      const painter = await shownPainter(el);
      await expect.poll(() => painter.seasonId).toBe("winter");
      await drag(painter, "3", 120, 240);
      const painted = () => painter.edited();
      expect(painted()).toEqual({ departments: ["d1"], zones: [] });
      history.back();
      await choose(app, "keep");
      await expect
        .poll(() => location.pathname)
        .toBe("/manage/opening-hours/view/season/season/winter/department/d1");
      expect(painter.seasonId).toBe("winter");
      expect(painted()).toEqual({ departments: ["d1"], zones: [] });
      history.back();
      await choose(app, "discard");
      await expect.poll(() => painter.seasonId).toBe("spring");
      expect(location.pathname).toBe(
        "/manage/opening-hours/view/season/season/spring/department/d1",
      );
      expect(painted()).toEqual({ departments: [], zones: [] });
    } finally {
      guard.dispose();
    }
  });

  it("switching department with edits rewrites the address without asking and keeps the draft", async () => {
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/season/season/winter/department/d1");
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
        .toBe("/manage/opening-hours/view/season/season/winter/department/d3");
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
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/year");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      await guard.write("/manage/opening-hours/view/season/season/winter/department/d1");
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
          .toBe(`/manage/opening-hours/view/season/season/winter/department/${departmentId}`);
      };
      if (paintFirst) await drag(painter, "3", 120, 240);
      await switchTo("d3");
      if (!paintFirst) await drag(painter, "3", 120, 240);
      expect(painter.edited().departments.length).toBe(1);
      history.back();
      await choose(app, "keep");
      expect(location.pathname).toBe(
        "/manage/opening-hours/view/season/season/winter/department/d3",
      );
      history.back();
      await choose(app, "discard");
      await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
      await expect.poll(() => painterOf(el)).toBeNull();
    } finally {
      guard.dispose();
    }
  });

  it.each([
    ["season", "Winter", "/manage/opening-hours/view/season/season/spring/department/d1"],
    ["department", "Restaurant", "/manage/opening-hours/view/season/season/winter/department/d3"],
  ])(
    "removing the %s being painted drops its painting, says so, and moves the address",
    async (kind, name, address) => {
      let model = withBar();
      const el = await mount(
        "/manage/opening-hours/view/season/season/winter/department/d1",
        () => model,
      );
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
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/season/season/winter/department/d1");
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
        .toBe("/manage/opening-hours/view/season/season/spring/department/d1");
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
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/season/season/winter/department/d1");
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
      expect(location.pathname).toBe(
        "/manage/opening-hours/view/season/season/winter/department/d1",
      );
      next();
      await choose(app, "discard");
      await expect
        .poll(() => location.pathname)
        .toBe("/manage/opening-hours/view/season/season/spring/department/d1");
      await settle(painter);
      expect(painter.seasonId).toBe("spring");
      expect(painter.edited()).toEqual({ departments: [], zones: [] });
      expect(frame(painter).refusal).toBe("");
    } finally {
      guard.dispose();
    }
  });

  it("Cancel with edits asks once, then goes back to the view the painter opened over", async () => {
    history.replaceState(null, "", "/manage/before");
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write("/manage/opening-hours/view/year");
      ({ app } = await mountApp());
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      await guard.write("/manage/opening-hours/view/season/season/winter/department/d1");
      const pushed = pushedPaths();
      const painter = await shownPainter(el);
      await drag(painter, "3", 120, 240);
      frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
      await choose(app, "discard");
      await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
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
    const el = await mount("/manage/opening-hours/view/year/year/2027", undefined, [], true);
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
      .toBe("/manage/opening-hours/view/season/season/spring/department/d1");
    const painter = await shownPainter(el);
    expect(painter.seasonId).toBe("spring");
    expect(painter.readOnly).toBe(true);
    expect(frame(painter).shadowRoot!.querySelector("[data-test=save]")).toBeNull();
    expect(seasonChips.shadowRoot!.querySelector("season-dialog")).toBeNull();
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    await expect.poll(() => painterOf(el)).toBeNull();
  });

  it("a department address with no view opens a painter with no Save, whose drag changes and sends nothing", async () => {
    const writes: unknown[] = [];
    const el = await mount("/manage/opening-hours/department/d1", undefined, writes, true);
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/season/winter/department/d1");
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

async function periodsWindow(el: Screen) {
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window][data-window=periods]"))
    .not.toBeNull();
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    "[data-test=calendar-window][data-window=periods]",
  )!;
  await modal.updateComplete;
  const list = modal.querySelector("periods-list")!;
  await expect.poll(() => list.shadowRoot?.querySelector("wt-data-table")).toBeTruthy();
  const table =
    list.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
  await expect.poll(() => table.shadowRoot?.textContent ?? "").toContain("Dinner");
  return { modal, list, table };
}
async function openPeriod(el: Screen) {
  const { list, table } = await periodsWindow(el);
  table
    .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="period:p1"] button.row-activate')!
    .click();
  await list.updateComplete;
  const dialog = list.shadowRoot!.querySelector("period-dialog")!;
  expect(dialog, "period dialog opens").not.toBeNull();
  await dialog.updateComplete;
  return { list, dialog };
}
function screenGuard(app: () => PainterApp | undefined) {
  return new NavigationGuard(window, {
    isDirty: () => app()?.leave.coordinator.isDirty() ?? false,
    request: (proceed, signal, destination) => {
      const screen = app()!.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      return app()!.leave.coordinator.request({
        scopes: screen.navigationScopes(new URL(destination)) ?? "all",
        reason: "navigation",
        proceed,
        signal,
      });
    },
  });
}

describe("the Calendar window address", () => {
  it("opens Seasons after loading and closes only its window pair", async () => {
    const el = await mount("/manage/opening-hours/view/year/year/2027/window/seasons");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]"))
      .not.toBeNull();
    const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
      "[data-test=calendar-window]",
    )!;
    await modal.updateComplete;
    const chips = modal.querySelector("season-chips")!;
    await expect.poll(() => chips.shadowRoot!.textContent).toContain("Spring");
    expect(modal.heading).toBe("Seasons");
    const close = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=close-calendar-window]",
    );
    expect(close).not.toBeNull();
    await close!.updateComplete;
    expect(
      close!.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
    ).toBeGreaterThan(0);
    close!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    expect(drawnView(el)).toBe("year");
  });
  it("offers weeks but no editing actions in a read-only Seasons window", async () => {
    const el = await mount(
      "/manage/opening-hours/view/year/window/seasons",
      undefined,
      undefined,
      true,
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window] season-chips"))
      .not.toBeNull();
    const chips = el.shadowRoot!.querySelector("[data-test=calendar-window] season-chips")!;
    await expect
      .poll(() => chips.shadowRoot!.querySelector("[data-test=season-week]"))
      .not.toBeNull();
    expect(chips.shadowRoot!.querySelector("[data-test=season-edit]")).toBeNull();
    expect(chips.shadowRoot!.querySelector("[data-test=add-season]")).toBeNull();
    chips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=spring] [data-test=season-week]")!
      .click();
    const painter = await shownPainter(el);
    expect(painter.seasonId).toBe("spring");
    expect(painter.readOnly).toBe(true);
    expect(location.pathname).not.toContain("/window/");
  });
  it("removes an unknown window by replacement without pushing an entry", async () => {
    const pushed = vi.spyOn(history, "pushState");
    const el = await mount("/manage/opening-hours/view/year/window/unknown");
    expect(location.pathname).toBe("/manage/opening-hours/view/year");
    expect(pushed).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
  });
  it("window-only Back and Forward retain the actual painter and its edited ranges", async () => {
    const base = "/manage/opening-hours/view/season/season/winter/department/d1";
    history.replaceState(null, "", base);
    let app!: PainterApp;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal, destination) => {
        const screen = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
        return app.leave.coordinator.request({
          scopes: screen.navigationScopes(new URL(destination)) ?? "all",
          reason: "navigation",
          proceed,
          signal,
        });
      },
    });
    try {
      const mounted = await mountApp();
      app = mounted.app;
      const el = mounted.el;
      const painter = await shownPainter(el);
      await drag(painter, "3", 120, 240);
      const before = painter.edited();
      expect(before).toEqual({ departments: ["d1"], zones: [] });
      await guard.write(`${base}/window/seasons`);
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]"))
        .not.toBeNull();
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual(before);
      history.back();
      await expect.poll(() => location.pathname).toBe(base);
      expect(painter.edited()).toEqual(before);
      history.forward();
      await expect.poll(() => location.pathname).toBe(`${base}/window/seasons`);
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual(before);
      expect(app.leave.coordinator.isDirty()).toBe(true);
    } finally {
      guard.dispose();
    }
  });
  it("opens Periods after loading and closes only its window pair", async () => {
    const el = await mount("/manage/opening-hours/view/year/year/2027/window/periods");
    const { modal, list, table } = await periodsWindow(el);
    expect(modal.getAttribute("aria-label")).toBe("Periods");
    expect(list.readOnly).toBe(false);
    expect(table.shadowRoot!.textContent).toContain("Lunch");
    expect(list.shadowRoot!.querySelector("[data-test=add-period]")).not.toBeNull();
    const close = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=close-calendar-window]",
    );
    expect(close).not.toBeNull();
    await close!.updateComplete;
    expect(
      close!.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
    ).toBeGreaterThan(0);
    close!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    expect(drawnView(el)).toBe("year");
    expect(el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
  });
  it("a viewer's Periods window lists periods with nothing to change", async () => {
    const el = await mount(
      "/manage/opening-hours/view/year/window/periods",
      undefined,
      undefined,
      true,
    );
    const { list, table } = await periodsWindow(el);
    expect(list.readOnly).toBe(true);
    expect(table.shadowRoot!.textContent).toContain("Lunch");
    expect(list.shadowRoot!.querySelector("[data-test=add-period]")).toBeNull();
    expect(table.shadowRoot!.querySelector("[data-test=delete-period]")).toBeNull();
    expect(list.shadowRoot!.querySelector("[data-test=delete-period]")).toBeNull();
    expect(table.shadowRoot!.querySelector("button.row-activate")).toBeNull();
  });
  it("a station address keeps its Periods window and drops the station query", async () => {
    const pushed = vi.spyOn(history, "pushState");
    const el = await mount("/manage/opening-hours/view/year/window/periods?station=s1");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/year/window/periods");
    expect(location.search).toBe("");
    expect(pushed).not.toHaveBeenCalled();
    await periodsWindow(el);
  });
  it("window-only Back and Forward retain the painter and its paint under Periods", async () => {
    const base = "/manage/opening-hours/view/season/season/winter/department/d1";
    history.replaceState(null, "", base);
    let app: PainterApp | undefined;
    const guard = screenGuard(() => app);
    try {
      const mounted = await mountApp();
      app = mounted.app;
      const el = mounted.el;
      const painter = await shownPainter(el);
      await drag(painter, "3", 120, 240);
      const before = painter.edited();
      expect(before).toEqual({ departments: ["d1"], zones: [] });
      await guard.write(`${base}/window/periods`);
      await periodsWindow(el);
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual(before);
      history.back();
      await expect.poll(() => location.pathname).toBe(base);
      expect(painter.edited()).toEqual(before);
      history.forward();
      await expect.poll(() => location.pathname).toBe(`${base}/window/periods`);
      await periodsWindow(el);
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual(before);
      expect(app.leave.coordinator.isDirty()).toBe(true);
    } finally {
      guard.dispose();
    }
  });
  it("closing the Periods window protects its period draft and keeps the painter's paint", async () => {
    const base = "/manage/opening-hours/view/season/season/winter/department/d1";
    history.replaceState(null, "", base);
    let app: PainterApp | undefined;
    const guard = screenGuard(() => app);
    try {
      const mounted = await mountApp();
      app = mounted.app;
      const el = mounted.el;
      const painter = await shownPainter(el);
      await drag(painter, "3", 120, 240);
      const before = painter.edited();
      await guard.write(`${base}/window/periods`);
      const { dialog } = await openPeriod(el);
      dialog.shadowRoot!.querySelector<HTMLElement>("[name=name]")!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Brunch" },
          bubbles: true,
          composed: true,
        }),
      );
      await dialog.updateComplete;
      const closing = guard.write(base);
      await choose(app, "keep");
      await closing;
      expect(location.pathname).toBe(`${base}/window/periods`);
      expect(
        dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
      ).toBe("Brunch");
      const discarding = guard.write(base);
      await choose(app, "discard");
      await discarding;
      expect(location.pathname).toBe(base);
      expect(el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual(before);
      expect(app.leave.coordinator.isDirty()).toBe(true);
    } finally {
      guard.dispose();
    }
  });
  it("Escape in the window's period dialog closes only the dialog", async () => {
    const el = await mount("/manage/opening-hours/view/year/window/periods");
    const { list, dialog } = await openPeriod(el);
    const closed = new Promise((resolve) =>
      dialog.addEventListener("period-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await expect.poll(() => list.shadowRoot!.querySelector("period-dialog")).toBeNull();
    expect(
      el.shadowRoot!.querySelector("[data-test=calendar-window][data-window=periods]"),
    ).not.toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/year/window/periods");
  });
  it("Periods… on the Year pushes window/periods and Back closes it", async () => {
    const el = await mount("/manage/opening-hours/view/year");
    const pushes = pushedPaths();
    const year = el.shadowRoot!.querySelector("opening-hours-year")!;
    const button = year.shadowRoot!.querySelector<HTMLElement>(
      "season-chips [data-test=open-periods]",
    )!;
    await userEvent.click(button);
    await periodsWindow(el);
    expect(pushes()).toEqual(["/manage/opening-hours/view/year/window/periods"]);
    history.back();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
    expect(drawnView(el)).toBe("year");
  });
  it("a painter's station address keeps its Periods window and drops the station query", async () => {
    const base = "/manage/opening-hours/view/season/season/winter/department/d1";
    const pushed = vi.spyOn(history, "pushState");
    const el = await mount(`${base}/window/periods?station=s1`);
    await expect.poll(() => location.pathname).toBe(`${base}/window/periods`);
    expect(location.search).toBe("");
    expect(pushed).not.toHaveBeenCalled();
    await periodsWindow(el);
    const painter = await shownPainter(el);
    expect([painter.seasonId, painter.departmentId]).toEqual(["winter", "d1"]);
  });
  it("draws Periods as the wide window, where Seasons is compact", async () => {
    const el = await mount("/manage/opening-hours/view/year/window/periods");
    const { modal } = await periodsWindow(el);
    expect(modal.hasAttribute("size")).toBe(false);
    expect(modal.size).toBeUndefined();
    history.replaceState(null, "", "/manage/opening-hours/view/year/window/seasons");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window][data-window=seasons]"))
      .not.toBeNull();
    expect(
      el
        .shadowRoot!.querySelector("[data-test=calendar-window][data-window=seasons]")!
        .getAttribute("size"),
    ).toBe("compact");
  });
  it("moving from Seasons to Periods asks about the season draft and keeps the painter's paint", async () => {
    const base = "/manage/opening-hours/view/season/season/winter/department/d1";
    history.replaceState(null, "", base);
    let app: PainterApp | undefined;
    const guard = screenGuard(() => app);
    try {
      const mounted = await mountApp();
      app = mounted.app;
      const el = mounted.el;
      const painter = await shownPainter(el);
      await drag(painter, "3", 120, 240);
      const before = painter.edited();
      await guard.write(`${base}/window/seasons`);
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window] season-chips"))
        .not.toBeNull();
      const chips = el.shadowRoot!.querySelector<HTMLElementTagNameMap["season-chips"]>(
        "[data-test=calendar-window] season-chips",
      )!;
      await expect
        .poll(() => chips.shadowRoot!.querySelector("[data-test=season-edit]"))
        .not.toBeNull();
      chips.shadowRoot!.querySelector<HTMLElement>("[data-test=season-edit]")!.click();
      await chips.updateComplete;
      const dialog = chips.shadowRoot!.querySelector("season-dialog")!;
      await dialog.updateComplete;
      dialog
        .shadowRoot!.querySelector<HTMLElement>("[name=name]")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Changed spring" } }));
      await dialog.updateComplete;
      const keeping = guard.write(`${base}/window/periods`);
      await choose(app, "keep");
      await keeping;
      expect(location.pathname).toBe(`${base}/window/seasons`);
      const discarding = guard.write(`${base}/window/periods`);
      await choose(app, "discard");
      await discarding;
      expect(location.pathname).toBe(`${base}/window/periods`);
      await periodsWindow(el);
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual(before);
      expect(app.leave.coordinator.isDirty()).toBe(true);
    } finally {
      guard.dispose();
    }
  });
});

it("closing the Seasons window protects its own season draft while retaining the painter draft", async () => {
  const base = "/manage/opening-hours/view/season/season/winter/department/d1";
  history.replaceState(null, "", base);
  let app!: PainterApp;
  const guard = new NavigationGuard(window, {
    isDirty: () => app?.leave.coordinator.isDirty() ?? false,
    request: (proceed, signal, destination) => {
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      return app.leave.coordinator.request({
        scopes: el.navigationScopes(new URL(destination)) ?? "all",
        reason: "navigation",
        proceed,
        signal,
      });
    },
  });
  try {
    const mounted = await mountApp();
    app = mounted.app;
    const el = mounted.el;
    const painter = await shownPainter(el);
    await drag(painter, "3", 120, 240);
    await guard.write(`${base}/window/seasons`);
    const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
      "[data-test=calendar-window]",
    )!;
    const chips = modal.querySelector("season-chips")!;
    await expect
      .poll(() => chips.shadowRoot!.querySelector("[data-test=season-edit]"))
      .not.toBeNull();
    chips.shadowRoot!.querySelector<HTMLElement>("[data-test=season-edit]")!.click();
    await chips.updateComplete;
    const dialog = chips.shadowRoot!.querySelector("season-dialog")!;
    await dialog.updateComplete;
    const name = dialog.shadowRoot!.querySelector<HTMLElement>("[name=name]")!;
    name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Changed spring" } }));
    await dialog.updateComplete;
    const closing = guard.write(base);
    await choose(app, "keep");
    await closing;
    expect(location.pathname).toBe(`${base}/window/seasons`);
    expect(
      (dialog.shadowRoot!.querySelector("[name=name]") as HTMLElementTagNameMap["wt-input"]).value,
    ).toBe("Changed spring");
    const discarding = guard.write(base);
    await choose(app, "discard");
    await discarding;
    expect(location.pathname).toBe(base);
    expect(painterOf(el)).toBe(painter);
    expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
    expect(app.leave.coordinator.isDirty()).toBe(true);
  } finally {
    guard.dispose();
  }
});

it("a same-path station query still resolves the old address after the Calendar has loaded", async () => {
  const el = await mount("/manage/opening-hours");
  history.pushState(null, "", "/manage/opening-hours?station=s1");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => painterOf(el)?.seasonId).toBe("winter");
  expect(location.pathname).toBe("/manage/opening-hours/view/season/season/winter/department/d1");
});
