import { expect, it } from "vitest";
import { matchLanguage } from "@waitron/shared";
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

it("rejects long malformed 16 KiB entries within a 500 ms budget", () => {
  const headers = [
    "en" + " ".repeat(16 * 1024 - 3) + "x",
    "en" + " ".repeat(8190) + ";" + " ".repeat(8190) + "x",
  ];
  const started = performance.now();
  for (const header of headers) {
    for (let index = 0; index < 100; index++) {
      expect(parseAcceptLanguage(header)).toEqual([]);
    }
  }
  expect(performance.now() - started).toBeLessThan(500);
});

const offered = ["es", "en", "ca"];
const letters = "abcdefghijklmnopqrstuvwxyz";
const distinctCodes: string[] = [];
for (let n = 0; distinctCodes.length < 2000; n++) {
  const code = [Math.floor(n / 676), Math.floor(n / 26) % 26, n % 26]
    .map((i) => letters[i])
    .join("");
  if (!offered.includes(new Intl.Locale(code).language)) distinctCodes.push(code);
}

it("reads only the first 32 entries of the header, whatever they hold", () => {
  const header = [
    "bad_tag",
    ...distinctCodes.slice(0, 31).map((code) => `${code};q=0.5`),
    `${distinctCodes[31]};q=1`,
  ].join(",");
  const parsed = parseAcceptLanguage(header);
  expect(parsed.map((p) => p.range)).toEqual(distinctCodes.slice(0, 31));
  expect(parsed.map((p) => p.index)).toEqual(distinctCodes.slice(0, 31).map((_, i) => i + 1));
});

it("counts repeated entries towards the 32, so a later language is not read", () => {
  expect(parseAcceptLanguage([...Array<string>(40).fill("en"), "fr"].join(","))).toEqual([
    { range: "en", weight: 1, index: 0 },
  ]);
});

it("keeps a repeated language's highest-weight entry, the earliest on equal weight", () => {
  expect(parseAcceptLanguage("fr;q=0.5, en, fr, EN;q=0.1, de, de")).toEqual([
    { range: "en", weight: 1, index: 1 },
    { range: "fr", weight: 1, index: 2 },
    { range: "de", weight: 1, index: 4 },
  ]);
  expect(parseAcceptLanguage("en;q=0, en, es;q=0.5")).toEqual([
    { range: "en", weight: 1, index: 1 },
    { range: "es", weight: 0.5, index: 2 },
  ]);
});

it("matches a 2,000-language header 100 times within a 400 ms budget", () => {
  const header = distinctCodes.join(", ");
  expect(header.length).toBeGreaterThan(7000);
  const started = performance.now();
  for (let run = 0; run < 100; run++) {
    const preferences = parseAcceptLanguage(header)
      .filter((p) => p.weight > 0)
      .map((p) => p.range);
    expect(matchLanguage(preferences, offered)).toBeUndefined();
  }
  expect(performance.now() - started).toBeLessThan(400);
});

it("still matches an ordinary header to the same offered language", () => {
  const preferences = parseAcceptLanguage("ca-ES;q=0.9, es;q=0.8, en;q=0.5").map((p) => p.range);
  expect(matchLanguage(preferences, offered)).toBe("ca");
});
