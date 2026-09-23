import { afterEach, expect, it } from "vitest";
import { setLocale, t } from "./t.js";
import { deviceKindLabel } from "./device-label.js";

afterEach(() => setLocale("en-GB"));

it("labels each known device kind with its localised copy, never the raw token", () => {
  expect(deviceKindLabel("till")).toBe("Counter till");
  expect(deviceKindLabel("handheld")).toBe("Handheld");
  expect(deviceKindLabel("kds_station")).toBe("Kitchen display");
  setLocale("es-ES");
  expect(deviceKindLabel("kds_station")).toBe(t("device.type.kds", "es-ES"));
  expect(deviceKindLabel("kds_station")).toBe("Pantalla de cocina");
});

it("shows a kind it does not know as the token itself rather than throwing", () => {
  expect(deviceKindLabel("self_service_kiosk")).toBe("self_service_kiosk");
});
