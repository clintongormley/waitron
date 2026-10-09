import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { NamedDaysModel } from "../holiday-types.js";
import {
  realWeekModel as fixture,
  namedWeekModel as calendarFixture,
} from "../testing/real-week-model.js";
import "./opening-hours-screen.js";
let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const original = location.href;
const annual = {
  id: "annual/day",
  date: "2025-10-13",
  name: "Anniversary",
  kind: "working_day" as const,
  repeats: true,
  ownHours: true,
  closeWholeVenue: false,
  hasStationHours: false,
};

function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
beforeEach(() => {
  setLocale("en");
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12&keep=yes#anchor");
});
afterEach(() => {
  screen?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", original);
});

async function mount(
  write: (path: string, method: string, body: unknown) => Promise<unknown> = async () => {},
  zone = false,
  data = fixture(),
  named: () => Promise<NamedDaysModel> = async () => calendarFixture(),
) {
  if (zone)
    history.replaceState(
      null,
      "",
      "/manage/opening-hours/view/week/department/d1/zone/z1?week=2026-10-12",
    );
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi((async (path, method, body) =>
    method === "GET"
      ? path.includes("named-days?")
        ? named()
        : structuredClone(data)
      : write(path, method, body)) as DashboardRequest);
  applyTokens(screen);
  document.body.append(screen);
  await expect
    .poll(() =>
      screen.shadowRoot?.querySelector(zone ? "opening-hours-zone-week" : "opening-hours-week"),
    )
    .not.toBeNull();
  await screen.updateComplete;
  const week = screen.shadowRoot!.querySelector(
    zone ? "opening-hours-zone-week" : "opening-hours-week",
  )!;
  await week.updateComplete;
  return week;
}
it("applies repeating own ranges on the occurrence weekday and locks plain and closed dates", async () => {
  const week = await mount();
  const grid = week.shadowRoot!.querySelector("service-grid")!;
  expect(grid.columns).toHaveLength(7);
  expect(grid.columns[1]!.label).toContain("13");
  expect(grid.columns[1]!.label).toContain("Anniversary");
  expect(grid.columns[1]!.slots).toEqual([{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }]);
  expect(grid.columns.map((c) => c.editable)).toEqual([
    false,
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
  expect(grid.columns[3]!.slots).toEqual([]);
  expect(grid.columns[3]!.label).toContain("Closed");
  expect(week.shadowRoot!.querySelector("[data-test=own-date][data-day='1']")).not.toBeNull();
  expect(week.shadowRoot!.querySelector("[data-test=own-date][data-day='4']")).toBeNull();
  emit(grid, "grid-block-change", { columnKey: "1", index: 0, startsAt: "10:00", endsAt: "18:00" });
  await week.updateComplete;
  expect(grid.columns[0]!.slots).toEqual([{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }]);
});
it("saves one own date while the other remains staged and independently savable", async () => {
  const writes: unknown[][] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  const grid = week.shadowRoot!.querySelector("service-grid")!;
  for (const day of [2, 3])
    emit(grid, "grid-block-change", {
      columnKey: String(day),
      index: 0,
      startsAt: "12:00",
      endsAt: "17:00",
    });
  await week.updateComplete;
  const save = (day: number) =>
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=save-date][data-day='${day}']`,
    )!;
  expect(save(2), "date owns a Save action").not.toBeNull();
  expect(save(3).disabled).toBe(false);
  save(2).click();
  await expect
    .poll(() => writes)
    .toEqual([
      [
        "/management-api/venue-service/special-dates/annual%2Fday/menu-timetables/d1",
        "PUT",
        { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
      ],
    ]);
  await expect.poll(() => save(2).disabled).toBe(true);
  expect(save(3).disabled).toBe(false);
  expect(grid.columns[2]!.slots[0]!.endsAt).toBe("17:00");
});
it("bounds previous at the business week and preserves query/hash when stepping", async () => {
  await mount();
  const previous = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=previous-week]",
  );
  expect(previous, "real-week previous action").not.toBeNull();
  expect(previous!.disabled).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
  await expect.poll(() => location.search).toBe("?week=2026-10-19&keep=yes");
  expect(location.hash).toBe("#anchor");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-week]")!.click();
  await expect.poll(() => location.search).toBe("?week=2026-10-12&keep=yes");
});
it("opens the named-day editor for a plain date with own hours staged", async () => {
  const week = await mount();
  const action = week.shadowRoot!.querySelector<HTMLElement>("[data-test=own-date][data-day='1']");
  expect(action, "plain date has own-hours action").not.toBeNull();
  action!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("named-day-editor")).not.toBeNull();
  const form = screen.shadowRoot!.querySelector("named-day-editor")!;
  await form.updateComplete;
  expect(form.date).toBe("2026-10-12");
  expect(form.ownHours).toBe(true);
  expect(form.day).toBeUndefined();
});
it("shows dated department periods behind dated zone closures and saves only that zone date", async () => {
  const writes: unknown[][] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  }, true);
  const grid = week.shadowRoot!.querySelector("service-grid")!;
  expect(grid.columns[1]!.slots).toEqual([{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }]);
  expect(grid.columns[1]!.closed).toEqual([{ startsAt: "23:00", endsAt: "06:00" }]);
  expect(grid.columns[0]!.editable).toBe(false);
  emit(grid, "grid-block-change", { columnKey: "2", index: 0, startsAt: "22:30", endsAt: "06:00" });
  await week.updateComplete;
  const save = week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-date][data-day='2']");
  expect(save, "zone date has Save").not.toBeNull();
  save!.click();
  await expect
    .poll(() => writes)
    .toEqual([
      [
        "/management-api/venue-service/special-dates/annual%2Fday/zone-closed-times/z1",
        "PUT",
        { ranges: [{ startsAt: "22:30", endsAt: "06:00" }] },
      ],
    ]);
});

it("prefills a public holiday's name and holiday kind for own hours", async () => {
  const week = await mount(undefined, false, fixture(), async () => ({
    ...calendarFixture(),
    days: [
      {
        date: "2026-10-12",
        namedDay: null,
        holidays: [
          {
            id: "public",
            date: "2026-10-12",
            name: "National feast",
            scope: "national",
            sourceId: "official",
          },
        ],
        tone: "public_holiday",
        ownHours: false,
        closed: false,
      },
    ],
  }));
  await screen.updateComplete;
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=own-date][data-day='1']")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("named-day-editor")).not.toBeNull();
  const form = screen.shadowRoot!.querySelector("named-day-editor")!;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("National feast");
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=kind]")!.value,
  ).toBe("holiday");
});
it("waits for calendar facts before opening an unnamed date's editor", async () => {
  let resolve!: (model: NamedDaysModel) => void;
  const week = await mount(
    undefined,
    false,
    fixture(),
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const action = week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=own-date][data-day='1']",
  )!;
  expect(action.disabled).toBe(true);
  action.click();
  emit(action, "click", {});
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("named-day-editor")).toBeNull();
  resolve(calendarFixture());
  await expect.poll(() => action.disabled).toBe(false);
});
it("registers an independently savable date after a clean named-day snapshot changes", async () => {
  const data = fixture();
  const week = await mount(undefined, false, data);
  const added = { ...annual, id: "new", date: "2026-10-12", repeats: false };
  data.namedDays = [...data.namedDays, added];
  data.departments = [
    {
      ...data.departments[0]!,
      dates: [
        ...data.departments[0]!.dates,
        { specialDateId: "new", slots: [{ periodId: "p1", startsAt: "11:00", endsAt: "15:00" }] },
      ],
    },
  ];
  screen.api.rereadWatches();
  await expect
    .poll(() => week.shadowRoot!.querySelector("service-grid")!.columns[0]!.editable)
    .toBe(true);
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "11:00",
    endsAt: "16:00",
  });
  await week.updateComplete;
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-date][data-day='1']",
    )!.disabled,
  ).toBe(false);
});
it("starts a Monday before cutover in the previous business week", async () => {
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours?keep=yes");
  await mount();
  emit(screen.shadowRoot!.querySelector("[name=realWeek]")!, "wt-change", { checked: true });
  await expect.poll(() => location.search).toBe("?keep=yes&week=2026-10-05");
});
it.each(["2026-10-06", "bad", "2026-02-30"])(
  "removes invalid week %s without losing unrelated query",
  async (value) => {
    history.replaceState(null, "", `/manage/opening-hours?week=${value}&keep=yes#anchor`);
    await mount();
    await expect.poll(() => location.search).toBe("?keep=yes");
    expect(location.hash).toBe("#anchor");
  },
);
it("replaces an earlier valid Monday with the current business Monday", async () => {
  history.replaceState(null, "", "/manage/opening-hours?week=2026-10-05&keep=yes");
  await mount();
  await expect.poll(() => location.search).toBe("?week=2026-10-12&keep=yes");
});

it("explains a zone date whose named day now keeps the week and leaves retry available", async () => {
  const week = await mount(async () => {
    throw { code: "special_date.keeps_week", params: { specialDateId: "annual/day" } };
  }, true);
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "2",
    index: 0,
    startsAt: "22:30",
    endsAt: "06:00",
  });
  await week.updateComplete;
  const save = week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-date][data-day='2']",
  )!;
  save.click();
  await expect
    .poll(
      () =>
        week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
          "[slot=header-2] wt-form-actions",
        )!.error,
    )
    .toBe("This named day keeps the normal week. Give it its own hours first.");
  expect(save.disabled).toBe(false);
});
it("reuses a repeating normal-hours day's editor and stored first date", async () => {
  const data = fixture();
  data.namedDays = [{ ...annual, ownHours: false }];
  const week = await mount(undefined, false, data);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=own-date][data-day='2']")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("named-day-editor")).not.toBeNull();
  const form = screen.shadowRoot!.querySelector("named-day-editor")!;
  await form.updateComplete;
  expect(form.day?.id).toBe("annual/day");
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=date]")!.value,
  ).toBe("2025-10-13");
  expect(form.shadowRoot!.textContent).toContain("This changes the day every year");
  expect(form.ownHours).toBe(true);
});
it("a viewer has no own-date or Save action and ignores forged range edits", async () => {
  const writes: unknown[][] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  screen.readOnly = true;
  await screen.updateComplete;
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("[data-test=own-date]")).toBeNull();
  expect(week.shadowRoot!.querySelector("[data-test=save-date]")).toBeNull();
  expect(week.shadowRoot!.querySelector("service-grid")!.columns.every((c) => !c.editable)).toBe(
    true,
  );
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "2",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("service-grid")!.columns[1]!.slots[0]!.endsAt).toBe(
    "16:00",
  );
  expect(writes).toEqual([]);
});
it("does not write an unchanged date when an enabled rendered Save lags a reverted edit", async () => {
  const writes: unknown[][] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  const grid = week.shadowRoot!.querySelector("service-grid")!;
  emit(grid, "grid-block-change", { columnKey: "2", index: 0, startsAt: "12:00", endsAt: "17:00" });
  await week.updateComplete;
  const save = week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-date][data-day='2']",
  )!;
  expect(save.disabled).toBe(false);
  emit(grid, "grid-block-change", { columnKey: "2", index: 0, startsAt: "12:00", endsAt: "16:00" });
  save.click();
  await week.updateComplete;
  await Promise.resolve();
  expect(writes).toEqual([]);
  expect(save.disabled).toBe(true);
});

it("keeps a staged date's original named-day target through a replacement snapshot", async () => {
  const data = fixture(),
    writes: unknown[][] = [];
  const week = await mount(
    async (...args) => {
      writes.push(args);
    },
    false,
    data,
  );
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "2",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await week.updateComplete;
  data.namedDays = data.namedDays.map((day) =>
    day.id === "annual/day" ? { ...day, id: "replacement", name: "Another day" } : day,
  );
  screen.api.rereadWatches();
  await expect.poll(() => week.namedDays[0]!.id).toBe("replacement");
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-date][data-day='2']")!.click();
  await expect
    .poll(() => writes)
    .toEqual([
      [
        "/management-api/venue-service/special-dates/annual%2Fday/menu-timetables/d1",
        "PUT",
        { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
      ],
    ]);
});
