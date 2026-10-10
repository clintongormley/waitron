import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { NamedDaysModel } from "../holiday-types.js";
import type { LocalDate } from "../hours-types.js";
import { NamedDaysApi } from "./named-days-client.js";
import { addMonths, monthGrid, type HoursCalendar } from "./hours-calendar.js";
import "./hours-calendar.js";

const hosts: HTMLElement[] = [];
beforeEach(() => {
  setLocale("en");
});
afterEach(async () => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
  await page.viewport(1280, 800);
});

async function settle(el: HoursCalendar) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await el.updateComplete;
}

const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const day = (el: HoursCalendar, date: LocalDate) =>
  el.shadowRoot!.querySelector<HTMLElement>(`td[data-date="${date}"]`)!;
const dayButton = (el: HoursCalendar, date: LocalDate) =>
  day(el, date).querySelector<HTMLButtonElement>("button")!;
const shownDates = (el: HoursCalendar) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("td[data-date]")].map((td) => td.dataset.date);
const heading = (el: HoursCalendar) => text(el.shadowRoot!.querySelector('[data-test="month"]'));
const panel = (el: HoursCalendar) =>
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="date-panel"]')!;
function token(el: Element, name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  el.shadowRoot!.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

describe("monthGrid", () => {
  it("covers the month in whole weeks from Monday, with the real dates either side", () => {
    const october = monthGrid("2026-10");
    expect([october.length, october[0], october.at(-1)]).toEqual([35, "2026-09-28", "2026-11-01"]);
    const august = monthGrid("2026-08");
    expect([august.length, august[0], august.at(-1)]).toEqual([42, "2026-07-27", "2026-09-06"]);
    // February 2027 starts on a Monday and ends on a Sunday: four weeks and nothing either side.
    const february = monthGrid("2027-02");
    expect([february.length, february[0], february.at(-1)]).toEqual([
      28,
      "2027-02-01",
      "2027-02-28",
    ]);
    expect(monthGrid("2028-02")).toContain("2028-02-29");
    expect(monthGrid("2027-02")).not.toContain("2027-02-29");
    expect(
      new Set(monthGrid("2024-02").map((date) => new Date(`${date}T00:00Z`).getUTCDay())),
    ).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(new Date(`${monthGrid("2024-02")[0]}T00:00Z`).getUTCDay()).toBe(1);
  });

  it("moves by months across a year's end", () => {
    expect([addMonths("2026-12", 1), addMonths("2026-01", -1), addMonths("2026-10", -12)]).toEqual([
      "2027-01",
      "2025-12",
      "2025-10",
    ]);
  });
});

describe("Opening hours named month", () => {
  function namedModel(): NamedDaysModel {
    const namedDay = {
      id: "own",
      date: "2026-10-13",
      name: "Anniversary",
      kind: "holiday" as const,
      repeats: true,
      ownHours: true,
      closeWholeVenue: false,
    };
    return {
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      civilDate: "2026-10-07",
      clockReadable: true,
      days: [
        {
          date: "2026-10-12",
          namedDay: { ...namedDay, date: "2026-10-12", kind: "working_day", name: "Staff feast" },
          holidays: [
            {
              id: "p",
              date: "2026-10-12",
              name: "Public feast",
              scope: "national",
              sourceId: "official",
            },
          ],
          tone: "public_holiday",
          ownHours: true,
          closed: true,
        },
        {
          date: "2026-10-13",
          namedDay,
          holidays: [],
          tone: "own_holiday",
          ownHours: true,
          closed: false,
        },
        {
          date: "2026-10-14",
          namedDay: { ...namedDay, date: "2026-10-14", kind: "working_day", ownHours: false },
          holidays: [],
          tone: "working_day",
          ownHours: false,
          closed: false,
        },
        {
          date: "2026-10-15",
          namedDay: null,
          holidays: [],
          tone: "closed",
          ownHours: false,
          closed: true,
        },
        {
          date: "2026-10-16",
          namedDay: null,
          holidays: [],
          tone: "standard",
          ownHours: false,
          closed: false,
        },
      ],
      holidayCoverage: [],
      holidaySources: [],
      area: {
        addressKey: "old-city",
        readiness: "ready",
        options: [
          { key: "aran", name: "Aran" },
          { key: "rest", name: "Rest of province" },
        ],
        required: true,
        chosen: null,
      },
      localHolidaysPerYear: 2,
    };
  }
  async function namedMount(request?: DashboardRequest) {
    const el = document.createElement("hours-calendar");
    Object.assign(el, {
      namedApi: new NamedDaysApi(request ?? ((async () => namedModel()) as DashboardRequest)),
      today: "2026-10-07",
    });
    applyTokens(el);
    hosts.push(el);
    document.body.append(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    return el;
  }
  it("reads the month's whole weeks once and shows them Monday first", async () => {
    const request = vi.fn<(path: string) => Promise<NamedDaysModel>>(async () => namedModel());
    const el = await namedMount(request as DashboardRequest);
    const reads = () =>
      request.mock.calls.map(([path]) => new URL(path, location.origin).search.slice(1));
    expect(reads()).toEqual(["from=2026-09-28&to=2026-11-01"]);
    expect(heading(el)).toBe("October 2026");
    expect([...el.shadowRoot!.querySelectorAll("thead th")].map(text)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(shownDates(el)).toEqual(monthGrid("2026-10"));
    // A day from the next month is still that real day, named with its month.
    expect(text(dayButton(el, "2026-11-01"))).toBe("1 Nov");
    expect(day(el, "2026-11-01").hasAttribute("data-outside")).toBe(true);
    expect(text(dayButton(el, "2026-10-01"))).toBe("1");
    expect(day(el, "2026-10-01").hasAttribute("data-outside")).toBe(false);
  });

  it("focuses the keyboard's target after the next month's delayed read draws its grid", async () => {
    let resolve!: (value: NamedDaysModel) => void;
    const el = await namedMount((async (path: string) => {
      const from = new URL(path, location.origin).searchParams.get("from")!;
      if (from === "2026-10-26")
        return new Promise<NamedDaysModel>((done) => {
          resolve = done;
        });
      return namedModel();
    }) as DashboardRequest);
    dayButton(el, "2026-10-29").focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => el.shadowRoot!.querySelector("table")).toBeNull();
    resolve(namedModel());
    await settle(el);
    expect(el.shadowRoot!.activeElement).toBe(dayButton(el, "2026-11-05"));
  });
  it("moves by a day and by a week, across into the next month, and opens the date", async () => {
    const request = vi.fn(async () => namedModel());
    const el = await namedMount(request as DashboardRequest);
    const reads = () => request.mock.calls;
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("td button")];
    // One Tab stop, on today.
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([
      dayButton(el, "2026-10-07"),
    ]);
    dayButton(el, "2026-10-12").focus();
    const focused = () => (el.shadowRoot!.activeElement as HTMLElement).closest("td")!.dataset.date;
    await userEvent.keyboard("{ArrowRight}");
    expect(focused()).toBe("2026-10-13");
    await userEvent.keyboard("{ArrowDown}");
    expect(focused()).toBe("2026-10-20");
    await userEvent.keyboard("{ArrowLeft}");
    expect(focused()).toBe("2026-10-19");
    await userEvent.keyboard("{ArrowUp}");
    expect(focused()).toBe("2026-10-12");
    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(text(panel(el).querySelector("h2"))).toBe("Mon, 12 Oct 2026 · Staff feast");
    expect(el.shadowRoot!.activeElement).toBe(panel(el).querySelector("h2"));
    expect(dayButton(el, "2026-10-12").getAttribute("aria-pressed")).toBe("true");

    // Past the grid's last week the month turns, and focus lands on the real date.
    dayButton(el, "2026-10-29").focus();
    await userEvent.keyboard("{ArrowDown}");
    await settle(el);
    expect(heading(el)).toBe("November 2026");
    expect(focused()).toBe("2026-11-05");
    dayButton(el, "2026-10-26").focus();
    await userEvent.keyboard("{ArrowLeft}");
    await settle(el);
    expect(heading(el)).toBe("October 2026");
    expect(focused()).toBe("2026-10-25");
    expect(reads()).toHaveLength(3);
  });
  it.each(["en", "es"] as const)(
    "%s keeps independent local coverage and repeating own-day actions without official country data",
    async (locale) => {
      setLocale(locale);
      for (const local of [
        "owner_entered",
        "none_entered",
        "unsupported_country",
        "address_unresolved",
      ] as const) {
        const el = await namedMount((async () => {
          const model = namedModel();
          if (local !== "owner_entered") {
            const own = model.days.find((day) => day.date === "2026-10-13")!;
            own.namedDay = { ...own.namedDay!, kind: "working_day" };
            own.tone = "working_day";
          }

          model.holidayCoverage = [
            {
              year: 2026,
              country: "GB",
              provinceCode: null,
              regionCode: null,
              nationalRegional: "unsupported_country",
              local,
              dataVersion: null,
              sourceIds: [],
            },
          ];
          return model;
        }) as DashboardRequest);
        const wanted =
          locale === "en"
            ? {
                address_unresolved:
                  "2026: no local holidays entered. You can add your town’s holidays as own named days without completing the holiday address.",
                owner_entered: "2026: local holidays are the ones you entered.",
                none_entered: "2026: no local holidays entered.",
                unsupported_country:
                  "2026: no local holidays entered. Add your town’s holidays as own named days.",
              }
            : {
                address_unresolved:
                  "2026: no hay festivos locales introducidos. Puedes añadir los de tu municipio como días festivos propios sin completar la dirección de festivos.",
                owner_entered: "2026: los festivos locales son los que introdujiste.",
                none_entered: "2026: no hay festivos locales introducidos.",
                unsupported_country:
                  "2026: no hay festivos locales introducidos. Añade los de tu municipio como días festivos propios.",
              };
        expect(text(el.shadowRoot!.querySelector('[data-test="month-coverage"]'))).toContain(
          wanted[local],
        );
        el.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-10-13'] button")!.click();
        await el.updateComplete;
        const events: unknown[] = [];
        el.addEventListener("named-calendar-action", (event) =>
          events.push((event as CustomEvent).detail),
        );
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=named-edit]")!.click();
        expect(events).toMatchObject([
          {
            kind: "edit",
            day: {
              id: "own",
              kind: local === "owner_entered" ? "holiday" : "working_day",
              repeats: true,
            },
          },
        ]);
        el.remove();
      }
    },
  );

  it("named date actions carry the stored repeating record and plain dates offer Add", async () => {
    const el = await namedMount();
    const events: unknown[] = [];
    el.addEventListener("named-calendar-action", (event) =>
      events.push((event as CustomEvent).detail),
    );
    el.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-10-13'] button")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=named-edit]")!.click();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "edit",
      date: "2026-10-13",
      day: { id: "own", repeats: true },
    });
    const event = events[0] as { returnTo: () => HTMLElement };
    expect(event.returnTo()).toBe(el.shadowRoot!.querySelector("[data-test=named-edit]"));
    el.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-10-16'] button")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=named-add]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=named-edit]")).toBeNull();
    el.readOnly = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test^=named-]")).toBeNull();
  });
  it("named month keeps exactly one keyboard tab stop after changing months", async () => {
    const el = await namedMount();
    el.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-10-13'] button")!.focus();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next-month]")!.click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("td button[tabindex='0']")).toHaveLength(1);
  });
  it("paints kind tones across each date, says Closed independently and marks own hours", async () => {
    const el = await namedMount();
    for (const [date, fill] of [
      ["12", "palette-red"],
      ["13", "palette-purple"],
      ["14", "palette-blue"],
      ["15", "day-closed"],
      ["16", "day-standard"],
    ]) {
      const cell = day(el, `2026-10-${date}`);
      expect(getComputedStyle(cell).backgroundColor, date).toBe(token(el, `--wt-color-${fill}`));
    }
    expect(text(day(el, "2026-10-12"))).toContain("Closed");
    expect(text(day(el, "2026-10-12"))).toContain("Public feast");
    expect(text(day(el, "2026-10-12"))).toContain("Staff feast");
    expect(day(el, "2026-10-13").querySelector("wt-icon[name=clock]")).not.toBeNull();
    expect(getComputedStyle(day(el, "2026-10-13").querySelector("wt-icon")!).color).toBe(
      token(el, "--wt-color-on-palette-purple"),
    );
    expect(text(day(el, "2026-10-13"))).toContain("Own hours");
    expect(day(el, "2026-10-14").querySelector("wt-icon")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=date-panel]")).toBeNull();
  });
  it("saves only an offered changed area and refreshes the month passively", async () => {
    let chosen: string | null = null;
    const calls: unknown[][] = [];
    const el = await namedMount((async (path, method, body, options) => {
      calls.push([path, method, body, options]);
      if (method === "PUT") {
        chosen = (body as { areaKey: string }).areaKey;
        return;
      }
      const model = namedModel();
      model.area.chosen = chosen;
      return model;
    }) as DashboardRequest);
    const chooser =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]");
    expect(chooser).not.toBeNull();
    chooser!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "aran" }, bubbles: true, composed: true }),
    );
    await expect.poll(() => chooser!.value).toBe("aran");
    expect(calls.filter((call) => call[1] === "PUT")).toEqual([
      ["/management-api/venue-service/holiday-area", "PUT", { areaKey: "aran" }, undefined],
    ]);
    expect(
      calls
        .filter((call) => call[1] === "GET")
        .every((call) => (call[3] as { passive: boolean }).passive),
    ).toBe(true);
    chooser!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "missing" }, bubbles: true, composed: true }),
    );
    chooser!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "aran" }, bubbles: true, composed: true }),
    );
    expect(calls.filter((call) => call[1] === "PUT")).toHaveLength(1);
    expect(el.shadowRoot!.textContent).toContain("2 local holidays a year");
  });
  it("ignores an old area refusal after detach and reconnect", async () => {
    let refuse!: (value: unknown) => void;
    const el = await namedMount((async (_path, method) => {
      if (method === "PUT")
        return new Promise((_resolve, reject) => {
          refuse = reject;
        });
      return namedModel();
    }) as DashboardRequest);
    const chooser =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]")!;
    chooser.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "aran" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    el.remove();
    document.body.append(el);
    await el.updateComplete;
    refuse({ code: "holiday.invalid" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(chooser.error).toBe("");
    expect(chooser.disabled).toBe(false);
  });
  it("retains an area refusal through a successful passive month refresh and allows retry", async () => {
    let saves = 0;
    const api = new NamedDaysApi((async (_path, method) => {
      if (method === "PUT" && ++saves === 1) throw { code: "holiday.invalid" };
      const model = namedModel();
      model.area.chosen = saves > 1 ? "aran" : null;
      return model;
    }) as DashboardRequest);
    const el = document.createElement("hours-calendar");
    el.namedApi = api;
    el.today = "2026-10-07";
    applyTokens(el);
    hosts.push(el);
    document.body.append(el);
    await expect.poll(() => el.shadowRoot!.querySelector("[name=holidayArea]")).not.toBeNull();
    const chooser =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]")!;
    const pick = () =>
      chooser.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "aran" }, bubbles: true, composed: true }),
      );
    pick();
    await expect.poll(() => chooser.error).toBe("The change could not be saved.");
    api.rereadWatches();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(chooser.error).toBe("The change could not be saved.");
    expect(chooser.disabled).toBe(false);
    pick();
    await expect.poll(() => chooser.value).toBe("aran");
    expect(chooser.error).toBe("");
  });
  it("discards a late old-month response, and shows both years' coverage across December", async () => {
    let finish!: (model: NamedDaysModel) => void;
    let reads = 0;
    const el = await namedMount((async () => {
      if (++reads === 1)
        return new Promise<NamedDaysModel>((resolve) => {
          finish = resolve;
        });
      const model = namedModel();
      model.days = [];
      model.area.options = [];
      model.holidayCoverage = [
        {
          year: 2026,
          country: "ES",
          provinceCode: "41",
          regionCode: "01",
          nationalRegional: "complete",
          local: "owner_entered",
          dataVersion: "ES-2026.1",
          sourceIds: [],
        },
        {
          year: 2027,
          country: "ES",
          provinceCode: "41",
          regionCode: "01",
          nationalRegional: "missing_year",
          local: "none_entered",
          dataVersion: null,
          sourceIds: [],
        },
      ];
      return model;
    }) as DashboardRequest);
    expect(el.shadowRoot!.querySelector("table")).toBeNull();
    el.month = "2026-12";
    await el.updateComplete;
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=month-coverage]")?.textContent)
      .toContain("2027: official holidays are not available yet");
    finish(namedModel());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=month-coverage]")!.textContent).toContain(
      "2026: official national and regional holidays are included.",
    );
    expect(el.shadowRoot!.querySelector("[data-test=month-coverage]")!.textContent).toContain(
      "2026: local holidays are the ones you entered.",
    );
    expect(el.shadowRoot!.querySelector("[name=holidayArea]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=month]")!.textContent).toContain(
      "December 2026",
    );
  });
  it("shows an unavailable read without inventing a loaded calendar", async () => {
    const el = await namedMount((async () => {
      throw { code: "connection.failed" };
    }) as DashboardRequest);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toBe(
      "Hours could not be loaded.",
    );
    expect(el.shadowRoot!.querySelector("table")).toBeNull();
  });
  it("shows a viewer the saved area in words and no picker, and quotes incomplete area coverage here", async () => {
    const el = await namedMount((async () => {
      const model = namedModel();
      model.area.chosen = "aran";
      model.localHolidaysPerYear = 0;
      model.holidayCoverage = [
        {
          year: 2026,
          country: "ES",
          provinceCode: "25",
          regionCode: "09",
          nationalRegional: "area_required",
          local: "none_entered",
          dataVersion: "ES-2026.1",
          sourceIds: [],
        },
      ];
      return model;
    }) as DashboardRequest);
    el.readOnly = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[name=holidayArea]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=area-chosen]")!.textContent).toContain("Aran");
    expect(el.shadowRoot!.querySelector("[data-test=month-coverage]")!.textContent).toContain(
      "choose the holiday area here",
    );
    expect(el.shadowRoot!.querySelector("[data-test=local-holiday-hint]")).toBeNull();
  });
  it.each(["settled refusal", "late refusal", "late success"])(
    "an address change clears area state and ignores the old address's %s",
    async (reply) => {
      let addressKey = "old-city";
      let reject!: (value: unknown) => void;
      let resolve!: (value: unknown) => void;
      let reads = 0;
      const request = (async (_path, method) => {
        if (method === "PUT")
          return new Promise<unknown>((yes, no) => {
            resolve = yes;
            reject = no;
          });
        reads++;
        const model = namedModel();
        model.area.addressKey = addressKey;
        return model;
      }) as DashboardRequest;
      const api = new NamedDaysApi(request);
      const el = await namedMount(request);
      el.namedApi = api;
      el.remove();
      document.body.append(el);
      await expect.poll(() => reads).toBeGreaterThan(0);
      const chooser = () =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]")!;
      chooser().dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "aran" }, bubbles: true, composed: true }),
      );
      await expect.poll(() => chooser().disabled).toBe(true);
      if (reply === "settled refusal") {
        reject({ code: "holiday.invalid" });
        await expect.poll(() => chooser().error).toBe("The change could not be saved.");
      }
      addressKey = "new-city";
      const beforeRead = reads;
      api.rereadWatches();
      await expect.poll(() => reads).toBeGreaterThan(beforeRead);
      await el.updateComplete;
      expect(chooser().error).toBe("");
      expect(chooser().disabled).toBe(false);
      const afterMove = reads;
      if (reply === "late refusal") reject({ code: "holiday.invalid" });
      if (reply === "late success") resolve({});
      await new Promise((done) => setTimeout(done, 0));
      await el.updateComplete;
      expect(chooser().error).toBe("");
      expect(chooser().disabled).toBe(false);
      expect(reads).toBe(afterMove);
    },
  );
  it.each(["en", "es"] as const)(
    "%s explains unresolved area addresses and sends no write",
    async (locale) => {
      setLocale(locale);
      const explanations =
        locale === "en"
          ? {
              missing_city: "The holiday area needs the venue's city. Add it in Venue details.",
              unresolved_province:
                "The holiday area needs a recognised province. Correct it in Venue details.",
              unresolved_address:
                "The holiday area needs the venue's city and a recognised province. Set them in Venue details.",
              unsupported_country: "Holiday areas are unavailable for this country.",
            }
          : {
              missing_city:
                "La zona de festivos necesita la ciudad del local. Añádela en Datos del local.",
              unresolved_province:
                "La zona de festivos necesita una provincia reconocida. Corrígela en Datos del local.",
              unresolved_address:
                "La zona de festivos necesita la ciudad y una provincia reconocida. Indícalas en Datos del local.",
              unsupported_country: "No hay zonas de festivos para este país.",
            };
      for (const [readiness, message] of Object.entries(explanations)) {
        const request = vi.fn(async (path: string, method?: string) => {
          if (method === "PUT") throw new Error(`Unexpected area write: ${path}`);
          const model = namedModel();
          Object.assign(model.area, { readiness });
          if (readiness !== "missing_city") model.area.options = [];
          return model;
        });
        const el = await namedMount(request as DashboardRequest);
        const chooser =
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]");
        if (readiness === "missing_city") {
          expect(chooser).not.toBeNull();
          await chooser!.updateComplete;
          expect(chooser!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
            true,
          );
          chooser!.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: "aran" },
              bubbles: true,
              composed: true,
            }),
          );
          await el.updateComplete;
        }
        expect(el.shadowRoot!.querySelector("[data-test=area-address]")!.textContent).toContain(
          message,
        );
        expect(request.mock.calls.every((call) => call[1] !== "PUT")).toBe(true);
        el.remove();
      }
    },
  );

  it.each(["en", "es"] as const)(
    "%s retains actionable area refusals and a generic fallback, with retry",
    async (locale) => {
      setLocale(locale);
      const cases = [
        [
          { code: "holiday.invalid", params: { field: "geography" } },
          locale === "en"
            ? "The holiday area needs the venue's city and a recognised province. Set them in Venue details."
            : "La zona de festivos necesita la ciudad y una provincia reconocida. Indícalas en Datos del local.",
        ],
        [
          { code: "holiday.invalid", params: { field: "areaKey" } },
          locale === "en"
            ? "Choose one of the areas offered."
            : "Elige una de las zonas ofrecidas.",
        ],
        [
          { code: "unrelated.failure" },
          locale === "en" ? "The change could not be saved." : "No se pudo guardar el cambio.",
        ],
      ] as const;
      for (const [error, message] of cases) {
        let writes = 0;
        let chosen: string | null = null;
        const el = await namedMount((async (_path, method) => {
          if (method === "PUT") {
            if (++writes === 1) throw error;
            chosen = "aran";
          }
          const model = namedModel();
          model.area.chosen = chosen;
          return model;
        }) as DashboardRequest);
        const chooser =
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]")!;
        const pick = () =>
          chooser.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: "aran" },
              bubbles: true,
              composed: true,
            }),
          );
        pick();
        await expect.poll(() => chooser.error).toBe(message);
        await chooser.updateComplete;
        expect(chooser.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
          false,
        );
        pick();
        await expect.poll(() => chooser.value).toBe("aran");
        expect(chooser.error).toBe("");
        expect(writes).toBe(2);
        el.remove();
      }
    },
  );
});

it("ignores the retired station-hours client when no named-day client is attached", async () => {
  const watchHours = vi.fn(() => () => {});
  const el = document.createElement("hours-calendar");
  Object.assign(el, { api: { watchHours }, today: "2026-10-07" });
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  expect(watchHours).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("[data-test=date-panel]")).toBeNull();
});
