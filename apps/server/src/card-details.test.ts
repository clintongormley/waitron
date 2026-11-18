import { describe, expect, it } from "vitest";
import { cardName } from "./card-details.js";

describe("cardName", () => {
  it.each([
    ["VISA", "Visa ****4034"],
    ["MASTERCARD", "Mastercard ****4034"],
    ["AMERICAN EXPRESS", "American Express ****4034"],
    ["VISA ELECTRON", "Visa Electron ****4034"],
    ["AMEX", "Amex ****4034"],
    ["JCB", "JCB ****4034"],
    ["CUP", "CUP ****4034"],
    ["ELO", "ELO ****4034"],
    ["VR", "VR ****4034"],
    ["UNKNOWN", "Tarjeta ****4034"],
    ["unknown", "Tarjeta ****4034"],
  ])("names a %s card as %s", (scheme, expected) => {
    expect(cardName({ scheme, last4: "4034", entryMode: "chip", authCode: null }, "Tarjeta")).toBe(
      expected,
    );
  });
});
