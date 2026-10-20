import { describe, expect, test } from "vitest";
import type { WaitronDefaults } from "./defaults.js";
import { forgetRemembered, type Memo, withMemo } from "./derive.js";
import { canFixAll, deriveThemeFrom, fixAll, WAITRON_CHOICES, type ThemeChoices } from "./theme.js";
import { colourToken, THEME_COLOURS } from "./tokens.js";
import { WAITRON_DEFAULTS } from "./waitron.js";

const P = colourToken;

let copies = 0;
/** `defaults`' values under content no other call has used: the derivation reads no such key. */
const unseen = (defaults: WaitronDefaults = WAITRON_DEFAULTS): WaitronDefaults => ({
  ...defaults,
  structure: { ...defaults.structure, "--wt-test-unseen": String(++copies) },
});

const everything = (defaults: WaitronDefaults, choices: ThemeChoices) => ({
  theme: deriveThemeFrom(defaults, choices),
  fixed: fixAll(defaults, choices),
  can: canFixAll(defaults, choices),
});

const greys = Object.fromEntries(
  THEME_COLOURS.slice(0, 12).map((colour, i) => [colour, i % 2 ? "#aaaaaa" : "#555555"]),
);
const GREYS: ThemeChoices = {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
  brandFix: { dark: true },
  handSet: { light: greys, dark: greys },
};

interface Changeable {
  light: Record<string, string>;
  dark: Record<string, string>;
  warnings: { blockedBy: string[]; against: string[]; fix: string | null }[];
}

const PALE_PAGE = {
  ...WAITRON_DEFAULTS,
  light: { ...WAITRON_DEFAULTS.light, [P("bg")]: "#f0f0f0" },
};

describe("answers remembered between calls", () => {
  test("belong to the defaults they were worked out under", () => {
    const waitronPage = WAITRON_DEFAULTS.light[P("bg")];
    expect(deriveThemeFrom(WAITRON_DEFAULTS, WAITRON_CHOICES).light[P("bg")]).toBe(waitronPage);
    expect(deriveThemeFrom(PALE_PAGE, WAITRON_CHOICES).light[P("bg")]).toBe("#f0f0f0");
    expect(deriveThemeFrom(WAITRON_DEFAULTS, WAITRON_CHOICES).light[P("bg")]).toBe(waitronPage);
  });

  test("are not reused for defaults changed in place", () => {
    const defaults = { ...WAITRON_DEFAULTS, light: { ...WAITRON_DEFAULTS.light } };
    expect(deriveThemeFrom(defaults, WAITRON_CHOICES).light[P("bg")]).toBe(
      WAITRON_DEFAULTS.light[P("bg")],
    );
    defaults.light[P("bg")] = "#f0f0f0";
    expect(deriveThemeFrom(defaults, WAITRON_CHOICES).light[P("bg")]).toBe("#f0f0f0");
  });

  test("are not changed by a caller changing what it was given", () => {
    const first = everything(WAITRON_DEFAULTS, GREYS);
    const before = structuredClone(first);
    expect(before.theme.warnings.some(({ blockedBy }) => blockedBy.length > 0)).toBe(true);
    const theme = first.theme as unknown as Changeable;
    theme.light[P("bg")] = "#123456";
    theme.dark[P("text")] = "#654321";
    for (const warning of theme.warnings) {
      warning.blockedBy.push("bg");
      warning.against.length = 0;
      warning.fix = "#000000";
    }
    (first.fixed.handSet.light as Record<string, string>).bg = "#123456";
    expect(everything(WAITRON_DEFAULTS, GREYS)).toEqual(before);
  });

  test("give calls one choice apart, interleaved, the answers each gives on its own", () => {
    const base: ThemeChoices = {
      ...WAITRON_CHOICES,
      brandColor: "#1e5b3a",
      background: "tinted",
      handSet: {
        light: { bg: "#555555", surface: "#aaaaaa", text: "#aaaaaa", primary: "#aaaaaa" },
        dark: { text: "#555555", "on-primary": "#555555" },
      },
    };
    const variants: ThemeChoices[] = [
      base,
      ...(["square", "round"] as const).map((corners) => ({ ...base, corners })),
      { ...base, background: "neutral" },
      { ...base, brandFix: { dark: true } },
      { ...base, brandColor: null },
      { ...base, brandColor: "#7a1f2b" },
      { ...base, handSet: { ...base.handSet, light: { ...base.handSet.light, text: "#a0a0a0" } } },
      { ...base, handSet: { ...base.handSet, light: { surface: "#aaaaaa", text: "#aaaaaa" } } },
    ];
    const alone = variants.map((choices) => everything(unseen(), choices));
    const shared = unseen();
    const together = variants.map(() => ({}) as Partial<ReturnType<typeof everything>>);
    for (let round = 0; round < 2; round++) {
      variants.forEach((choices, i) => {
        together[i]!.theme = deriveThemeFrom(shared, choices);
        const next = (i + 1) % variants.length;
        together[next]!.can = canFixAll(shared, variants[next]!);
        const previous = (i + variants.length - 1) % variants.length;
        together[previous]!.fixed = fixAll(shared, variants[previous]!);
      });
      expect(together).toEqual(alone);
    }
  });
});

const memoFor = (defaults: WaitronDefaults): Memo => withMemo(defaults, (memo) => memo);

describe("what a call leaves remembered", () => {
  test("is one memo, for the defaults used last, which the next call with the same content reuses", () => {
    const [a, b] = [unseen(), unseen()];
    const first = memoFor(a);
    expect(memoFor(a)).toBe(first);
    expect(memoFor({ ...a })).toBe(first);
    const second = memoFor(b);
    expect(second).not.toBe(first);
    expect(memoFor(b)).toBe(second);
    expect(memoFor(a)).not.toBe(first);
  });

  test("is the memo whose call started last, when calls run inside calls", () => {
    const [a, b, c] = [unseen(), unseen(), unseen()];
    let again: Memo | undefined;
    const outer = withMemo(a, (memo) => {
      withMemo(b, () => {
        again = memoFor(a);
      });
      return memo;
    });
    expect(again).toBe(outer);
    expect(memoFor(a)).toBe(outer);

    let innermost: Memo | undefined;
    withMemo(a, () => withMemo(b, () => withMemo(c, (memo) => (innermost = memo))));
    expect(memoFor(c)).toBe(innermost);
  });

  test("is each map's newest 500 entries, and nothing is dropped before the call ends", () => {
    const defaults = unseen();
    const keys = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => `${from + i}`);
    withMemo(defaults, (memo) => {
      for (const map of Object.values(memo) as Map<string, unknown>[]) {
        for (const key of keys(0, 600)) map.set(key, "#000000");
        expect([...map.keys()]).toEqual(keys(0, 600));
      }
    });
    const kept = withMemo(defaults, (memo) =>
      (Object.values(memo) as Map<string, unknown>[]).map((map) => [...map.keys()]),
    );
    expect(kept).toHaveLength(10);
    for (const map of kept) expect(map).toEqual(keys(100, 600));
  });

  test("is nothing once forgotten", () => {
    const defaults = unseen();
    const first = memoFor(defaults);
    forgetRemembered();
    expect(memoFor(defaults)).not.toBe(first);
  });
});
