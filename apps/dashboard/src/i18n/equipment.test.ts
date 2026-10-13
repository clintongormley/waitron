import { expect, it } from "vitest";
import { holderText } from "./equipment.js";
import { t } from "./t.js";

it("names the holding device, adds who is signed in on it, and says when nobody has it", () => {
  const device = { deviceId: "d1", deviceName: "Móvil 2" };
  expect(holderText({ ...device, personName: null })).toBe("Móvil 2");
  expect(holderText({ ...device, personName: "Ana" })).toBe(
    t("equipment.holder_with_person").replace("{device}", "Móvil 2").replace("{person}", "Ana"),
  );
  expect(holderText(null)).toBe(t("equipment.holder_none"));
});

it("puts a device name holding a replacement pattern or the person placeholder in as written", () => {
  expect(
    holderText({ deviceId: "d1", deviceName: "Móvil {person} $&", personName: "Ana $&" }),
  ).toBe(
    t("equipment.holder_with_person")
      .split("{device}")
      .map((part) => part.split("{person}").join("Ana $&"))
      .join("Móvil {person} $&"),
  );
});
