import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import type { WtButton, WtInput, WtFormActions } from "@waitron/ui";
import type {
  DashboardApi,
  BusinessDayClockModel,
  BusinessDayStartInput,
  BusinessDayStartPreview,
} from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale } from "../i18n/t.js";
import "./business-day-start-editor.js";

type Editor = LitElement & { api: DashboardApi; model: BusinessDayClockModel; readOnly: boolean };
export const clockModel = (): BusinessDayClockModel => ({
  clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
  revision: 4,
  currentBusinessDay: "2026-11-01",
  pending: null,
});
const waitingModel = (): BusinessDayClockModel => ({
  clock: {
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    cutoverChanges: [{ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00" }],
  },
  revision: 4,
  currentBusinessDay: "2026-10-20",
  pending: {
    effectiveBusinessDay: "2026-10-21",
    dayCutover: "03:00",
    startsAt: "2026-10-21T01:00:00.000Z",
  },
});
const twoWaitingModel = (): BusinessDayClockModel => ({
  clock: {
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    cutoverChanges: [
      { effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" },
      { effectiveBusinessDay: "2026-10-22", dayCutover: "10:00" },
    ],
  },
  revision: 5,
  currentBusinessDay: "2026-10-20",
  pending: {
    effectiveBusinessDay: "2026-10-21",
    dayCutover: "21:00",
    startsAt: "2026-10-21T19:00:00.000Z",
  },
});
export const preview = (revision = 4): BusinessDayStartPreview => ({
  revision,
  previousDay: {
    businessDay: "2026-11-03",
    dayCutover: "05:00:00",
    startAt: "2026-11-03T04:00:00.000Z",
    endAt: "2026-11-04T02:00:00.000Z",
  },
  effectiveDay: {
    businessDay: "2026-11-04",
    dayCutover: "03:00:00",
    startAt: "2026-11-04T02:00:00.000Z",
    endAt: "2026-11-05T02:00:00.000Z",
  },
  conflicts: [],
  conflictCount: 0,
  backupDeadlines: { archive: null, cloud: null },
});
const q = <T extends HTMLElement = HTMLElement>(el: Editor, sel: string) =>
  el.shadowRoot!.querySelector<T>(sel);
const save = (el: Editor) => q<WtButton>(el, "[data-test=save]")!;
const flush = async (el: Editor) => {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim();
const cardLabels = (el: Editor) =>
  [...el.shadowRoot!.querySelectorAll("section.settings-card dt")].map((label) => text(label));
const newStarts = (el: Editor) =>
  [...el.shadowRoot!.querySelectorAll("[data-test=saved-new-start]")].map((row) => [
    text(row.querySelector("[data-test=new-start-value]")),
    text(row.querySelector("[data-test=day-length]")),
  ]);
const click = async (el: Editor, action: string) => {
  q(el, `[data-test=${action}]`)!.click();
  await flush(el);
};
const change = async (el: Editor, name: string, value: string) => {
  q(el, `[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await flush(el);
};
function deferred<T>() {
  let resolve!: (x: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function rig(overrides: Partial<DashboardApi> = {}, model = clockModel(), readOnly = false) {
  const writes: BusinessDayStartInput[] = [];
  const api = {
    liveData: { invalidate: vi.fn() },
    previewBusinessDayStart: vi.fn(async () => preview()),
    putBusinessDayStart: async (input: BusinessDayStartInput) => {
      writes.push(input);
      return { changed: true, model: venueDetailsFixture() };
    },
    ...overrides,
  } as unknown as DashboardApi;
  const { el } = await mountWidget<Editor>("dashboard-business-day-start-editor", {
    api,
    model,
    readOnly,
  });
  await flush(el);
  return { el, api, writes };
}
async function ready(el: Editor) {
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  await expect.poll(() => q(el, "[data-test=preview]")).toBeTruthy();
}
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("es-ES");
});
it("keeps Save quiet until a matching preview arrives and sends its date/time/revision", async () => {
  setLocale("en-GB");
  const pending = deferred<BusinessDayStartPreview>();
  const { el, writes } = await rig({ previewBusinessDayStart: async () => pending.promise });
  await click(el, "change");
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  expect(q<WtInput>(el, "[name=dayCutover]")!.required).toBe(true);
  await change(el, "dayCutover", "03:00");
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  pending.resolve(preview());
  await flush(el);
  expect(q(el, "[data-test=day-runs]")!.textContent).toContain("22 h");
  expect(text(q(el, "[data-test=preview] strong"))).toBe("Wed 4 Nov, 03:00");
  expect(save(el).disabled).toBe(false);
  expect(save(el).variant).toBe("primary");
  await click(el, "save");
  expect(writes).toEqual([
    { effectiveBusinessDay: "2026-11-04", dayCutover: "03:00", expectedClockRevision: 4 },
  ]);
  expect(q(el, "wt-form-actions")).toBeNull();
});
it("ignores a late preview for the previous draft", async () => {
  const old = deferred<BusinessDayStartPreview>();
  const newer = deferred<BusinessDayStartPreview>();
  let calls = 0;
  const { el } = await rig({
    previewBusinessDayStart: async () => (++calls === 1 ? old.promise : newer.promise),
  });
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  await change(el, "dayCutover", "04:00");
  old.resolve(preview());
  await flush(el);
  expect(q(el, "[data-test=preview]")).toBeNull();
  expect(save(el).disabled).toBe(true);
  newer.resolve({
    ...preview(),
    effectiveDay: { ...preview().effectiveDay, dayCutover: "04:00:00" },
  });
  await flush(el);
  expect(save(el).disabled).toBe(false);
});
it("refuses a wrong revision preview and preserves the opening revision through live changes", async () => {
  const { el } = await rig({ previewBusinessDayStart: async () => preview(5) });
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  expect(save(el).disabled).toBe(true);
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
  el.model = { ...clockModel(), revision: 5 };
  await flush(el);
  expect(q<WtInput>(el, "[name=dayCutover]")!.value).toBe("03:00");
  expect(save(el).disabled).toBe(true);
});
it("invalidates a ready preview on draft or live-clock change", async () => {
  const { el } = await rig();
  await ready(el);
  expect(save(el).disabled).toBe(false);
  el.model = { ...clockModel(), revision: 5 };
  await flush(el);
  expect(save(el).disabled).toBe(true);
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBeTruthy();
});
it("marks missing and malformed values beside each field and at the bottom", async () => {
  const { el } = await rig();
  await click(el, "change");
  await change(el, "dayCutover", "bad");
  await click(el, "save");
  expect(q<WtInput>(el, "[name=dayCutover]")!.error).toBeTruthy();
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBeTruthy();
  expect(save(el).disabled).toBe(true);
});
it("keeps a refused save retryable and preserves its action message through model refresh", async () => {
  let attempts = 0;
  const { el } = await rig({
    putBusinessDayStart: async () => {
      if (++attempts === 1) throw { code: "connection.failed" };
      return { changed: true, model: venueDetailsFixture() };
    },
  });
  await ready(el);
  await click(el, "save");
  const error = q<WtFormActions>(el, "wt-form-actions")!.error;
  expect(error).toBeTruthy();
  expect(save(el).disabled).toBe(false);
  el.model = structuredClone(el.model);
  await flush(el);
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(error);
  await click(el, "save");
  expect(attempts).toBe(2);
  expect(q(el, "wt-form-actions")).toBeNull();
});
it("shows a server field refusal without disabling a retry", async () => {
  const { el } = await rig({
    putBusinessDayStart: async () => {
      throw {
        code: "venue.business_day_invalid",
        params: { field: "dayCutover", reason: "changeover_passed" },
      };
    },
  });
  await ready(el);
  await click(el, "save");
  expect(q<WtInput>(el, "[name=dayCutover]")!.error).toBeTruthy();
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBeTruthy();
  expect(save(el).disabled).toBe(false);
});
it("shows schedule conflicts and keeps Save disabled", async () => {
  const { el } = await rig({
    previewBusinessDayStart: async () => ({
      ...preview(),
      conflicts: [{ departmentId: "dept", weekday: 1, rangeIndex: 0, reason: "range" }],
      conflictCount: 1,
    }),
  });
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  expect(q(el, "[data-test=conflicts]")?.textContent).toContain("1");
  expect(q(el, "[data-test=conflicts] a")?.getAttribute("href")).toBe("/manage/opening-hours");
  expect(save(el).disabled).toBe(true);
});
it("offers only Change start while a change waits, and opens the dialog from it", async () => {
  const { el } = await rig({}, waitingModel());
  expect(
    [...el.shadowRoot!.querySelectorAll("section.settings-card wt-button")].map((b) =>
      b.getAttribute("data-test"),
    ),
  ).toEqual(["change"]);
  await click(el, "change");
  expect(q<WtInput>(el, "[name=dayCutover]")!.value).toBe("03:00");
});
it("read-only mode shows the start and every waiting change without a button", async () => {
  setLocale("en-GB");
  const { el } = await rig({}, twoWaitingModel(), true);
  expect(cardLabels(el)).toEqual(["Starts at", "New start", "New start"]);
  expect(q(el, "wt-button")).toBeNull();
});
it("read-only mode shows current and pending status without actions or fields", async () => {
  const { el } = await rig({}, clockModel(), true);
  expect(el.shadowRoot!.textContent).toContain("05:00");
  expect(q(el, "wt-button")).toBeNull();
  expect(q(el, "wt-input")).toBeNull();
});

it("shows identifying conflict rows with localized reasons while keeping the total and Save disabled", async () => {
  setLocale("en-GB");
  const { el } = await rig({
    previewBusinessDayStart: async () => ({
      ...preview(),
      conflictCount: 23,
      conflicts: [
        {
          departmentId: "dept",
          departmentName: "Restaurant",
          zoneId: "zone",
          zoneName: "Terrace",
          date: "2026-11-04",
          specialDayId: "special",
          specialDayName: "Festival",
          periodId: "period",
          periodName: "Dinner",
          startsAt: "22:00",
          endsAt: "04:30",
          rangeIndex: 0,
          reason: "endpoint_day",
        },
      ],
    }),
  });
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  const rows = q(el, "[data-test=conflict-rows]");
  expect(rows?.textContent).toContain("Restaurant");
  expect(rows?.textContent).toContain("Terrace");
  expect(rows?.textContent).toContain("Festival");
  expect(rows?.textContent).toContain("2026-11-04");
  expect(rows?.textContent).toContain("Dinner");
  expect(rows?.textContent).toContain("22:00–04:30");
  expect(rows?.textContent).toContain("Moves to another day");
  expect(q(el, "[data-test=conflicts]")?.textContent).toContain("23");
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
  expect(save(el).disabled).toBe(true);
});

it("shows a range clashing in four seasons as one line", async () => {
  setLocale("en-GB");
  const { el } = await rig({
    previewBusinessDayStart: async () => ({
      ...preview(),
      conflictCount: 2,
      conflicts: [
        ...["spring", "summer", "autumn", "winter"].map((seasonId) => ({
          departmentId: "d",
          departmentName: "Restaurant",
          weekday: 3,
          seasonId,
          periodId: "p",
          periodName: "Dinner",
          startsAt: "22:00",
          endsAt: "04:30",
          rangeIndex: 0,
          reason: "endpoint_day" as const,
        })),
        {
          departmentId: "d",
          departmentName: "Restaurant",
          weekday: 4,
          seasonId: "winter",
          periodId: "p",
          periodName: "Dinner",
          startsAt: "22:00",
          endsAt: "04:30",
          rangeIndex: 0,
          reason: "endpoint_day" as const,
        },
      ],
    }),
  });
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  const lines = [...el.shadowRoot!.querySelectorAll("[data-test=conflict-rows] li")].map(
    (line) => line.textContent,
  );
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("Wed");
  expect(lines[1]).toContain("Thu");
  expect(q(el, "[data-test=conflicts]")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
    "Opening hours that clash with the new start: 2. Review opening hours",
  );
});

it.each([
  [0, "Sun"],
  [1, "Mon"],
  [6, "Sat"],
])("labels weekly conflicts using calendar weekday %s", async (weekday, label) => {
  setLocale("en-GB");
  const { el } = await rig({
    previewBusinessDayStart: async () => ({
      ...preview(),
      conflictCount: 1,
      conflicts: [
        {
          departmentId: "d",
          departmentName: "Restaurant",
          weekday,
          rangeIndex: 0,
          reason: "range",
        },
      ],
    }),
  });
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  expect(q(el, "[data-test=conflict-rows]")?.textContent).toContain(label);
});

it("retains a refused write message when a passive clock replacement invalidates its preview", async () => {
  const { el } = await rig({
    putBusinessDayStart: async () => {
      throw { code: "connection.failed" };
    },
  });
  await ready(el);
  await click(el, "save");
  const refusal = q<WtFormActions>(el, "wt-form-actions")!.error;
  expect(refusal).toBeTruthy();
  el.model = { ...clockModel(), revision: 5 };
  await flush(el);
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(refusal);
  expect(save(el).disabled).toBe(true);
  expect(q<WtInput>(el, "[name=dayCutover]")!.value).toBe("03:00");
});

it("presents preview boundaries on the venue clock", async () => {
  setLocale("en-GB");
  const { el } = await rig();
  await ready(el);
  expect(text(q(el, "[data-test=day-runs]"))).toBe(
    "Business day Tue 3 Nov runs 05:00 → 03:00: 22 h.",
  );
  expect(q(el, "[data-test=preview]")!.textContent).not.toContain(".000Z");
});

const seasonConflict = (seasonName: string | undefined, rangeIndex = 0) => ({
  departmentId: "d",
  departmentName: "Restaurant",
  weekday: 1,
  ...(seasonName === undefined ? {} : { seasonId: seasonName.toLowerCase(), seasonName }),
  periodId: "p",
  periodName: "Dinner",
  startsAt: "22:00",
  endsAt: "04:30",
  rangeIndex,
  reason: "endpoint_day" as const,
});
async function conflictLines(
  conflicts: BusinessDayStartPreview["conflicts"],
  conflictCount: number,
): Promise<{ lines: (string | null)[]; count: string | undefined }> {
  const { el } = await rig({
    previewBusinessDayStart: async () => ({ ...preview(), conflicts, conflictCount }),
  });
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  return {
    lines: [...el.shadowRoot!.querySelectorAll("[data-test=conflict-rows] li")].map(
      (line) => line.textContent,
    ),
    count: q(el, "[data-test=conflicts]")?.textContent?.replace(/\s+/g, " ").trim(),
  };
}

it.each([
  ["en-GB", "Mon · Dinner · 22:00–04:30 · Moves to another day"],
  ["es-ES", "Lun · Dinner · 22:00–04:30 · Pasa a otro día"],
])("puts the season's name before a season conflict's line (%s)", async (locale, rest) => {
  setLocale(locale);
  const { lines } = await conflictLines([seasonConflict("Winter")], 1);
  expect(lines).toEqual([`Winter: Restaurant · ${rest}`]);
});

it.each([
  ["en-GB", "2026-11-20 · Dinner · 22:00–04:30 · Moves to another day"],
  ["es-ES", "2026-11-20 · Dinner · 22:00–04:30 · Pasa a otro día"],
])("puts the special day's name before its conflict's line (%s)", async (locale, rest) => {
  setLocale(locale);
  const conflict = { ...seasonConflict(undefined), weekday: undefined };
  const { lines } = await conflictLines(
    [{ ...conflict, specialDayId: "sd", specialDayName: "Fiesta", date: "2026-11-20" }],
    1,
  );
  expect(lines).toEqual([`Fiesta: Restaurant · ${rest}`]);
});

it("leaves a conflict without a season as it was", async () => {
  setLocale("en-GB");
  const { lines } = await conflictLines([seasonConflict(undefined)], 1);
  expect(lines).toEqual(["Restaurant · Mon · Dinner · 22:00–04:30 · Moves to another day"]);
});

it("counts the distinct lines it shows", async () => {
  setLocale("en-GB");
  const sameSeason = await conflictLines(
    [seasonConflict("Winter", 0), seasonConflict("Winter", 1)],
    2,
  );
  expect(sameSeason.lines).toHaveLength(1);
  expect(sameSeason.count).toBe(
    "Opening hours that clash with the new start: 1. Review opening hours",
  );
  const twoSeasons = await conflictLines([seasonConflict("Winter"), seasonConflict("Autumn")], 1);
  expect(twoSeasons.lines).toHaveLength(2);
  expect(twoSeasons.count).toBe(
    "Opening hours that clash with the new start: 2. Review opening hours",
  );
});

const cardRows = (el: Editor) =>
  [...el.shadowRoot!.querySelectorAll("section.settings-card dt")].map(
    (label) =>
      `${label.textContent!.trim()} ${label.nextElementSibling!.textContent!.replace(/\s+/g, " ").trim()}`,
  );
it.each([
  ["en-GB", "Business day", ["Starts at 05:00"]],
  ["es", "Día de trabajo", ["Empieza a las 05:00"]],
])(
  "draws its own card with the start once and no time zone (%s)",
  async (locale, heading, rows) => {
    setLocale(locale);
    const { el } = await rig();
    const card = q(el, "section.settings-card")!;
    expect(card.querySelector("h2")!.textContent!.trim()).toBe(heading);
    expect(cardRows(el)).toEqual(rows);
    expect(card.textContent).not.toContain("Europe/Madrid");
    expect(q(el, "h3")).toBeNull();
    expect(q(el, "[data-test=change]")!.closest("header")?.parentElement).toBe(card);
  },
);
it.each([
  ["en-GB", "03:00, from Wed 21 Oct, 03:00", "Business day Tue 20 Oct lasts 22 h."],
  ["es-ES", "03:00, desde mié 21 oct, 03:00", "El día de trabajo mar 20 oct dura 22 h."],
])(
  "shows a waiting change as a New start row with its moment and day length (%s)",
  async (locale, value, length) => {
    setLocale(locale);
    const { el } = await rig({}, waitingModel());
    expect(cardLabels(el)).toEqual([
      locale === "es-ES" ? "Empieza a las" : "Starts at",
      locale === "es-ES" ? "Nuevo inicio" : "New start",
    ]);
    expect(text(q(el, "[data-test=saved-dayCutover]"))).toBe("05:00");
    expect(newStarts(el)).toEqual([[value, length]]);
    const card = q(el, "section.settings-card")!;
    expect(q(el, "[data-test=change]")!.closest("header")?.parentElement).toBe(card);
    expect(q(el, "[data-test=replace]")).toBeNull();
    expect(q(el, "[data-test=cancel-pending]")).toBeNull();
  },
);
it("shows one New start row per waiting change after a Save while one already waits", async () => {
  setLocale("en-GB");
  const { el } = await rig({}, twoWaitingModel());
  expect(cardLabels(el)).toEqual(["Starts at", "New start", "New start"]);
  expect(newStarts(el)).toEqual([
    ["21:00, from Wed 21 Oct, 21:00", "Business day Tue 20 Oct lasts 40 h."],
    ["10:00, from Thu 22 Oct, 10:00", "Business day Wed 21 Oct lasts 13 h."],
  ]);
});
it("does not show a change already in force as waiting", async () => {
  setLocale("en-GB");
  const model = waitingModel();
  const { el } = await rig({}, { ...model, currentBusinessDay: "2026-10-21", pending: null });
  expect(cardLabels(el)).toEqual(["Starts at"]);
  expect(text(q(el, "[data-test=saved-dayCutover]"))).toBe("03:00");
});
it("re-reads the venue details passively at the waiting change's moment", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-21T00:59:00.000Z"));
    const getVenueDetails = vi.fn();
    const { el, api } = await rig({ getVenueDetails } as Partial<DashboardApi>, waitingModel());
    const invalidate = api.liveData.invalidate as ReturnType<typeof vi.fn>;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invalidate.mock.calls).toEqual([[[{ type: "location_day_cutover_changes" }]]]);
    expect(getVenueDetails).not.toHaveBeenCalled();
    el.remove();
  } finally {
    vi.useRealTimers();
  }
});
it("schedules no re-read for a change too far ahead for one timer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const model = waitingModel();
    const far = {
      ...model,
      clock: {
        ...model.clock,
        cutoverChanges: [{ effectiveBusinessDay: "2027-08-17", dayCutover: "03:00" }],
      },
      pending: {
        effectiveBusinessDay: "2027-08-17",
        dayCutover: "03:00",
        startsAt: "2027-08-17T01:00:00.000Z",
      },
    };
    const { api } = await rig({}, far);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.liveData.invalidate).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("clears the re-read when the card leaves the page or the model changes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-21T00:59:00.000Z"));
    const { el, api } = await rig({}, waitingModel());
    expect(vi.getTimerCount()).toBe(1);
    el.model = clockModel();
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(0);
    el.model = waitingModel();
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(1);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.liveData.invalidate).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

const dayModel = (currentBusinessDay = "2026-10-20"): BusinessDayClockModel => ({
  clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
  revision: 4,
  currentBusinessDay,
  pending: null,
});
const changeoverPreview = (
  previousDay: BusinessDayStartPreview["previousDay"],
  conflicts: BusinessDayStartPreview["conflicts"] = [],
): BusinessDayStartPreview => ({
  revision: 4,
  previousDay,
  effectiveDay: {
    businessDay: "2026-10-21",
    dayCutover: "03:00",
    startAt: previousDay.endAt,
    endAt: "2026-10-22T01:00:00.000Z",
  },
  conflicts,
  conflictCount: conflicts.length,
  backupDeadlines: { archive: null, cloud: null },
});
const tonight: BusinessDayStartPreview["previousDay"] = {
  businessDay: "2026-10-20",
  dayCutover: "05:00",
  startAt: "2026-10-20T03:00:00.000Z",
  endAt: "2026-10-21T01:00:00.000Z",
};
async function previewLines(answer: BusinessDayStartPreview, model = dayModel()) {
  const previewBusinessDayStart = vi.fn(async () => answer);
  const { el } = await rig({ previewBusinessDayStart }, model);
  await click(el, "change");
  expect(previewBusinessDayStart).not.toHaveBeenCalled();
  await change(el, "dayCutover", "03:00");
  await expect.poll(() => q(el, "[data-test=preview]")).toBeTruthy();
  return {
    el,
    calls: previewBusinessDayStart.mock.calls,
    lines: [...q(el, "[data-test=preview]")!.querySelectorAll("p, li")].map((line) => text(line)),
  };
}
it("previews when the change takes effect and how long today's business day runs", async () => {
  setLocale("en-GB");
  const { el, calls, lines } = await previewLines(changeoverPreview(tonight));
  expect(calls).toEqual([[{ dayCutover: "03:00", expectedClockRevision: 4 }]]);
  expect(q<WtInput>(el, "[name=effectiveBusinessDay]")).toBeNull();
  expect(lines).toEqual([
    "Changes at the next changeover: Wed 21 Oct, 03:00.",
    "Today's business day (Tue 20 Oct) runs 05:00 → 03:00: 22 h.",
    "Earlier reports keep their days.",
  ]);
  expect(text(q(el, "[data-test=preview] strong"))).toBe("Wed 21 Oct, 03:00");
});
it("names the business day by its date when it is not today's", async () => {
  setLocale("en-GB");
  const { lines } = await previewLines(
    changeoverPreview({
      businessDay: "2026-10-21",
      dayCutover: "05:00",
      startAt: "2026-10-21T03:00:00.000Z",
      endAt: "2026-10-21T22:30:00.000Z",
    }),
  );
  expect(lines[1]).toBe("Business day Wed 21 Oct runs 05:00 → 00:30: 19 h 30 min.");
});
it("counts the hour the clocks go back in the day's length", async () => {
  setLocale("en-GB");
  const { lines } = await previewLines(
    changeoverPreview({
      businessDay: "2026-10-24",
      dayCutover: "05:00",
      startAt: "2026-10-24T03:00:00.000Z",
      endAt: "2026-10-25T02:00:00.000Z",
    }),
    dayModel("2026-10-24"),
  );
  expect(lines[1]).toBe("Today's business day (Sat 24 Oct) runs 05:00 → 03:00: 23 h.");
});
const allYear = (weekday: number, endsAt: string) => ({
  departmentId: "d",
  departmentName: "Restaurant",
  weekday,
  seasonId: "all",
  seasonName: "All year",
  periodId: "p",
  periodName: "Dinner",
  startsAt: "21:00",
  endsAt,
  rangeIndex: 0,
  reason: "range" as const,
});
const keptOpen = {
  departmentId: "d",
  departmentName: "Restaurant",
  periodId: "p",
  periodName: "Dinner",
  endsAt: "04:30",
  rangeIndex: 0,
  reason: "kept_open" as const,
};
it("lists the opening hours that clash with the new start, season first", async () => {
  setLocale("en-GB");
  const { el, lines } = await previewLines(
    changeoverPreview(tonight, [allYear(5, "04:00"), allYear(6, "04:30")]),
  );
  expect(text(q(el, "[data-test=conflicts]"))).toBe(
    "Opening hours that clash with the new start: 2. Review opening hours",
  );
  expect(lines.slice(-2)).toEqual([
    "All year: Restaurant · Fri · Dinner · 21:00–04:00 · Crosses the new start",
    "All year: Restaurant · Sat · Dinner · 21:00–04:30 · Crosses the new start",
  ]);
});
it("says until when a period is kept open tonight, without a range", async () => {
  setLocale("en-GB");
  const { lines } = await previewLines(changeoverPreview(tonight, [keptOpen]));
  expect(lines.at(-1)).toBe("Restaurant · Dinner · Kept open until 04:30 tonight");
});
it.each([
  ["range", "Crosses the new start", "Cruza el nuevo inicio"],
  ["overlap", "Invalid or overlapping range", "Tramo inválido o solapado"],
  ["endpoint_day", "Moves to another day", "Pasa a otro día"],
] as const)("labels a %s clash in English and Spanish", async (reason, en, es) => {
  for (const [locale, label] of [
    ["en-GB", en],
    ["es-ES", es],
  ]) {
    setLocale(locale);
    const { lines } = await previewLines(
      changeoverPreview(tonight, [{ ...allYear(5, "04:00"), reason }]),
    );
    expect(lines.at(-1)?.split(" · ").at(-1)).toBe(label);
    cleanupWidgets();
  }
});
it("previews in Spanish", async () => {
  setLocale("es-ES");
  const { el, lines } = await previewLines(
    changeoverPreview(tonight, [allYear(5, "04:00"), keptOpen]),
  );
  expect(lines).toEqual([
    "Cambia en el próximo cambio de día: mié 21 oct, 03:00.",
    "El día de trabajo de hoy (mar 20 oct) va de 05:00 a 03:00: 22 h.",
    "Los informes anteriores conservan sus días.",
    "Horarios que chocan con el nuevo inicio: 2. Revisar horarios",
    "All year: Restaurant · Vie · Dinner · 21:00–04:00 · Cruza el nuevo inicio",
    "Restaurant · Dinner · Abierto hasta las 04:30 esta noche",
  ]);
  expect(q<WtInput>(el, "[name=dayCutover]")!.label).toBe("El día de trabajo empieza a las");
});
it("names a day that is not today's in Spanish", async () => {
  setLocale("es-ES");
  const { lines } = await previewLines(
    changeoverPreview({
      businessDay: "2026-10-21",
      dayCutover: "05:00",
      startAt: "2026-10-21T03:00:00.000Z",
      endAt: "2026-10-21T22:30:00.000Z",
    }),
  );
  expect(lines[1]).toBe("El día de trabajo mié 21 oct va de 05:00 a 00:30: 19 h 30 min.");
});

const october = (): BusinessDayClockModel => ({
  ...clockModel(),
  currentBusinessDay: "2026-10-20",
});
const octoberPreview = (): BusinessDayStartPreview => ({
  revision: 4,
  previousDay: {
    businessDay: "2026-10-20",
    dayCutover: "05:00:00",
    startAt: "2026-10-20T03:00:00.000Z",
    endAt: "2026-10-21T01:00:00.000Z",
  },
  effectiveDay: {
    businessDay: "2026-10-21",
    dayCutover: "03:00:00",
    startAt: "2026-10-21T01:00:00.000Z",
    endAt: "2026-10-22T01:00:00.000Z",
  },
  conflicts: [],
  conflictCount: 0,
  backupDeadlines: { archive: null, cloud: null },
});
it("saves for the changeover a ready 05:00 → 03:00 preview showed, with no acknowledgement", async () => {
  const { el, writes } = await rig(
    { previewBusinessDayStart: async () => octoberPreview() },
    october(),
  );
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  await expect.poll(() => q(el, "[data-test=preview]")).toBeTruthy();
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
  await click(el, "save");
  expect(writes).toEqual([
    { effectiveBusinessDay: "2026-10-21", dayCutover: "03:00", expectedClockRevision: 4 },
  ]);
});
it("keeps Save quiet and disabled while the preview lists clashes", async () => {
  const { el, writes } = await rig(
    {
      previewBusinessDayStart: async () => ({
        ...octoberPreview(),
        conflicts: [{ departmentId: "d", weekday: 1, rangeIndex: 0, reason: "range" }],
        conflictCount: 1,
      }),
    },
    october(),
  );
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  await expect.poll(() => q(el, "[data-test=conflicts]")).toBeTruthy();
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
  expect(save(el).variant).toBe("secondary");
  expect(save(el).disabled).toBe(true);
  q<HTMLFormElement>(el, "form")!.requestSubmit();
  await flush(el);
  expect(writes).toEqual([]);
});
const refusing = (params: Record<string, unknown>) => ({
  putBusinessDayStart: async () => {
    throw { code: "venue.business_day_invalid", params: { field: "dayCutover", ...params } };
  },
});
it.each([
  ["en-GB", "That changeover has just passed. Check the new time and save again."],
  ["es-ES", "Ese cambio de día acaba de pasar. Revisa la nueva hora y vuelve a guardar."],
])(
  "names a changeover that passed during Save in %s and previews again",
  async (locale, message) => {
    setLocale(locale);
    const later = deferred<BusinessDayStartPreview>();
    const previews = vi.fn(async () =>
      previews.mock.calls.length === 1 ? octoberPreview() : later.promise,
    );
    const writes: BusinessDayStartInput[] = [];
    const { el } = await rig(
      {
        previewBusinessDayStart: previews,
        putBusinessDayStart: async (input: BusinessDayStartInput) => {
          writes.push(input);
          if (writes.length === 1)
            throw {
              code: "venue.business_day_invalid",
              params: { field: "dayCutover", reason: "changeover_passed" },
            };
          return { changed: true, model: venueDetailsFixture() };
        },
      },
      october(),
    );
    await ready(el);
    expect(previews).toHaveBeenCalledTimes(1);
    await click(el, "save");
    expect(q<WtInput>(el, "[name=dayCutover]")!.error).toBe(message);
    expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(message);
    expect(previews).toHaveBeenCalledTimes(2);
    expect(q<WtInput>(el, "[name=dayCutover]")!.value).toBe("03:00");
    expect(save(el).variant).toBe("secondary");
    expect(save(el).disabled).toBe(true);
    later.resolve({
      ...octoberPreview(),
      previousDay: { ...octoberPreview().previousDay, businessDay: "2026-10-21" },
      effectiveDay: { ...octoberPreview().effectiveDay, businessDay: "2026-10-22" },
    });
    await flush(el);
    expect(save(el).variant).toBe("primary");
    expect(save(el).disabled).toBe(false);
    await click(el, "save");
    expect(writes.map((write) => write.effectiveBusinessDay)).toEqual(["2026-10-21", "2026-10-22"]);
  },
);
it.each([
  ["en-GB", "The clocks change on Sun 25 Oct. Save again from Mon 26 Oct, 02:30."],
  ["es-ES", "La hora oficial cambia el dom 25 oct. Vuelve a guardar desde lun 26 oct, 02:30."],
])("says when a Save will work after the clocks change in %s", async (locale, message) => {
  setLocale(locale);
  const { el } = await rig(
    {
      previewBusinessDayStart: async () => octoberPreview(),
      ...refusing({
        reason: "clock_transition",
        clocksChangeOn: "2026-10-25",
        saveFrom: "2026-10-26T01:30:00.000Z",
      }),
    },
    october(),
  );
  await ready(el);
  await click(el, "save");
  expect(q<WtInput>(el, "[name=dayCutover]")!.error).toBe(message);
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(message);
});
it("puts a preview refusal naming the time under the field, without Retry", async () => {
  setLocale("en-GB");
  const { el } = await rig(
    {
      previewBusinessDayStart: async () => {
        throw {
          code: "venue.business_day_invalid",
          params: {
            field: "dayCutover",
            reason: "clock_transition",
            clocksChangeOn: "2026-10-25",
            saveFrom: "2026-10-26T01:30:00.000Z",
          },
        };
      },
    },
    october(),
  );
  await click(el, "change");
  await change(el, "dayCutover", "02:30");
  const message = "The clocks change on Sun 25 Oct. Save again from Mon 26 Oct, 02:30.";
  await expect.poll(() => q<WtInput>(el, "[name=dayCutover]")!.error).toBe(message);
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(message);
  expect(q(el, "[data-test=preview-retry]")).toBeNull();
  expect(save(el).disabled).toBe(true);
  await change(el, "dayCutover", "02:45");
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(message);
  await change(el, "dayCutover", "05:00");
  expect(q<WtInput>(el, "[name=dayCutover]")!.error).toBe("");
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe("");
});
it("says the clock changed when it changes under a preview refused over the time", async () => {
  setLocale("en-GB");
  const { el } = await rig(
    {
      previewBusinessDayStart: async () => {
        throw {
          code: "venue.business_day_invalid",
          params: {
            field: "dayCutover",
            reason: "clock_transition",
            clocksChangeOn: "2026-10-25",
            saveFrom: "2026-10-26T01:30:00.000Z",
          },
        };
      },
    },
    october(),
  );
  await click(el, "change");
  await change(el, "dayCutover", "02:30");
  await expect.poll(() => q<WtInput>(el, "[name=dayCutover]")!.error).toBeTruthy();
  const changed = "The business-day clock changed. Close and reopen to review it.";
  el.model = {
    ...october(),
    clock: {
      ...october().clock,
      cutoverChanges: [{ effectiveBusinessDay: "2026-10-22", dayCutover: "04:00" }],
    },
  };
  await flush(el);
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(changed);
  expect(q<WtInput>(el, "[name=dayCutover]")!.error).toBe("");
  await change(el, "dayCutover", "02:45");
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBe(changed);
  expect(save(el).disabled).toBe(true);
});
it("offers Retry when a preview fails without naming a field", async () => {
  setLocale("en-GB");
  const { el } = await rig(
    {
      previewBusinessDayStart: async () => {
        throw { code: "connection.failed" };
      },
    },
    october(),
  );
  await click(el, "change");
  await change(el, "dayCutover", "03:00");
  await expect.poll(() => q(el, "[data-test=preview-retry]")).toBeTruthy();
  expect(q<WtInput>(el, "[name=dayCutover]")!.error).toBe("");
});
it("puts Cancel and Save in the dialog's footer, so a long clash list cannot scroll them away", async () => {
  const { el } = await rig();
  await click(el, "change");
  const actions = q<WtFormActions>(el, "wt-form-actions")!;
  expect(actions.slot).toBe("footer");
  expect(actions.parentElement!.tagName).toBe("WT-DIALOG");
});
