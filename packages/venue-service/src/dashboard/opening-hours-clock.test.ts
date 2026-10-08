import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";

let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/opening-hours");
});
afterEach(() => {
  screen?.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function mount(
  date: string,
  timeZone = "Europe/Madrid",
  clockReadable = true,
  write: (path: string, method: string, body: unknown) => Promise<unknown> = async () => {},
) {
  const model = {
    dayCutover: "06:00",
    timeZone,
    clockReadable,
    menus: [{ id: "m1", name: "Night menu", active: true, includes: [] }],
    specialDates: [
      { id: "s1", date, name: "Clock change", colour: "red" as const, closeWholeVenue: false },
    ],
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        periods: [
          {
            id: "p1",
            name: "Night",
            colour: "green" as const,
            menuId: "m1",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [],
          },
        ],
        week: [],
        dates: [{ specialDateId: "s1", slots: [] }],
      },
    ],
  };
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi((async (path, method, body) =>
    method === "GET" ? model : write(path, method, body)) as DashboardRequest);
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("[name=weekMode]")).not.toBeNull();
  emit(screen.shadowRoot!.querySelector("[name=weekMode]")!, "wt-change", { value: "date" });
  await screen.updateComplete;
  const week =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!;
  await week.updateComplete;
  const grid =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!;
  emit(grid, "grid-range-select", {
    columnKey: grid.columns[0]!.key,
    startsAt: "01:00",
    endsAt: "02:30",
  });
  await week.updateComplete;
  const range =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await range.updateComplete;
  emit(range.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await range.updateComplete;
  return { week, range, grid };
}
for (const locale of ["en", "es"] as const) {
  it(`explains the repeated endpoint on the next calendar morning (${locale})`, async () => {
    const writes: unknown[] = [];
    const { range, week } = await mount("2026-10-24", undefined, undefined, async (...args) => {
      writes.push(args);
    });
    setLocale(locale);
    range.requestUpdate();
    await range.updateComplete;
    expect(range.shadowRoot!.querySelector("[data-test=repeat-note]")?.textContent?.trim()).toBe(
      locale === "en"
        ? "The clock shows 02:30 twice on this date; both follow this timetable."
        : "El reloj marca las 02:30 dos veces en esta fecha; las dos siguen este horario.",
    );
    range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
    await week.updateComplete;
    expect(writes).toEqual([]);
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes).toEqual([
      [
        "/management-api/venue-service/special-dates/s1/menu-timetables/d1",
        "PUT",
        { slots: [{ periodId: "p1", startsAt: "01:00", endsAt: "02:30" }] },
      ],
    ]);
  });
}
for (const [date, zone, readable] of [
  ["2026-10-25", "Europe/Madrid", true],
  ["2026-10-24", "UTC", true],
  ["2026-10-24", "unreadable", false],
] as const) {
  it(`does not invent a repeated time for ${date}, ${zone}, readable=${readable}`, async () => {
    const { range } = await mount(date, zone, readable);
    expect(range.shadowRoot!.querySelector("[data-test=repeat-note]")).toBeNull();
  });
}
it("explains a skipped-clock refusal beside the date and keeps the submitted range retryable", async () => {
  const { range, week, grid } = await mount("2027-03-27", undefined, undefined, async () => {
    throw {
      code: "menu_timetable.invalid",
      params: { field: "slots.0.endsAt", reason: "clock_skips" },
    };
  });
  range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
  await expect.poll(() => week.shadowRoot!.querySelector("[data-day-error]")).not.toBeNull();
  expect(week.shadowRoot!.querySelector("[data-day-error]")!.textContent).toContain(
    "The clock skips this time on this date.",
  );
  expect(grid.columns[0]!.slots).toEqual([{ periodId: "p1", startsAt: "01:00", endsAt: "02:30" }]);
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!
      .disabled,
  ).toBe(false);
});

it("checks an end at the changeover on the next calendar morning and a start on this one", async () => {
  const { range } = await mount("2026-10-24");
  range.dayCutover = "02:30";
  emit(range.shadowRoot!.querySelector("[name=startsAt]")!, "wt-change", { value: "02:30" });
  emit(range.shadowRoot!.querySelector("[name=endsAt]")!, "wt-change", { value: "02:30" });
  await range.updateComplete;
  expect(
    [...range.shadowRoot!.querySelectorAll("[data-test=repeat-note]")].map((note) =>
      note.textContent?.trim(),
    ),
  ).toEqual(["The clock shows 02:30 twice on this date; both follow this timetable."]);
});
it("removes the repeated-time note after fixing an endpoint and never checks incomplete times", async () => {
  const { range } = await mount("2026-10-24");
  for (const value of ["03:30", "", "invalid", "02:31"]) {
    emit(range.shadowRoot!.querySelector("[name=endsAt]")!, "wt-change", { value });
    await range.updateComplete;
    expect(range.shadowRoot!.querySelector("[data-test=repeat-note]")).toBeNull();
  }
});
