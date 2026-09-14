import { afterEach, expect, it } from "vitest";
import { setLocale, t } from "../i18n/t.js";
import {
  areaLabel,
  formatAlertTime,
  goToLabel,
  incidentIdOf,
  severityLabel,
} from "./alert-format.js";

afterEach(() => setLocale("es-ES"));

it("reads the incident id only from an event key", () => {
  expect(incidentIdOf({ key: "incident:abc", kind: "event" })).toBe("abc");
  expect(incidentIdOf({ key: "backup.disabled:local", kind: "ongoing" })).toBeNull();
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
  const iso = "2026-09-14T12:00:00.000Z";
  setLocale("en-GB");
  const english = formatAlertTime(iso);
  setLocale("es-ES");
  const spanish = formatAlertTime(iso);
  expect(english).not.toBe(iso);
  expect(english).toMatch(/^14\/09\/2026, \d{2}:\d{2}$/);
  expect(spanish).toMatch(/^14\/9\/26, \d{1,2}:\d{2}$/);
});
