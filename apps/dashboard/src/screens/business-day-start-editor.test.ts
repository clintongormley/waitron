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
  locksAt: "2026-11-03T04:00:00.000Z",
  conflicts: [],
  conflictCount: 0,
  backupDeadlines: { archive: null, cloud: null },
});
const q = <T extends HTMLElement = HTMLElement>(el: Editor, sel: string) =>
  el.shadowRoot!.querySelector<T>(sel);
const save = (el: Editor) => q<WtButton>(el, "[data-test=save]")!;
const flush = async (el: Editor) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};
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
  const cancels: number[] = [];
  const api = {
    previewBusinessDayStart: vi.fn(async () => preview()),
    putBusinessDayStart: async (input: BusinessDayStartInput) => {
      writes.push(input);
      return { changed: true, model: venueDetailsFixture() };
    },
    cancelBusinessDayStart: async (input: { expectedClockRevision: number }) => {
      cancels.push(input.expectedClockRevision);
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
  return { el, api, writes, cancels };
}
async function ready(el: Editor) {
  await click(el, "change");
  await change(el, "effectiveBusinessDay", "2026-11-04");
  await change(el, "dayCutover", "03:00");
  await expect.poll(() => q(el, "[data-test=preview]")).toBeTruthy();
  await click(el, "acknowledge");
}
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("es-ES");
});
it("keeps Save quiet until a matching preview is acknowledged and sends its date/time/revision", async () => {
  const { el, writes } = await rig();
  await click(el, "change");
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  expect(q<WtInput>(el, "[name=effectiveBusinessDay]")!.required).toBe(true);
  expect(q<WtInput>(el, "[name=dayCutover]")!.required).toBe(true);
  await change(el, "effectiveBusinessDay", "2026-11-04");
  await change(el, "dayCutover", "03:00");
  expect(save(el).disabled).toBe(true);
  expect(q(el, "[data-test=preview]")!.textContent).toContain("22");
  expect(q(el, '[data-test=preview] time[datetime="2026-11-04T02:00:00.000Z"]')).toBeTruthy();
  await click(el, "acknowledge");
  expect(save(el).disabled).toBe(false);
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
  await change(el, "effectiveBusinessDay", "2026-11-04");
  await change(el, "dayCutover", "03:00");
  await change(el, "effectiveBusinessDay", "2026-11-05");
  old.resolve(preview());
  await flush(el);
  expect(q(el, "[data-test=preview]")).toBeNull();
  expect(save(el).disabled).toBe(true);
  newer.resolve({
    ...preview(),
    effectiveDay: { ...preview().effectiveDay, businessDay: "2026-11-05" },
  });
  await flush(el);
  await click(el, "acknowledge");
  expect(save(el).disabled).toBe(false);
});
it("refuses a wrong revision preview and preserves the opening revision through live changes", async () => {
  const { el } = await rig({ previewBusinessDayStart: async () => preview(5) });
  await click(el, "change");
  await change(el, "effectiveBusinessDay", "2026-11-04");
  await change(el, "dayCutover", "03:00");
  expect(save(el).disabled).toBe(true);
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
  el.model = { ...clockModel(), revision: 5 };
  await flush(el);
  expect(q<WtInput>(el, "[name=dayCutover]")!.value).toBe("03:00");
  expect(save(el).disabled).toBe(true);
});
it("invalidates an acknowledged preview on draft or live-clock change", async () => {
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
  expect(q<WtInput>(el, "[name=effectiveBusinessDay]")!.error).toBeTruthy();
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
        params: { field: "effectiveBusinessDay", reason: "too_soon" },
      };
    },
  });
  await ready(el);
  await click(el, "save");
  expect(q<WtInput>(el, "[name=effectiveBusinessDay]")!.error).toBeTruthy();
  expect(q<WtFormActions>(el, "wt-form-actions")!.error).toBeTruthy();
  expect(save(el).disabled).toBe(false);
});
it("shows schedule conflicts and prevents acknowledgement", async () => {
  const { el } = await rig({
    previewBusinessDayStart: async () => ({
      ...preview(),
      conflicts: [{ departmentId: "dept", weekday: 1, reason: "range_cutover" }],
      conflictCount: 1,
    }),
  });
  await click(el, "change");
  await change(el, "effectiveBusinessDay", "2026-11-04");
  await change(el, "dayCutover", "03:00");
  expect(q(el, "[data-test=conflicts]")?.textContent).toContain("1");
  expect(q(el, "[data-test=conflicts] a")?.getAttribute("href")).toBe("/manage/opening-hours");
  expect(save(el).disabled).toBe(true);
});
it("offers Replace and Cancel only before the pending lock and sends the displayed revision", async () => {
  const model = {
    ...clockModel(),
    pending: {
      effectiveBusinessDay: "2026-11-04",
      dayCutover: "03:00:00",
      startsAt: "2026-11-04T02:00:00.000Z",
      locksAt: "2026-11-03T04:00:00.000Z",
      editable: true,
    },
  };
  const { el, cancels } = await rig({}, model);
  expect(q(el, "[data-test=replace]")).toBeTruthy();
  await click(el, "cancel-pending");
  expect(cancels).toEqual([4]);
  el.model = { ...model, pending: { ...model.pending, editable: false } };
  await flush(el);
  expect(q(el, "[data-test=replace]")).toBeNull();
  expect(q(el, "[data-test=cancel-pending]")).toBeNull();
  expect(q(el, "[data-test=locked]")).toBeTruthy();
});
it("read-only mode shows current and pending status without actions or fields", async () => {
  const { el } = await rig({}, clockModel(), true);
  expect(el.shadowRoot!.textContent).toContain("05:00");
  expect(q(el, "wt-button")).toBeNull();
  expect(q(el, "wt-input")).toBeNull();
});
