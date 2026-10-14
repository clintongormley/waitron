import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import { frame, settle } from "../testing/special-day-painter-fixture.js";
import "./opening-hours-screen.js";

class OpeningLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly writes: unknown[][] = [];
  readonly api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) => {
      if (method !== "GET") {
        this.writes.push([path, method, body]);
        return;
      }
      if (path.includes("/opening-hours/season-days?"))
        return {
          days: new URL(path, "http://x").searchParams
            .get("dates")!
            .split(",")
            .map((date) => ({ date, seasonId: null, dayCutover: "06:00", departments: [] })),
        };
      if (path.endsWith("/special-days/own"))
        return {
          id: "own",
          name: "Anniversary",
          repeatsYearly: true,
          dates: [{ date: "2025-10-13", closedAllDay: false }],
          paint: [],
          zonePaint: [],
        };
      if (path.includes("/named-days?"))
        return {
          businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
          clockRevision: 0,
          currentBusinessDay: "2026-10-07",
          pending: null,
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
          civilDate: "2026-10-07",
          clockReadable: true,
          days: [
            {
              date: "2026-10-13",
              specialDay: { id: "own", name: "Anniversary" },
              holidays: [],
              tone: "special_day",
              closed: false,
            },
          ],
          holidayCoverage: [],
          holidaySources: [],
          area: {
            addressKey: "fixture-address",
            readiness: "ready",
            options: [],
            required: false,
            chosen: null,
          },
          localHolidaysPerYear: 2,
        };
      if (path.endsWith("/special-days")) return [];
      if (path.includes("/opening-hours/year?"))
        return {
          businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
          clockRevision: 0,
          currentBusinessDay: "2026-10-07",
          pending: null,
          year: 2026,
          timeZone: "Europe/Madrid",
          today: "2026-10-07",
          seasons: [],
          days: [
            {
              date: "2026-10-13",
              seasonId: null,
              specialDay: { id: "own", name: "Anniversary" },
              holidays: [],
              tone: "special_day",
              closed: false,
            },
          ],
          publicHolidaysAvailable: true,
          missingHolidays: [],
          holidayCoverage: [],
          area: {
            addressKey: "fixture-address",
            readiness: "ready",
            options: [],
            required: false,
            chosen: null,
          },
        };
      if (path.includes("/hours?"))
        return {
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
          civilDate: "2026-10-07",
          clockReadable: true,
          departments: [],
          subjects: [],
          week: [],
          days: [],
          specialCells: [],
          holidayCoverage: [],
          holidaySources: [],
        };
      return {
        businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
        clockRevision: 0,
        currentBusinessDay: "2026-10-12",
        pending: null,
        timeZone: "Europe/Madrid",
        clockReadable: true,
        dayCutover: "06:00",
        menus: [
          { id: "lunch", name: "Lunch menu", active: true, includes: [] },
          { id: "dinner", name: "Dinner menu", active: true, includes: [] },
        ],
        seasons: [],
        currentSeasonId: null,
        departments: [
          {
            id: "restaurant",
            name: "Restaurant",
            active: true,
            zones: [],
            seasonWeeks: [],
            periods: [
              {
                id: "p1",
                name: "Lunch",
                colour: "blue",
                menuId: "lunch",
                staffMenuIds: [],
                endOffsetMinutes: 0,
                weekdays: [1],
                routingUses: [],
              },
            ],
          },
        ],
      };
    }) as DashboardRequest),
  );
  override render() {
    return html`<dashboard-opening-hours-screen .api=${this.api}></dashboard-opening-hours-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("opening-leave-test-app", OpeningLeaveApp);
let app: OpeningLeaveApp;
const originalUrl = location.href;
beforeEach(() => history.replaceState(null, "", "/manage/opening-hours/view/year"));
afterEach(() => {
  app?.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  const question =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await question.updateComplete;
  expect(question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}

describe.each(["en", "es"])("Year discard (%s)", (locale) => {
  it("protects a changed special day through close and reconnect", async () => {
    setLocale(locale);
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2026");
    app = document.createElement("opening-leave-test-app") as OpeningLeaveApp;
    applyTokens(app);
    document.body.append(app);
    await app.updateComplete;
    const screen = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
    await expect.poll(() => screen.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
    const cal = screen.shadowRoot!.querySelector("opening-hours-year")!;
    await expect
      .poll(() => cal.shadowRoot!.querySelector("td[data-date='2026-10-13'] button"))
      .not.toBeNull();
    cal.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-10-13'] button")!.click();
    await cal.updateComplete;
    cal.shadowRoot!.querySelector<HTMLElement>("[data-test=special-edit]")!.click();
    await expect
      .poll(() =>
        screen
          .shadowRoot!.querySelector("special-day-painter")
          ?.shadowRoot?.querySelector("wt-input[name=name]"),
      )
      .toBeTruthy();
    const form = screen.shadowRoot!.querySelector<SpecialDayPainter>("special-day-painter")!;
    await settle(form);
    const input =
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!;
    expect(unload()).toBe(false);
    input.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "New anniversary" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(form);
    expect(unload()).toBe(true);
    const parent = screen.parentNode!;
    screen.remove();
    expect(unload()).toBe(false);
    parent.appendChild(screen);
    await screen.updateComplete;
    await settle(form);
    expect(unload()).toBe(true);
    const modal =
      frame(form).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
    const keeping = modal.requestClose("cancel");
    await choose("keep");
    expect(await keeping).toBe(false);
    expect(input.value).toBe("New anniversary");
    const discarding = modal.requestClose("escape");
    await choose("discard");
    expect(await discarding).toBe(true);
    await expect.poll(() => screen.shadowRoot!.querySelector("special-day-painter")).toBeNull();
    expect(unload()).toBe(false);
    expect(app.writes).toEqual([]);
  });
});
