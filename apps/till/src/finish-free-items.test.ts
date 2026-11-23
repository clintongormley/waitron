import { describe, expect, it } from "vitest";
import type { UnservedDish } from "./api/finish-table-types.js";
import type { CancellationRead } from "./api/line-cancel-types.js";
import { finishFreeItems } from "./finish-free-items.js";

const dish = (lineId: string) => ({ lineId }) as UnservedDish;
const paid = { billId: "bill-1" } as CancellationRead;
const free = (comesBackWith: string[]) =>
  ({ ...paid, givenFree: true, comesBackWith }) as CancellationRead;

describe("finishFreeItems", () => {
  it("lists a free item with every paid dish it comes back with when all are among the dishes", () => {
    const dishes = [dish("salad"), dish("soup"), dish("water")];
    const consents = new Map([
      ["salad", paid],
      ["soup", paid],
      ["water", free(["salad", "soup"])],
    ]);
    expect(finishFreeItems(dishes, consents)).toEqual({ water: ["salad", "soup"] });
  });

  it("gives a free item no paid dishes when one it comes back with is not among the dishes", () => {
    const dishes = [dish("salad"), dish("water")];
    const consents = new Map([
      ["salad", paid],
      ["water", free(["salad", "soup"])],
    ]);
    expect(finishFreeItems(dishes, consents)).toEqual({ water: [] });
  });

  it("leaves out a dish that is not free, and one with no read", () => {
    const dishes = [dish("salad"), dish("bread")];
    expect(finishFreeItems(dishes, new Map([["salad", paid]]))).toEqual({});
  });
});
