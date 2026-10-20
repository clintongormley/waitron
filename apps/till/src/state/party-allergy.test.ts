import { describe, expect, it } from "vitest";
import { allergyClashes, allergensWithExtras } from "./party-allergy.js";

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

describe("A931 allergens with extras", () => {
  it("unions the dish's and every extra's allergens, merging kinds and skipping unreviewed maps", () => {
    expect(
      allergensWithExtras({ gluten: { kinds: ["wheat"] }, milk: {} }, [
        { allergens: { gluten: { kinds: ["barley", "wheat"] }, eggs: {} } },
        { allergens: null },
        { allergens: { milk: {}, nuts: { kinds: ["almonds"] } } },
      ]),
    ).toEqual({
      gluten: { kinds: ["barley", "wheat"] },
      milk: {},
      eggs: {},
      nuts: { kinds: ["almonds"] },
    });
  });

  it("keeps an extra's allergen when the dish itself is not reviewed", () => {
    expect(allergensWithExtras(null, [{ allergens: { milk: {} } }])).toEqual({ milk: {} });
    expect(allergensWithExtras(null, [{ allergens: null }])).toEqual({});
  });
});
