import type { WtInput } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import type { DashboardApi } from "../api/client.js";
import type { VenueDetailsPanel } from "./venue-details-panel.js";
import { setLocale } from "../i18n/t.js";
import "./venue-details-panel.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("es-ES");
});
it("uses the future-start editor and keeps the scalar start out of the general form", async () => {
  const api = { getVenueDetails: async () => venueDetailsFixture() } as unknown as DashboardApi;
  const { el } = await mountWidget<VenueDetailsPanel>("dashboard-venue-details-panel", { api });
  await expect
    .poll(() => el.shadowRoot!.querySelector("dashboard-business-day-start-editor"))
    .toBeTruthy();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=dayCutover]")).toBeNull();
  expect(el.shadowRoot!.querySelector("dashboard-business-day-start-editor")!.model.revision).toBe(
    0,
  );
});
it("reads clock-table events passively while retaining the editor draft and a save action error", async () => {
  const liveData = new LiveData();
  let current = venueDetailsFixture();
  let foreground = 0,
    background = 0;
  const passive = {
    getVenueDetails: async () => {
      background++;
      return structuredClone(current);
    },
  };
  const api = {
    liveData,
    background: passive,
    getVenueDetails: async () => {
      foreground++;
      return current;
    },
    previewBusinessDayStart: async () => {
      throw { code: "connection.failed" };
    },
  } as unknown as DashboardApi;
  const { el } = await mountWidget<VenueDetailsPanel>("dashboard-venue-details-panel", { api });
  await expect
    .poll(() => el.shadowRoot!.querySelector("dashboard-business-day-start-editor"))
    .toBeTruthy();
  const editor = el.shadowRoot!.querySelector("dashboard-business-day-start-editor")!;
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=change]")!.click();
  await editor.updateComplete;
  const date = editor.shadowRoot!.querySelector("[name=effectiveBusinessDay]")!;
  date.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bad-date" }, bubbles: true, composed: true }),
  );
  await editor.updateComplete;
  current = { ...current, businessDayClock: { ...current.businessDayClock, revision: 1 } };
  liveData.invalidate([{ type: "location_day_cutover_changes" }]);
  await expect.poll(() => background).toBe(1);
  await expect.poll(() => editor.model.revision).toBe(1);
  expect(editor.shadowRoot!.querySelector<WtInput>("[name=effectiveBusinessDay]")!.value).toBe(
    "bad-date",
  );
  expect(foreground).toBe(1);
});
it("closes the successful editor before a refresh failure and reports a read failure", async () => {
  let reads = 0;
  const initial = venueDetailsFixture();
  initial.businessDayClock.currentBusinessDay = "2026-11-01";
  const api = {
    getVenueDetails: async () => {
      if (++reads > 1) throw { code: "connection.failed" };
      return initial;
    },
  } as unknown as DashboardApi;
  const { el } = await mountWidget<VenueDetailsPanel>("dashboard-venue-details-panel", { api });
  await expect
    .poll(() => el.shadowRoot!.querySelector("dashboard-business-day-start-editor"))
    .toBeTruthy();
  const editor = el.shadowRoot!.querySelector("dashboard-business-day-start-editor")!;
  editor.dispatchEvent(
    new CustomEvent("saved", { detail: initial, bubbles: true, composed: true }),
  );
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")).toBeTruthy();
  expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull();
});
it("passive timer reads update a pending lock without a row change or active session read", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T03:59:30Z"));
  const initial = venueDetailsFixture();
  let active = 0,
    passive = 0;
  const snapshot = () => ({
    ...initial,
    businessDayClock: {
      ...initial.businessDayClock,
      pending: {
        effectiveBusinessDay: "2026-11-04",
        dayCutover: "03:00",
        startsAt: "2026-11-04T02:00:00.000Z",
        locksAt: "2026-11-03T04:00:00.000Z",
        editable: Date.now() < Date.parse("2026-11-03T04:00:00Z"),
      },
    },
  });
  const api = {
    liveData: new LiveData(),
    getVenueDetails: async () => {
      active++;
      return snapshot();
    },
    background: {
      getVenueDetails: async () => {
        passive++;
        return snapshot();
      },
    },
  } as unknown as DashboardApi;
  try {
    const { el } = await mountWidget<VenueDetailsPanel>("dashboard-venue-details-panel", { api });
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    const editor = el.shadowRoot!.querySelector("dashboard-business-day-start-editor")!;
    await editor.updateComplete;
    expect(editor.model.pending?.editable).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    vi.useRealTimers();
    await el.updateComplete;
    await editor.updateComplete;
    expect(editor.model.pending?.editable).toBe(false);
    expect(editor.shadowRoot!.querySelector("[data-test=locked]")).toBeTruthy();
    expect(active).toBe(1);
    expect(passive).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
