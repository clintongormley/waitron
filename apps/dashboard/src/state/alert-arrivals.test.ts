import { expect, it } from "vitest";
import { AlertArrivals } from "./alert-arrivals.js";

const a = (key: string) => ({ key });

it("raises nothing on the first read, then only keys missing from the previous read", () => {
  const arrivals = new AlertArrivals();
  expect(arrivals.next([a("one")])).toEqual([]);
  expect(arrivals.next([a("one"), a("two")])).toEqual([a("two")]);
  expect(arrivals.next([a("two")])).toEqual([]);
  // "one" cleared and came back: new again compared with the previous read.
  expect(arrivals.next([a("two"), a("one")])).toEqual([a("one")]);
});

it("starts over after reset", () => {
  const arrivals = new AlertArrivals();
  arrivals.next([a("one")]);
  arrivals.reset();
  expect(arrivals.next([a("two")])).toEqual([]);
});
