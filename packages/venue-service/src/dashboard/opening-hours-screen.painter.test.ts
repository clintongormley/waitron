import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, NavigationGuard } from "@waitron/ui";
import { userEvent } from "vitest/browser";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursYear } from "../opening-hours-calendar.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import { SpecialDaysApi } from "./special-days-client.js";
import type { SeasonPainter } from "./season-painter.js";
import { drag, frame, grid, settle, withBar } from "../testing/season-painter-fixture.js";
import { captureShellLinks } from "../testing/shell-link-capture.js";
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
      return method === "PUT" && path.endsWith("/venue-service/seasons") ? model().seasons : {};
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
  private releaseLinks?: () => void;
  override connectedCallback() {
    super.connectedCallback();
    this.releaseLinks = captureShellLinks(this);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.releaseLinks?.();
  }
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
    expect(el.shadowRoot!.querySelector("[data-window=seasons]")).toBeNull();
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
      await expect
        .poll(() => location.pathname)
        .toBe("/manage/opening-hours/view/season/season/winter/department/d1/window/periods");
      history.back();
      await expect
        .poll(() => location.pathname)
        .toBe("/manage/opening-hours/view/season/season/winter/department/d1");
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]"))
        .toBeNull();
      await cancel(await shownPainter(el));
      await expect.poll(() => painterOf(el)).toBeNull();
      expect(location.pathname).toBe("/manage/opening-hours/view/year");
    } finally {
      guard.dispose();
    }
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
    const el = await mount("/manage/opening-hours/view/year/year/2027", () => withBar(), writes);
    const painter = await openFromChip(el);
    const back = vi.spyOn(history, "back");
    await drag(painter, "3", 7 * 60, 9 * 60);
    saveButton(painter).click();
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(writes.filter((write) => (write as unknown[])[1] === "PUT")).toHaveLength(1);
    expect(back).toHaveBeenCalledTimes(1);
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    expect(drawnView(el)).toBe("year");
    expect(el.shadowRoot!.querySelector("opening-hours-year")!.year).toBe(2027);
  });

  it("Save on a painter loaded directly closes onto the Year by replacement", async () => {
    const el = await mount("/manage/opening-hours/view/season/season/winter/department/d1");
    const painter = await shownPainter(el);
    const pushed = pushedPaths();
    const replaced = vi.spyOn(history, "replaceState");
    const back = vi.spyOn(history, "back");
    await drag(painter, "3", 7 * 60, 9 * 60);
    saveButton(painter).click();
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/year");
    expect(
      replaced.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname),
    ).toContain("/manage/opening-hours/view/year");
    expect(pushed()).toEqual([]);
    expect(back).not.toHaveBeenCalled();
    expect(drawnView(el)).toBe("year");
  });

  it("a refused Save keeps the painter open with its message beside Save", async () => {
    const el = await mount("/manage/opening-hours/view/year/year/2027");
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
    expect(location.pathname).toBe("/manage/opening-hours/view/season/season/spring/department/d1");
  });

  it("a paint made while the save is in flight keeps the painter open, unsaved", async () => {
    const el = await mount("/manage/opening-hours/view/year/year/2027");
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
    expect(location.pathname).toBe("/manage/opening-hours/view/season/season/spring/department/d1");
  });
});

describe("leaving a painter with edits", () => {
  it("the Periods link opens the window over a painter with paint, asking nothing, and closing it returns to the same paint", async () => {
    const base = "/manage/opening-hours/view/season/season/winter/department/d1";
    const { app, el } = await mountApp(base);
    const painter = await shownPainter(el);
    await drag(painter, "3", 120, 240);
    const before = painter.edited();
    expect(before).toEqual({ departments: ["d1"], zones: [] });
    const question =
      app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!;
    const pushes = pushedPaths();
    await userEvent.click(
      painter.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!,
    );
    const { modal } = await periodsWindow(el);
    expect(location.pathname).toBe(`${base}/window/periods`);
    expect(pushes()).toEqual([`${base}/window/periods`]);
    expect(question.open).toBe(false);
    expect(painterOf(el)).toBe(painter);
    expect(painter.edited()).toEqual(before);
    modal.querySelector<HTMLElement>("[data-test=close-calendar-window]")!.click();
    await expect.poll(() => location.pathname).toBe(base);
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
    expect(question.open).toBe(false);
    expect(painterOf(el)).toBe(painter);
    expect(painter.edited()).toEqual(before);
    expect(app.leave.coordinator.isDirty()).toBe(true);
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
    expect(el.shadowRoot!.querySelector("[data-window=seasons]")).toBeNull();
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
async function seasonsWindow(el: Screen) {
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window][data-window=seasons]"))
    .not.toBeNull();
  const win = el.shadowRoot!.querySelector<HTMLElementTagNameMap["seasons-window"]>(
    "[data-test=calendar-window][data-window=seasons]",
  )!;
  await expect.poll(() => rowNames(win).join(" ")).toContain("Spring");
  await win.updateComplete;
  return win;
}
/** Each row's season name, from its input or, read-only, its text. */
const rowNames = (win: HTMLElementTagNameMap["seasons-window"]) =>
  [...(win.shadowRoot?.querySelectorAll("tbody tr") ?? [])].map(
    (row) =>
      row.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")?.value ??
      row.textContent!.trim(),
  );
async function renameFirstSeason(win: HTMLElementTagNameMap["seasons-window"], value: string) {
  win
    .shadowRoot!.querySelector<HTMLElement>("[name=season-0-name]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await win.updateComplete;
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
  it("opens Seasons after loading and Cancel closes only its window pair", async () => {
    const el = await mount("/manage/opening-hours/view/year/year/2027/window/seasons");
    const win = await seasonsWindow(el);
    expect(win.localName).toBe("seasons-window");
    expect(rowNames(win)).toEqual(["Winter", "Spring"]);
    const modal = win.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
    expect(modal.heading).toBe("Seasons");
    const cancel = win.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=cancel-seasons]",
    );
    expect(cancel).not.toBeNull();
    await cancel!.updateComplete;
    expect(
      cancel!.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
    ).toBeGreaterThan(0);
    cancel!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    expect(drawnView(el)).toBe("year");
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
  });
  it("a viewer's Seasons window lists the seasons with nothing to change", async () => {
    const el = await mount(
      "/manage/opening-hours/view/year/window/seasons",
      undefined,
      undefined,
      true,
    );
    const win = await seasonsWindow(el);
    expect(win.readOnly).toBe(true);
    const root = win.shadowRoot!;
    expect(root.querySelector("wt-input")).toBeNull();
    expect(root.querySelector("wt-combobox")).toBeNull();
    expect(root.querySelector("[data-test=delete-season]")).toBeNull();
    expect(root.querySelector("[data-test=add-season]")).toBeNull();
    expect(root.querySelector("[data-test=save-seasons]")).toBeNull();
    expect(root.querySelector("[data-test=season-week]")).toBeNull();
    const close = root.querySelector<HTMLElement>("[data-test=close-seasons]")!;
    expect(close).not.toBeNull();
    close.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
    expect(drawnView(el)).toBe("year");
  });
  it("Seasons… on the Year pushes window/seasons, and Back closes it", async () => {
    const el = await mount("/manage/opening-hours/view/year");
    const pushes = pushedPaths();
    const year = el.shadowRoot!.querySelector("opening-hours-year")!;
    const button = year.shadowRoot!.querySelector<HTMLElement>(
      "season-chips [data-test=open-seasons]",
    )!;
    await userEvent.click(button);
    await seasonsWindow(el);
    expect(pushes()).toEqual(["/manage/opening-hours/view/year/window/seasons"]);
    expect(painterOf(el)).toBeNull();
    history.back();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
    expect(drawnView(el)).toBe("year");
  });
  it("opening the Seasons window reads the special days once and hands them to it", async () => {
    const el = await mount("/manage/opening-hours/view/year");
    const read = vi
      .spyOn(el.api.specialDays, "listSpecialDays")
      .mockResolvedValue([{ id: "sd1", name: "Town fair" }] as never);
    const year = el.shadowRoot!.querySelector("opening-hours-year")!;
    const drawn = year.model;
    el.api.rereadWatches();
    await expect.poll(() => year.model).not.toBe(drawn);
    await el.updateComplete;
    expect(read, "no read while no Seasons window is open").not.toHaveBeenCalled();
    history.replaceState(null, "", "/manage/opening-hours/view/year/window/seasons");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const win = await seasonsWindow(el);
    await expect.poll(() => win.specialDays).toEqual([{ id: "sd1", name: "Town fair" }]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ passive: true });
    const shown = win.seasons;
    el.api.rereadWatches();
    await expect.poll(() => win.seasons).not.toBe(shown);
    await el.updateComplete;
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("loading the page at window/seasons reads the special days once", async () => {
    const read = vi
      .spyOn(SpecialDaysApi.prototype, "listSpecialDays")
      .mockResolvedValue([{ id: "sd1", name: "Town fair" }] as never);
    const el = await mount("/manage/opening-hours/view/year/window/seasons");
    const win = await seasonsWindow(el);
    await expect.poll(() => win.specialDays).toEqual([{ id: "sd1", name: "Town fair" }]);
    const shown = win.seasons;
    el.api.rereadWatches();
    await expect.poll(() => win.seasons).not.toBe(shown);
    await el.updateComplete;
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ passive: true });
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
  it("draws Periods and Seasons as wide windows", async () => {
    const el = await mount("/manage/opening-hours/view/year/window/periods");
    const { modal } = await periodsWindow(el);
    expect(modal.hasAttribute("size")).toBe(false);
    expect(modal.size).toBeUndefined();
    history.replaceState(null, "", "/manage/opening-hours/view/year/window/seasons");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const win = await seasonsWindow(el);
    expect(win.hasAttribute("size")).toBe(false);
    const seasonsModal =
      win.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
    expect(seasonsModal.hasAttribute("size")).toBe(false);
    expect(seasonsModal.size).toBeUndefined();
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
      await renameFirstSeason(await seasonsWindow(el), "Changed spring");
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

it("a Save re-reads the hours and closes the window, keeping the painter's paint", async () => {
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
    const win = await seasonsWindow(el);
    await renameFirstSeason(win, "Deep winter");
    const original = el.api.rereadWithSpecialDays.bind(el.api);
    const writesAtReread: unknown[][] = [];
    const reread = vi.spyOn(el.api, "rereadWithSpecialDays").mockImplementation(() => {
      writesAtReread.push([...app!.writes]);
      original();
    });
    win.shadowRoot!.querySelector<HTMLElement>("[data-test=save-seasons]")!.click();
    await expect.poll(() => reread.mock.calls.length).toBe(1);
    expect(app.writes).toEqual([
      [
        "/management-api/venue-service/seasons",
        "PUT",
        {
          save: [{ id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" }],
          delete: [],
          expectedClockRevision: 4,
        },
      ],
    ]);
    expect(writesAtReread).toEqual([app.writes]);
    await expect.poll(() => location.pathname).toBe(base);
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
    expect(reread).toHaveBeenCalledTimes(1);
    expect(painterOf(el)).toBe(painter);
    expect(painter.edited()).toEqual(before);
    expect(app.leave.coordinator.isDirty()).toBe(true);
  } finally {
    guard.dispose();
  }
});

it("after a Save the screen shows the re-read's seasons, never the Save's answer", async () => {
  const base = "/manage/opening-hours/view/season/season/winter/department/d1";
  history.replaceState(null, "", base);
  let app: PainterApp | undefined;
  const guard = screenGuard(() => app);
  try {
    const mounted = await mountApp();
    app = mounted.app;
    const el = mounted.el;
    const painter = await shownPainter(el);
    await guard.write(`${base}/window/seasons`);
    const win = await seasonsWindow(el);
    await renameFirstSeason(win, "Deep winter");
    vi.spyOn(el.api, "saveSeasons").mockResolvedValue([
      { id: "spring", name: "Spring", startsOn: "03-01", colour: "green" },
      { id: "feria", name: "Feria", startsOn: "09-01", colour: "red" },
      { id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" },
    ]);
    const original = el.api.rereadWithSpecialDays.bind(el.api);
    const reread = vi.spyOn(el.api, "rereadWithSpecialDays").mockImplementation(() => {});
    const before = painter.model;
    win.shadowRoot!.querySelector<HTMLElement>("[data-test=save-seasons]")!.click();
    await expect.poll(() => reread.mock.calls.length).toBe(1);
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
    await el.updateComplete;
    expect(painter.model, "nothing but the re-read replaces the model").toBe(before);
    const live = withBar();
    app.model = {
      ...live,
      seasons: live.seasons.map((season) =>
        season.id === "winter" ? { ...season, name: "Deep winter" } : season,
      ),
    };
    original();
    await expect.poll(() => painter.model).not.toBe(before);
    expect(painter.model.seasons.map(({ name }) => name)).toEqual(["Spring", "Deep winter"]);
  } finally {
    guard.dispose();
  }
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
    const win = await seasonsWindow(el);
    await renameFirstSeason(win, "Changed spring");
    const closing = guard.write(base);
    await choose(app, "keep");
    await closing;
    expect(location.pathname).toBe(`${base}/window/seasons`);
    expect(
      (win.shadowRoot!.querySelector("[name=season-0-name]") as HTMLElementTagNameMap["wt-input"])
        .value,
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
    if (method === "GET" && path.endsWith("/menu-periods/p1/delete-impact"))
      return {
        seasons: 1,
        specialDays: 0,
        routingUses: [],
        keptOpenToday: false,
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
    if (method === "GET" && path.endsWith("/menu-periods/p1/delete-impact"))
      return {
        seasons: 1,
        specialDays: 0,
        routingUses: [],
        keptOpenToday: false,
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

describe("the painters' Periods link", () => {
  const base = "/manage/opening-hours/view/season/season/winter/department/d1";
  const link = (painter: SeasonPainter) =>
    painter.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!;

  it("a period added in the Periods window reaches the painter underneath", async () => {
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
    await userEvent.click(link(painter));
    const { modal, list, table } = await periodsWindow(el);
    list.shadowRoot!.querySelector<HTMLElement>("[data-test=add-period]")!.click();
    await list.updateComplete;
    const dialog = list.shadowRoot!.querySelector("period-dialog")!;
    await dialog.updateComplete;
    for (const [name, value] of [
      ["departmentId", "d1"],
      ["name", "Brunch"],
      ["menuId", "m1"],
    ])
      dialog
        .shadowRoot!.querySelector<HTMLElement>(`[name=${name}]`)!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
    await dialog.updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
    await expect.poll(() => list.shadowRoot!.querySelector("period-dialog")).toBeNull();
    expect(app.writes).toEqual([
      [
        "/management-api/venue-service/departments/d1/menu-periods",
        "POST",
        expect.objectContaining({ name: "Brunch", menuId: "m1" }),
      ],
    ]);
    await expect.poll(() => table.shadowRoot!.textContent ?? "").toContain("Brunch");
    modal.querySelector<HTMLElement>("[data-test=close-calendar-window]")!.click();
    await expect.poll(() => location.pathname).toBe(base);
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

  it("a period deleted in the Periods window leaves the painter's draft, and Save sends only the other edits", async () => {
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
    await userEvent.click(link(painter));
    const { modal, list, table } = await periodsWindow(el);
    table
      .shadowRoot!.querySelector<HTMLElement>(
        'tr[data-row-key="period:p1"] [data-test=delete-period]',
      )!
      .click();
    await expect
      .poll(() => list.shadowRoot!.querySelector("period-delete-dialog")?.impact)
      .toBeTruthy();
    const deletion = list.shadowRoot!.querySelector("period-delete-dialog")!;
    await deletion.updateComplete;
    deletion.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await expect.poll(() => list.shadowRoot!.querySelector("period-delete-dialog")).toBeNull();
    await expect
      .poll(() => table.shadowRoot!.querySelector('tr[data-row-key="period:p1"]'))
      .toBeNull();
    modal.querySelector<HTMLElement>("[data-test=close-calendar-window]")!.click();
    await expect.poll(() => location.pathname).toBe(base);
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
        days: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
          weekday,
          slots: weekday === 4 ? [{ periodId: "p2", startsAt: "08:00", endsAt: "10:00" }] : [],
        })),
      },
    ]);
  });

  /** Paints `pot` (Dinner by default) 08:00–10:00, or `from`–`to` minutes after the 06:00
   *  changeover, on `weekday`, deletes Lunch (saved Monday 13:00–16:00) in the Periods window with
   *  Dinner as its replacement, closes the window and saves: what was sent. */
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
    await userEvent.click(link(painter));
    const { modal, list, table } = await periodsWindow(el);
    table
      .shadowRoot!.querySelector<HTMLElement>(
        'tr[data-row-key="period:p1"] [data-test=delete-period]',
      )!
      .click();
    await expect
      .poll(() => list.shadowRoot!.querySelector("period-delete-dialog")?.impact)
      .toBeTruthy();
    const deletion = list.shadowRoot!.querySelector("period-delete-dialog")!;
    await deletion.updateComplete;
    deletion
      .shadowRoot!.querySelector("wt-combobox[name=replacementPeriodId]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "p2" }, bubbles: true, composed: true }),
      );
    await deletion.updateComplete;
    deletion.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await expect.poll(() => list.shadowRoot!.querySelector("period-delete-dialog")).toBeNull();
    expect(app.writes).toContainEqual([
      "/management-api/venue-service/menu-periods/p1/delete",
      "POST",
      expect.objectContaining({ replacementPeriodId: "p2" }),
    ]);
    modal.querySelector<HTMLElement>("[data-test=close-calendar-window]")!.click();
    await expect.poll(() => location.pathname).toBe(base);
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
        days: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [dinner("08:00", "10:00"), dinner("13:00", "16:00")] : [],
        })),
      },
    ]);
  });

  it("a period deleted with a replacement fills both ends of a saved block the draft split", async () => {
    const { shown, sent } = await saveAfterReplacingLunch("1", "closed", 480, 540);
    expect(shown("1")).toEqual([dinner("13:00", "14:00"), dinner("15:00", "16:00")]);
    expect(sent).toEqual([
      {
        departmentId: "d1",
        days: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [dinner("13:00", "14:00"), dinner("15:00", "16:00")] : [],
        })),
      },
    ]);
  });

  it("a period deleted with a replacement keeps the replacement's saved block on a day the draft did not change", async () => {
    const { shown, sent } = await saveAfterReplacingLunch("4");
    expect(shown("1")).toEqual([dinner("13:00", "16:00")]);
    expect(sent).toEqual([
      {
        departmentId: "d1",
        days: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
          weekday,
          slots:
            weekday === 1
              ? [dinner("13:00", "16:00")]
              : weekday === 4
                ? [dinner("08:00", "10:00")]
                : [],
        })),
      },
    ]);
  });

  it("Review Focus 1 through the link: Back asks about the window's period draft, Keep stays and Discard closes the window over the same paint", async () => {
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
      await userEvent.click(link(painter));
      await expect.poll(() => location.pathname).toBe(`${base}/window/periods`);
      const { dialog } = await openPeriod(el);
      dialog.shadowRoot!.querySelector<HTMLElement>("[name=name]")!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Brunch" },
          bubbles: true,
          composed: true,
        }),
      );
      await dialog.updateComplete;
      history.back();
      await choose(app, "keep");
      await expect.poll(() => location.pathname).toBe(`${base}/window/periods`);
      expect(el.shadowRoot!.querySelector("[data-test=calendar-window]")).not.toBeNull();
      expect(
        dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
      ).toBe("Brunch");
      history.back();
      await choose(app, "discard");
      await expect.poll(() => location.pathname).toBe(base);
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]"))
        .toBeNull();
      expect(painterOf(el)).toBe(painter);
      expect(painter.edited()).toEqual(before);
      expect(app.leave.coordinator.isDirty()).toBe(true);
      expect(app.writes).toEqual([]);
    } finally {
      guard.dispose();
    }
  });

  it("a modified click on the Periods link is left to the browser", async () => {
    const el = await mount(base);
    const painter = await shownPainter(el);
    const seen: boolean[] = [];
    // Bubbling on window runs after the link's own listener, so it sees what the link did.
    const record = (event: Event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", record);
    try {
      const press = (init: MouseEventInit) =>
        link(painter).dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ...init }),
        );
      press({ ctrlKey: true });
      await el.updateComplete;
      expect(seen).toEqual([false]);
      expect(location.pathname).toBe(base);
      press({});
      expect(seen).toEqual([false, true]);
      await expect.poll(() => location.pathname).toBe(`${base}/window/periods`);
    } finally {
      window.removeEventListener("click", record);
    }
  });

  it.each(["shiftKey", "metaKey"] as const)(
    "a click on the Periods link with %s held is left to the browser",
    async (modifier) => {
      const el = await mount(base);
      const painter = await shownPainter(el);
      const seen: boolean[] = [];
      // Bubbling on window runs after the link's own listener, so it sees what the link did.
      const record = (event: Event) => {
        seen.push(event.defaultPrevented);
        event.preventDefault();
      };
      window.addEventListener("click", record);
      try {
        link(painter).dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            composed: true,
            cancelable: true,
            [modifier]: true,
          }),
        );
        await el.updateComplete;
        expect(seen).toEqual([false]);
        expect(location.pathname).toBe(base);
        expect(el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
      } finally {
        window.removeEventListener("click", record);
      }
    },
  );

  it("a Periods link click something above the painter has already cancelled opens nothing", async () => {
    const el = await mount(base);
    const painter = await shownPainter(el);
    const pushes = pushedPaths();
    const press = () =>
      link(painter).dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    // Capturing on document runs before the link's own listener. With no guard and
    // no leave coordinator, the screen pushes its address within the click itself.
    const cancel = (event: Event) => event.preventDefault();
    document.addEventListener("click", cancel, { capture: true });
    try {
      press();
    } finally {
      document.removeEventListener("click", cancel, { capture: true });
    }
    expect(pushes()).toEqual([]);
    expect(location.pathname).toBe(base);
    const record = (event: Event) => event.preventDefault();
    window.addEventListener("click", record);
    try {
      press();
    } finally {
      window.removeEventListener("click", record);
    }
    expect(pushes()).toEqual([`${base}/window/periods`]);
    await periodsWindow(el);
  });

  it("a calendar-window-open sent inside the screen does not reach the screen's parent", async () => {
    const el = await mount("/manage/opening-hours/view/year");
    const reached: Event[] = [];
    const record = (event: Event) => reached.push(event);
    document.addEventListener("calendar-window-open", record);
    try {
      el.shadowRoot!.querySelector("opening-hours-year")!.dispatchEvent(
        new CustomEvent("calendar-window-open", {
          detail: { window: "periods" },
          bubbles: true,
          composed: true,
        }),
      );
      await periodsWindow(el);
      expect(reached).toEqual([]);
    } finally {
      document.removeEventListener("calendar-window-open", record);
    }
  });
});
