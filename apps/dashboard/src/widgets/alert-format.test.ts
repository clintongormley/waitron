import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import {
  areaLabel,
  formatAlertTime,
  goToLabel,
  incidentIdOf,
  markAlertHandled,
  screenTargetOf,
  severityLabel,
  sourceLabel,
} from "./alert-format.js";

afterEach(() => setLocale("es-ES"));

it("reads the incident id only from an event key", () => {
  expect(incidentIdOf({ key: "incident:abc", kind: "event" })).toBe("abc");
  expect(incidentIdOf({ key: "backup.disabled:local", kind: "ongoing" })).toBeNull();
});

it("names a device alert by its device and a job alert by its source, in the chosen language", () => {
  setLocale("en-GB");
  expect(sourceLabel({ source: "device", deviceId: "d1", deviceName: "Caja 1" })).toBe("Caja 1");
  expect(sourceLabel({ source: "device", deviceId: "d1", deviceName: null })).toBe("d1");
  expect(sourceLabel({ source: "device" })).toBe("");
  expect(sourceLabel({ source: "payment_check", deviceId: null, deviceName: null })).toBe(
    "Payment check",
  );
  setLocale("es-ES");
  expect(sourceLabel({ source: "payment_check", deviceId: null, deviceName: null })).toBe(
    "Comprobación de pagos",
  );
  // A source this dashboard has no name for is shown as stored, rather than as a missing key.
  expect(sourceLabel({ source: "new_job", deviceId: null, deviceName: null })).toBe("new_job");
  // An ongoing alert comes from no device and no job.
  expect(sourceLabel({})).toBe("");
});

it("offers an ongoing alert's screen only when the session may open it", () => {
  const canOpen = (screen: string) => screen === "backup";
  expect(screenTargetOf({ kind: "ongoing", screen: "backup" }, canOpen)).toBe("backup");
  expect(screenTargetOf({ kind: "ongoing", screen: "printers" }, canOpen)).toBeNull();
  expect(screenTargetOf({ kind: "ongoing" }, canOpen)).toBeNull();
  // Only an ongoing alert names the screen that fixes it; an event is marked handled instead.
  expect(screenTargetOf({ kind: "event", screen: "backup" }, canOpen)).toBeNull();
});

function handleApi(mark: () => Promise<void>) {
  const liveData = new LiveData();
  const invalidate = vi.spyOn(liveData, "invalidate");
  const api = { markIncidentHandled: vi.fn(mark), liveData } as unknown as DashboardApi;
  return { api, invalidate };
}

it("marks an incident handled and then refreshes everything reading incidents", async () => {
  const { api, invalidate } = handleApi(async () => {
    expect(invalidate).not.toHaveBeenCalled();
  });
  await markAlertHandled(api, "i1");
  expect(api.markIncidentHandled).toHaveBeenCalledWith("i1");
  expect(invalidate).toHaveBeenCalledWith([{ type: "incidents" }]);
});

it("refreshes nothing when the write fails or its caller has moved on", async () => {
  const failing = handleApi(() => Promise.reject({ code: "alert.not_found" }));
  await expect(markAlertHandled(failing.api, "i1")).rejects.toEqual({ code: "alert.not_found" });
  expect(failing.invalidate).not.toHaveBeenCalled();
  const stale = handleApi(async () => {});
  await markAlertHandled(stale.api, "i1", () => false);
  expect(stale.invalidate).not.toHaveBeenCalled();
});

it("labels areas and severities in the active language, keeping an unknown area as is", () => {
  setLocale("en-GB");
  expect(areaLabel("fiscal")).toBe("Tax filing");
  expect(areaLabel("mystery")).toBe("mystery");
  expect(severityLabel("error")).toBe("Problem");
  expect(severityLabel("warning")).toBe("Warning");
  setLocale("es-ES");
  expect(areaLabel("payments")).toBe("Pagos con tarjeta");
});

it("labels the kitchen area in both languages", () => {
  setLocale("en-GB");
  expect(areaLabel("kitchen")).toBe("Kitchen");
  setLocale("es-ES");
  expect(areaLabel("kitchen")).toBe("Cocina");
});

it("names a Spanish warning differently from the alert column it sits under", () => {
  setLocale("es-ES");
  expect(severityLabel("warning")).toBe("Advertencia");
  expect(severityLabel("warning")).not.toBe(t("alerts.col_alert"));
});

it("names the destination screen by its navigation label", () => {
  setLocale("en-GB");
  expect(goToLabel("backup")).toBe("Go to Backups");
  setLocale("es-ES");
  expect(goToLabel("backup")).toBe("Ir a Copias de seguridad");
});

it("names a destination with no navigation label by its screen name", () => {
  setLocale("en-GB");
  expect(goToLabel("no-such-screen")).toBe("Go to no-such-screen");
});

it("formats a time, and nothing for no time", () => {
  expect(formatAlertTime(null)).toBe("");
  // The browser project pins Chromium to UTC (vitest.config.ts), so a UTC instant reads as written.
  const iso = "2026-09-14T12:00:00.000Z";
  setLocale("en-GB");
  expect(formatAlertTime(iso)).toBe("14/09/2026, 12:00");
  setLocale("es-ES");
  expect(formatAlertTime(iso)).toBe("14/9/26, 12:00");
});
