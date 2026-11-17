import { expect, it } from "vitest";
import { parseAcceptLanguage } from "./accept-language.js";

it("sorts valid ranges by positive weight and header order, retaining login exclusions", () => {
  expect(parseAcceptLanguage("  fr ; q=0.5 , EN-us , es;q=0.5, *;q=0.8, en;q=0  ")).toEqual([
    { range: "en-us", weight: 1, index: 1 },
    { range: "*", weight: 0.8, index: 3 },
    { range: "fr", weight: 0.5, index: 0 },
    { range: "es", weight: 0.5, index: 2 },
    { range: "en", weight: 0, index: 4 },
  ]);
});
it.each([undefined, "", "en;q=2, es;q=-1, fr;q=0.1234, de;q=word, bad_tag, ca;foo=bar"])(
  "ignores missing or malformed entries in %s",
  (header) => {
    expect(parseAcceptLanguage(header)).toEqual([]);
  },
);

it("rejects twenty 16 KiB malformed entries within a 500 ms budget", () => {
  const header = "en" + " ".repeat(16 * 1024 - 3) + "x";
  const started = performance.now();
  for (let index = 0; index < 20; index++) {
    expect(parseAcceptLanguage(header)).toEqual([]);
  }
  expect(performance.now() - started).toBeLessThan(500);
});
