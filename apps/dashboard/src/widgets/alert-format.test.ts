import { afterEach, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
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
  setLocale("es-ES");
  expect(areaLabel("payments")).toBe("Pagos con tarjeta");
});

it("names the destination screen by its navigation label", () => {
  setLocale("en-GB");
  expect(goToLabel("backup")).toBe("Go to Backups");
  setLocale("es-ES");
  expect(goToLabel("backup")).toBe("Ir a Copias de seguridad");
});

it("formats a time, and nothing for no time", () => {
  expect(formatAlertTime(null)).toBe("");
  expect(formatAlertTime("2026-09-14T12:00:00.000Z")).not.toBe("");
});
