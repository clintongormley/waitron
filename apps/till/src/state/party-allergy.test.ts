import { describe, expect, it } from "vitest";
import { allergyClashes } from "./party-allergy.js";

describe("A669 clash codes", () => {
  it("intersects codes in stable order without treating different kinds as an exemption", () => {
    expect(
      allergyClashes(
        { milk: {}, gluten: { kinds: ["wheat"] }, eggs: {} },
        { gluten: { kinds: ["barley"] }, milk: {}, fish: {} },
      ),
    ).toEqual(["gluten", "milk"]);
  });

  it("does not turn unknown or reviewed-empty nutrition into a clash", () => {
    expect(allergyClashes(null, { milk: {} })).toEqual([]);
    expect(allergyClashes({}, { milk: {} })).toEqual([]);
    expect(allergyClashes({ milk: {} }, {})).toEqual([]);
  });

  it("keeps selected-variant and extra nutrition separate from the parent", () => {
    const avoids = { milk: {}, eggs: {}, fish: {} };
    expect(allergyClashes({ milk: {} }, avoids)).toEqual(["milk"]);
    expect(allergyClashes({ eggs: {} }, avoids)).toEqual(["eggs"]);
    expect(allergyClashes({ fish: {} }, avoids)).toEqual(["fish"]);
  });
});
