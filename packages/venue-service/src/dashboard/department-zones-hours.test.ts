import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import { VenueServiceApi } from "./client.js";
import "./department-zones.js";
import { departmentHoursModel as model } from "../testing/department-hours-fixture.js";

let el: HTMLElementTagNameMap["department-zones"];
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});
async function mount(hours: OpeningHoursModel, request?: DashboardRequest) {
  el = document.createElement("department-zones");
  el.api = new VenueServiceApi(
    request ?? ((async () => structuredClone(hours)) as DashboardRequest),
  );
  el.model = structuredClone(zonesModel);
  el.departmentId = "d1";
  el.zone = "z1";
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
}
const summary = () =>
  el.shadowRoot!.querySelector("[data-test=closed-week-summary]")?.textContent?.trim();

it("groups the Terrace's closing times by identical normal-week ranges", async () => {
  await mount(model());
  await expect
    .poll(summary)
    .toBe("Closed from 23:30 Monday to Thursday and Sunday; from 01:00 Friday and Saturday");
  expect(
    el
      .shadowRoot!.querySelector("h2")!
      .compareDocumentPosition(el.shadowRoot!.querySelector("[data-test=closed-week-summary]")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it("says the zone follows its department when its normal week has no closed ranges, ignoring named days", async () => {
  const hours = model();
  const zone = hours.departments[0]!.zones[0]!;
  zone.week = [];
  zone.dates = [{ specialDateId: "holiday", ranges: [{ startsAt: "18:00", endsAt: "06:00" }] }];
  await mount(hours);
  await expect.poll(summary).toBe("Open whenever the department is");
});
it("uses a day count when three distinct groups cannot fit the summary", async () => {
  const hours = model();
  hours.departments[0]!.zones[0]!.week = [
    { weekday: 1, ranges: [{ startsAt: "23:00", endsAt: "06:00" }] },
    { weekday: 2, ranges: [{ startsAt: "22:00", endsAt: "06:00" }] },
    { weekday: 3, ranges: [{ startsAt: "21:00", endsAt: "06:00" }] },
    { weekday: 4, ranges: [] },
  ];
  await mount(hours);
  await expect.poll(summary).toBe("Closed at some times on 3 days");
});
it("links to this zone's normal week with encoded department and zone ids", async () => {
  await mount(model());
  el.departmentId = "d/1";
  el.zone = "z/1";
  el.model = {
    ...el.model!,
    departments: [{ ...el.model!.departments[0]!, id: "d/1" }],
    zones: [{ ...el.model!.zones[0]!, departmentId: "d/1", id: "z/1" }],
  };
  await el.updateComplete;
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=zone-opening-hours]");
  expect(link?.getAttribute("href")).toBe(
    "/manage/opening-hours/view/week/department/d%2F1/zone/z%2F1",
  );
  expect(link?.textContent).toBe("Opening hours (normal week)");
});

it("localizes the grouped times and link in Spanish", async () => {
  setLocale("es-ES");
  await mount(model());
  await expect
    .poll(summary)
    .toBe("Cerrada desde 23:30 lunes a jueves y domingo; desde 01:00 viernes y sábado");
  expect(el.shadowRoot!.querySelector("[data-test=zone-opening-hours]")!.textContent).toBe(
    "Horario de apertura (semana normal)",
  );
});
it("keeps bounded and split closures distinct from closing until the day cutover", async () => {
  const hours = model();
  hours.departments[0]!.zones[0]!.week = [
    {
      weekday: 5,
      ranges: [
        { startsAt: "23:00", endsAt: "06:00" },
        { startsAt: "12:00", endsAt: "14:00" },
      ],
    },
    {
      weekday: 6,
      ranges: [
        { startsAt: "12:00", endsAt: "14:00" },
        { startsAt: "23:00", endsAt: "06:00" },
      ],
    },
    {
      weekday: 0,
      ranges: [
        { startsAt: "23:00", endsAt: "06:00" },
        { startsAt: "12:00", endsAt: "14:00" },
      ],
    },
  ];
  await mount(hours);
  await expect.poll(summary).toBe("Closed 12:00–14:00 and from 23:00 Friday to Sunday");
});
it("keeps different reopening times in separate groups", async () => {
  const hours = model();
  hours.departments[0]!.zones[0]!.week = [
    { weekday: 1, ranges: [{ startsAt: "12:00", endsAt: "14:00" }] },
    { weekday: 3, ranges: [{ startsAt: "12:00", endsAt: "15:00" }] },
  ];
  await mount(hours);
  await expect.poll(summary).toBe("Closed 12:00–14:00 Monday; 12:00–15:00 Wednesday");
});
it("selects the current zone instead of retaining the previous zone's summary", async () => {
  await mount(model());
  await expect.poll(summary).toContain("23:30");
  el.zone = "z2";
  await el.updateComplete;
  await expect.poll(summary).toBe("Open whenever the department is");
  expect(el.shadowRoot!.querySelector("[data-test=zone-opening-hours]")!.getAttribute("href")).toBe(
    "/manage/opening-hours/view/week/department/d1/zone/z2",
  );
});
it("does not claim an unknown zone is open and does not show a summary in an empty department", async () => {
  const hours = model();
  hours.departments[0]!.zones = [];
  await mount(hours);
  await el.api!.openingHours.rereadWatches();
  await el.updateComplete;
  expect(summary()).toBe("");
  el.departmentId = "d3";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=closed-week-summary]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=zone-opening-hours]")).toBeNull();
});
it("uses passive reads and refreshes the summary without resetting an unsaved service draft", async () => {
  let hours = model();
  const reads: unknown[] = [];
  await mount(hours, (async (path, method, body, options) => {
    reads.push({ path, method, body, options });
    return structuredClone(hours);
  }) as DashboardRequest);
  await expect.poll(summary).toContain("23:30");
  expect(reads).toEqual([
    {
      path: "/management-api/venue-service/opening-hours",
      method: "GET",
      body: undefined,
      options: { passive: true },
    },
  ]);
  const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  fields.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: { value: { ...fields.value, paidWhen: "ticket_then_pay" } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  hours = model();
  hours.departments[0]!.zones[0]!.week = [
    { weekday: 0, ranges: [{ startsAt: "21:00", endsAt: "06:00" }] },
  ];
  el.api!.openingHours.rereadWatches();
  await expect.poll(summary).toBe("Closed from 21:00 Sunday");
  expect(fields.value.paidWhen).toBe("ticket_then_pay");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-zone]")!
      .disabled,
  ).toBe(false);
});
it("recovers a failed hours read without clearing a save refusal", async () => {
  let failRead = true;
  await mount(model(), (async (_path, method) => {
    if (method === "PUT") throw new Error("save offline");
    if (failRead) throw new Error("read offline");
    return model();
  }) as DashboardRequest);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[role=alert]")?.textContent)
    .toBe("Opening hours could not be loaded. It will be tried again.");
  expect(summary()).toBe("");
  const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  fields.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: { value: { ...fields.value, paidWhen: "ticket_then_pay" } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-zone]")!.click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe("The change could not be saved.");
  failRead = false;
  el.api!.openingHours.rereadWatches();
  await expect.poll(summary).toContain("23:30");
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "The change could not be saved.",
  );
});
it("detaches on removal and ignores a late answer after reconnecting with another API", async () => {
  let answer!: (model: OpeningHoursModel) => void;
  const oldApi = new VenueServiceApi(
    (() =>
      new Promise<OpeningHoursModel>((resolve) => {
        answer = resolve;
      })) as DashboardRequest,
  );
  await mount(model());
  el.api = oldApi;
  await el.updateComplete;
  expect(summary()).toBe("");
  el.remove();
  const hours = model();
  hours.departments[0]!.zones[0]!.week = [];
  el.api = new VenueServiceApi((async () => hours) as DashboardRequest);
  document.body.append(el);
  await el.updateComplete;
  await expect.poll(summary).toBe("Open whenever the department is");
  answer(model());
  await Promise.resolve();
  await el.updateComplete;
  expect(summary()).toBe("Open whenever the department is");
});

it("stops a connected component's previous API watch before a late read answers", async () => {
  let answer!: (hours: OpeningHoursModel) => void;
  const pending = new Promise<OpeningHoursModel>((resolve) => {
    answer = resolve;
  });
  let initial = true;
  await mount(model(), (() => {
    if (initial) {
      initial = false;
      return Promise.resolve(model());
    }
    return pending;
  }) as DashboardRequest);
  await expect.poll(summary).toContain("23:30");
  el.api!.openingHours.rereadWatches();
  el.api = new VenueServiceApi(
    (() => new Promise<OpeningHoursModel>(() => {})) as DashboardRequest,
  );
  await el.updateComplete;
  expect(summary()).toBe("");
  const changed = model();
  changed.departments[0]!.zones[0]!.week = [
    { weekday: 0, ranges: [{ startsAt: "21:00", endsAt: "06:00" }] },
  ];
  answer(changed);
  await pending;
  await el.updateComplete;
  expect(summary()).toBe("");
});
