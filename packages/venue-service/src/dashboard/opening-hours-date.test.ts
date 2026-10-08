import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import "./opening-hours-screen.js";

let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const originalUrl = location.href;
const special = {
  id: "s/1",
  date: "2026-10-12",
  name: "Holiday",
  colour: "red" as const,
  closeWholeVenue: false,
};
function fixture(own = true): OpeningHoursModel {
  return {
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [{ id: "m1", name: "Lunch menu", active: true, includes: [] }],
    specialDates: [special, { ...special, id: "s2", date: "2026-10-13", name: "Party" }],
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        periods: [
          {
            id: "p1",
            name: "Lunch",
            colour: "green",
            menuId: "m1",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [1],
          },
        ],
        week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] }],
        dates: own
          ? [
              {
                specialDateId: "s/1",
                slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }],
              },
            ]
          : [],
      },
    ],
  };
}
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
  own = true,
  write: (url: string, method: string, body: unknown) => Promise<unknown> = async () => {},
  readOnly = false,
) {
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.readOnly = readOnly;
  screen.api = new OpeningHoursApi((async (url, method, body) =>
    method === "GET" ? fixture(own) : write(url, method, body)) as DashboardRequest);
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-week")).not.toBeNull();
  const mode =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=weekMode]");
  expect(mode, "normal-week / special-date selector").not.toBeNull();
  emit(mode!, "wt-change", { value: "date" });
  await expect.poll(() => screen.shadowRoot?.querySelector("[name=specialDateId]")).not.toBeNull();
  await screen.updateComplete;
  const week =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!;
  await week.updateComplete;
  return week;
}
const grid = (week: HTMLElementTagNameMap["opening-hours-week"]) =>
  week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!;
const save = (week: HTMLElementTagNameMap["opening-hours-week"]) =>
  week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!;
it("selects a special date and draws its own single column with a quiet Save", async () => {
  const week = await mount();
  expect(grid(week).columns.map((c) => c.key)).toEqual(["1"]);
  expect(grid(week).columns[0]!.label).toContain("Holiday");
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "12:00", endsAt: "16:00" },
  ]);
  expect(save(week).disabled).toBe(true);
  expect(save(week).variant).toBe("secondary");
  const link = screen.shadowRoot!.querySelector<HTMLAnchorElement>(
    "[data-test=station-hours-link]",
  )!;
  expect(link.textContent).toContain("Add special dates in Station hours");
  expect(link.getAttribute("href")).toBe("/manage/hours");
});
it("stages a date resize then writes only its date timetable", async () => {
  const writes: unknown[] = [];
  const week = await mount(true, async (url, method, body) => {
    writes.push({ url, method, body });
  });
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await week.updateComplete;
  expect(writes).toEqual([]);
  expect(save(week).disabled).toBe(false);
  save(week).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      url: "/management-api/venue-service/special-dates/s%2F1/menu-timetables/d1",
      method: "PUT",
      body: { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
    },
  ]);
  await expect.poll(() => save(week).disabled).toBe(true);
});
it("stages Closed all day and saves an empty override even when the weekday is empty", async () => {
  const writes: unknown[] = [];
  const week = await mount(false, async (url, method, body) => {
    writes.push({ url, method, body });
  });
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=close-date]")!.click();
  await week.updateComplete;
  expect(writes).toEqual([]);
  expect(grid(week).columns[0]!.slots).toEqual([]);
  save(week).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      url: "/management-api/venue-service/special-dates/s%2F1/menu-timetables/d1",
      method: "PUT",
      body: { slots: [] },
    },
  ]);
});
it("keeps the dated editor but offers no per-department way to follow the normal week", async () => {
  const week = await mount(true);
  expect(week.shadowRoot!.querySelector("[data-test=follow-week]")).toBeNull();
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "12:00", endsAt: "16:00" },
  ]);
  expect(save(week).disabled).toBe(true);
});
it("marks a refused date's slots beside its header and permits a retry", async () => {
  let attempts = 0;
  const week = await mount(true, async () => {
    attempts++;
    if (attempts === 1)
      throw { code: "menu_timetable.invalid", params: { field: "slots.0.endsAt" } };
  });
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await week.updateComplete;
  save(week).click();
  await expect.poll(() => week.shadowRoot!.querySelector("[data-day-error='1']")).not.toBeNull();
  expect(save(week).disabled).toBe(false);
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  save(week).click();
  await expect.poll(() => attempts).toBe(2);
  await expect.poll(() => save(week).disabled).toBe(true);
});
it("keeps a viewer's date read-only with no close, follow or save actions", async () => {
  const week = await mount(true, undefined, true);
  expect(grid(week).columns.every((c) => !c.editable)).toBe(true);
  expect(week.shadowRoot!.querySelector("[data-test=close-date]")).toBeNull();
  expect(week.shadowRoot!.querySelector("[data-test=follow-week]")).toBeNull();
  expect(save(week)).toBeNull();
});
it("ignores grid events for weekdays hidden by the date column", async () => {
  const writes: unknown[] = [];
  const week = await mount(true, async (...args) => {
    writes.push(args);
  });
  week.department = {
    ...week.department,
    week: [
      ...week.department.week,
      { weekday: 0, slots: [{ periodId: "p1", startsAt: "09:00", endsAt: "12:00" }] },
    ],
  };
  await week.updateComplete;
  emit(grid(week), "grid-range-select", { columnKey: "2", startsAt: "11:00", endsAt: "15:00" });
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  emit(grid(week), "grid-block-change", {
    columnKey: "0",
    index: 0,
    startsAt: "09:00",
    endsAt: "13:00",
  });
  await week.updateComplete;
  save(week).click();
  await week.updateComplete;
  expect(save(week).disabled).toBe(true);
  expect(writes).toEqual([]);
});
it("keeps a date unchanged when its inherited weekday is already empty until Closed is chosen", async () => {
  const week = await mount(false);
  week.department = { ...week.department, week: [] };
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots).toEqual([]);
  expect(save(week).disabled).toBe(true);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=close-date]")!.click();
  await week.updateComplete;
  expect(save(week).disabled).toBe(false);
  expect(save(week).variant).toBe("primary");
});
it("ignores controls from a departed special-date picker", async () => {
  await mount();
  const picker = screen.shadowRoot!.querySelector("[name=specialDateId]")!;
  const mode = screen.shadowRoot!.querySelector("[name=weekMode]")!;
  emit(mode, "wt-change", { value: "week" });
  await screen.updateComplete;
  emit(picker, "wt-change", { value: "s2" });
  await screen.updateComplete;
  emit(mode, "wt-change", { value: "date" });
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!.specialDate?.id,
  ).toBe("s/1");
  const oldMode = screen.shadowRoot!.querySelector("[name=weekMode]")!;
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  emit(tabs, "wt-tab-change", { value: "periods" });
  await screen.updateComplete;
  emit(oldMode, "wt-change", { value: "week" });
  await screen.updateComplete;
  emit(tabs, "wt-tab-change", { value: "week" });
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!.specialDate?.id,
  ).toBe("s/1");
});
it("keeps staged date ranges when a background department snapshot arrives", async () => {
  const week = await mount();
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await week.updateComplete;
  week.department = structuredClone(week.department);
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "12:00", endsAt: "17:00" },
  ]);
  expect(save(week).disabled).toBe(false);
});
it("does not mark a reconnected date draft saved by a reply started before removal", async () => {
  let done!: () => void;
  const week = await mount(
    true,
    async () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await week.updateComplete;
  save(week).click();
  await expect.poll(() => done).toBeTypeOf("function");
  const parent = week.parentNode!;
  week.remove();
  await week.updateComplete;
  parent.appendChild(week);
  await week.updateComplete;
  done();
  await expect.poll(() => save(week).disabled).toBe(false);
  expect(grid(week).columns[0]!.slots[0]!.endsAt).toBe("17:00");
});
it("paints the Station hours link with the theme's readable link colour", async () => {
  await mount();
  const link = screen.shadowRoot!.querySelector<HTMLAnchorElement>(
    "[data-test=station-hours-link]",
  )!;
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-primary-text)";
  screen.shadowRoot!.appendChild(probe);
  expect(getComputedStyle(link).color).toBe(getComputedStyle(probe).color);
});
it("adds a date range through the shared dialog without changing its weekday", async () => {
  const writes: unknown[] = [];
  const week = await mount(true, async (url, method, body) => {
    writes.push({ url, method, body });
  });
  emit(grid(week), "grid-range-select", { columnKey: "1", startsAt: "16:00", endsAt: "18:00" });
  await week.updateComplete;
  const range =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await range.updateComplete;
  expect(range.occupied).toEqual([{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }]);
  emit(range.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await range.updateComplete;
  range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(writes).toEqual([]);
  expect(week.department.week).toEqual([
    { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
  ]);
  save(week).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    url: "/management-api/venue-service/special-dates/s%2F1/menu-timetables/d1",
    method: "PUT",
    body: {
      slots: [
        { periodId: "p1", startsAt: "12:00", endsAt: "16:00" },
        { periodId: "p1", startsAt: "16:00", endsAt: "18:00" },
      ],
    },
  });
});

it.each([
  ["en", "This named day keeps the normal week. Give it its own hours first."],
  ["es", "Este día especial sigue la semana normal. Dale primero su propio horario."],
] as const)(
  "explains the named-day refusal in %s and keeps retry available",
  async (locale, message) => {
    setLocale(locale);
    const week = await mount(true, async () => {
      throw { code: "special_date.keeps_week", params: { specialDateId: "s/1" } };
    });
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=close-date]")!.click();
    await week.updateComplete;
    save(week).click();
    await expect
      .poll(
        () =>
          week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
            "wt-form-actions",
          )!.error,
      )
      .toBe(message);
    expect(save(week).disabled).toBe(false);
  },
);
