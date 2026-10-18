import { afterEach, describe, expect, test } from "vitest";
import { commands } from "vitest/browser";
import { mountTokenRoot, token } from "./token-test-helpers.js";
// The tokens barrel, not the package's — `token-test-helpers.ts` beside this file imports the same
// way, and its header asks these suites to stay free of anything beyond raw DOM and `applyTokens`.
import { applyTokens } from "./index.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const luminance = (hex: string) => {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

let host: HTMLElement;

function mount(theme?: "light" | "dark"): HTMLElement {
  host = mountTokenRoot(theme);
  return host;
}

afterEach(async () => {
  host?.remove();
  // Reset OS colour-scheme emulation so it can't leak into other test files.
  await commands.emulateColorScheme(null);
});

test("defines the core colour contract", () => {
  const el = mount("light");
  for (const name of [
    "--wt-color-bg",
    "--wt-color-surface",
    "--wt-color-text",
    "--wt-color-text-muted",
    "--wt-color-primary",
    "--wt-color-on-primary",
    "--wt-color-danger",
    "--wt-color-on-danger",
    "--wt-color-primary-hover",
    "--wt-color-danger-hover",
    "--wt-color-primary-disabled",
    "--wt-color-on-primary-disabled",
    "--wt-color-danger-disabled",
    "--wt-color-on-danger-disabled",
    "--wt-color-warning",
    "--wt-color-on-warning",
    "--wt-color-border",
    "--wt-color-focus",
    "--wt-color-scrim",
  ]) {
    expect(token(el, name), `${name} should be defined`).not.toBe("");
  }
});

test("light and dark resolve to different backgrounds", () => {
  const light = mount("light");
  const lightBg = token(light, "--wt-color-bg");
  light.remove();

  const dark = mount("dark");
  const darkBg = token(dark, "--wt-color-bg");

  expect(lightBg).not.toBe(darkBg);
});

test("prefers-color-scheme sets the default theme when data-theme is absent", async () => {
  // No data-theme attribute at all: the @media (prefers-color-scheme: dark)
  // block is the only thing that can make this element resolve to dark.
  const el = mount();

  await commands.emulateColorScheme("dark");
  expect(token(el, "--wt-color-bg")).toBe("#101216");

  await commands.emulateColorScheme("light");
  expect(token(el, "--wt-color-bg")).toBe("#f7f7f8");
});

test("data-theme overrides the media preference in both directions", async () => {
  // OS prefers dark, but an explicit data-theme="light" must still win.
  await commands.emulateColorScheme("dark");
  const light = mount("light");
  expect(token(light, "--wt-color-bg")).toBe("#f7f7f8");
  light.remove();

  // OS prefers light, but an explicit data-theme="dark" must still win.
  await commands.emulateColorScheme("light");
  const dark = mount("dark");
  expect(token(dark, "--wt-color-bg")).toBe("#101216");
});

test("tells the browser which scheme to draw native controls in", async () => {
  // A native control the app does not paint itself — a radio, a checkbox, a scrollbar — is drawn by
  // the user agent, which picks its appearance from `color-scheme` and NOT from `data-theme`.
  await commands.emulateColorScheme("light");
  expect(getComputedStyle(mount("dark")).colorScheme).toBe("dark");
  host.remove();

  await commands.emulateColorScheme("dark");
  expect(getComputedStyle(mount("light")).colorScheme).toBe("light");
  host.remove();

  // No data-theme: the media block is the only thing that can answer.
  await commands.emulateColorScheme("dark");
  expect(getComputedStyle(mount()).colorScheme).toBe("dark");
});

test("a nested theme root does not inherit the outer root's scheme", async () => {
  // `color-scheme` is an inherited property, so a theme root nested inside a DARK one and carrying
  // no data-theme of its own would be drawn dark while its colour tokens resolve light — light
  // surfaces with dark-drawn radios and checkboxes. The base block's `color-scheme: light` is the
  // only thing that stops it. Nothing nests a theme root today, so this case is constructed here
  // rather than observed.
  await commands.emulateColorScheme("light");
  const outer = mount("dark");
  const inner = document.createElement("div");
  outer.appendChild(inner);
  applyTokens(inner);

  expect(getComputedStyle(inner).colorScheme).toBe("light");
  expect(token(inner, "--wt-color-bg")).toBe("#f7f7f8");
});

test("the lifted surface stands apart from every other surface and keeps text readable, in both themes", () => {
  for (const theme of ["light", "dark"] as const) {
    const el = mount(theme);
    const lifted = token(el, "--wt-color-surface-lifted");
    for (const surface of ["--wt-color-bg", "--wt-color-surface", "--wt-color-surface-raised"]) {
      expect(ratio(lifted, token(el, surface)), `${theme}: lifted vs ${surface}`).toBeGreaterThan(
        1.1,
      );
    }
    for (const text of ["--wt-color-text", "--wt-color-text-muted", "--wt-color-danger"]) {
      expect(ratio(lifted, token(el, text)), `${theme}: ${text} on lifted`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    el.remove();
  }
});

describe.each(["light", "dark"] as const)("sunken surface (%s)", (theme) => {
  test("text reads at 4.5:1 or more on it", () => {
    const el = mount(theme);
    expect(
      ratio(token(el, "--wt-color-text"), token(el, "--wt-color-surface-sunken")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("the OS preference gives it the same value as the explicit theme", async () => {
    await commands.emulateColorScheme(theme === "light" ? "dark" : "light");
    const explicit = mount(theme);
    const fromTheme = token(explicit, "--wt-color-surface-sunken");
    expect(fromTheme).not.toBe("");
    explicit.remove();
    await commands.emulateColorScheme(theme);
    expect(token(mount(), "--wt-color-surface-sunken")).toBe(fromTheme);
  });
});

describe.each(["light", "dark"] as const)("bar track (%s)", (theme) => {
  test("stands 1.4:1 or more from the page and the surface, and text reads on it", () => {
    const el = mount(theme);
    const track = token(el, "--wt-color-track");
    expect(ratio(track, token(el, "--wt-color-bg"))).toBeGreaterThanOrEqual(1.4);
    expect(ratio(track, token(el, "--wt-color-surface"))).toBeGreaterThanOrEqual(1.4);
    expect(ratio(token(el, "--wt-color-text"), track)).toBeGreaterThanOrEqual(4.5);
  });

  test("the OS preference gives it the same value as the explicit theme", async () => {
    await commands.emulateColorScheme(theme === "light" ? "dark" : "light");
    const explicit = mount(theme);
    const fromTheme = token(explicit, "--wt-color-track");
    expect(fromTheme).not.toBe("");
    explicit.remove();
    await commands.emulateColorScheme(theme);
    expect(token(mount(), "--wt-color-track")).toBe(fromTheme);
  });
});

const FIELD_TOKENS = [
  "--wt-color-field-fill",
  "--wt-color-field-line",
  "--wt-color-field-label-focus",
  "--wt-color-field-fill-disabled",
  "--wt-color-field-value",
] as const;

describe.each(["light", "dark"] as const)("field tokens (%s)", (theme) => {
  test("every field token is set", () => {
    const el = mount(theme);
    for (const name of FIELD_TOKENS) expect(token(el, name), name).not.toBe("");
  });

  test("the field's marks meet WCAG on the fill and around it", () => {
    const el = mount(theme);
    const fill = token(el, "--wt-color-field-fill");
    const onFill = (name: string, on = fill) => ratio(token(el, name), on);
    // Non-text (1.4.11): the bottom line marks the field out, on the fill and on what surrounds it.
    expect(onFill("--wt-color-field-line")).toBeGreaterThanOrEqual(3);
    expect(onFill("--wt-color-field-line", token(el, "--wt-color-surface"))).toBeGreaterThanOrEqual(
      3,
    );
    expect(onFill("--wt-color-field-line", token(el, "--wt-color-bg"))).toBeGreaterThanOrEqual(3);
    expect(onFill("--wt-color-primary")).toBeGreaterThanOrEqual(3);
    // Small text (1.4.3): label, hint, value, error.
    for (const name of [
      "--wt-color-field-label-focus",
      "--wt-color-text-muted",
      "--wt-color-text",
      "--wt-color-danger",
      "--wt-color-field-value",
    ])
      expect(onFill(name), name).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(token(el, "--wt-color-text-muted"), token(el, "--wt-color-field-fill-disabled")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

test("the OS dark preference gives the field tokens the same values as an explicit dark theme", async () => {
  await commands.emulateColorScheme("dark");
  const byPreference = mount();
  const fromPreference = FIELD_TOKENS.map((name) => token(byPreference, name));
  byPreference.remove();
  const explicit = mount("dark");
  expect(fromPreference).toEqual(FIELD_TOKENS.map((name) => token(explicit, name)));
  expect(fromPreference).not.toEqual(FIELD_TOKENS.map(() => ""));
});

test("the OS light preference gives the field tokens the same values as an explicit light theme", async () => {
  await commands.emulateColorScheme("light");
  const byPreference = mount();
  const fromPreference = FIELD_TOKENS.map((name) => token(byPreference, name));
  byPreference.remove();
  const explicit = mount("light");
  expect(fromPreference).toEqual(FIELD_TOKENS.map((name) => token(explicit, name)));
  expect(fromPreference).not.toEqual(FIELD_TOKENS.map(() => ""));
});

describe.each(["light", "dark"] as const)("primary text (%s)", (theme) => {
  // --wt-color-primary itself is 4.32:1 on the light --wt-color-bg a hovered list row paints.
  test("reads at 4.5:1 or more on the page background, both surfaces and a highlighted row", () => {
    const el = mount(theme);
    const text = token(el, "--wt-color-primary-text");
    for (const surface of [
      "--wt-color-bg",
      "--wt-color-surface",
      "--wt-color-surface-raised",
      "--wt-color-surface-lifted",
    ]) {
      expect(ratio(text, token(el, surface)), `${theme}: on ${surface}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  test("the OS preference gives it the same value as the explicit theme", async () => {
    await commands.emulateColorScheme(theme);
    const byPreference = mount();
    const fromPreference = token(byPreference, "--wt-color-primary-text");
    byPreference.remove();
    expect(fromPreference).toBe(token(mount(theme), "--wt-color-primary-text"));
  });
});

describe.each(["light", "dark"] as const)("search highlight (%s)", (theme) => {
  test("its own text and the ordinary text both read at 4.5:1 or more on it", () => {
    const el = mount(theme);
    const highlight = token(el, "--wt-color-highlight");
    for (const text of ["--wt-color-on-highlight", "--wt-color-text"]) {
      expect(ratio(token(el, text), highlight), `${theme}: ${text}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the OS preference gives it the same values as the explicit theme", async () => {
    const names = ["--wt-color-highlight", "--wt-color-on-highlight"];
    await commands.emulateColorScheme(theme);
    const byPreference = mount();
    const fromPreference = names.map((name) => token(byPreference, name));
    byPreference.remove();
    expect(fromPreference).toEqual(names.map((name) => token(mount(theme), name)));
  });
});

const HOVER_FILLS = [
  ["--wt-color-primary-hover", "--wt-color-primary", "--wt-color-on-primary"],
  ["--wt-color-danger-hover", "--wt-color-danger", "--wt-color-on-danger"],
] as const;

describe.each(["light", "dark"] as const)("hover fills (%s)", (theme) => {
  test("each keeps its button's text at 4.5:1 or more", () => {
    const el = mount(theme);
    for (const [hover, , text] of HOVER_FILLS) {
      expect(
        ratio(token(el, text), token(el, hover)),
        `${theme}: ${text} on ${hover}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("each is at least 1.2:1 from its resting fill, so the hover shows", () => {
    const el = mount(theme);
    for (const [hover, base] of HOVER_FILLS) {
      expect(
        ratio(token(el, hover), token(el, base)),
        `${theme}: ${hover} vs ${base}`,
      ).toBeGreaterThanOrEqual(1.2);
    }
  });

  test("the OS preference gives them the same values as the explicit theme", async () => {
    await commands.emulateColorScheme(theme);
    const byPreference = mount();
    const fromPreference = HOVER_FILLS.map(([hover]) => token(byPreference, hover));
    byPreference.remove();
    expect(fromPreference).not.toContain("");
    const explicit = mount(theme);
    expect(fromPreference).toEqual(HOVER_FILLS.map(([hover]) => token(explicit, hover)));
  });
});

const DISABLED_PAIRS = [
  ["--wt-color-primary-disabled", "--wt-color-on-primary-disabled"],
  ["--wt-color-danger-disabled", "--wt-color-on-danger-disabled"],
] as const;

describe("disabled button colours", () => {
  test("in dark, each fill stands within 1.5:1 of the surfaces a button sits on", () => {
    const el = mount("dark");
    for (const [fill] of DISABLED_PAIRS) {
      for (const surface of ["--wt-color-surface", "--wt-color-surface-raised"]) {
        expect(
          ratio(token(el, fill), token(el, surface)),
          `dark: ${fill} vs ${surface}`,
        ).toBeLessThanOrEqual(1.5);
      }
    }
  });

  test("in dark, each text reads at 4.5:1 or more on its fill", () => {
    const el = mount("dark");
    for (const [fill, text] of DISABLED_PAIRS) {
      expect(
        ratio(token(el, text), token(el, fill)),
        `dark: ${text} on ${fill}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test.each(["light", "dark"] as const)(
    "the OS preference gives them the same values as the explicit %s theme",
    async (theme) => {
      const names = DISABLED_PAIRS.flat();
      await commands.emulateColorScheme(theme);
      const byPreference = mount();
      const fromPreference = names.map((name) => token(byPreference, name));
      byPreference.remove();
      expect(fromPreference).not.toContain("");
      expect(fromPreference).toEqual(names.map((name) => token(mount(theme), name)));
    },
  );
});

// Google's sign-in branding guidelines give the custom button's fill, stroke and text per theme.
const GOOGLE_BUTTON = {
  light: {
    "--wt-color-google-button-fill": "#ffffff",
    "--wt-color-google-button-line": "#747775",
    "--wt-color-google-button-text": "#1f1f1f",
  },
  dark: {
    "--wt-color-google-button-fill": "#131314",
    "--wt-color-google-button-line": "#8e918f",
    "--wt-color-google-button-text": "#e3e3e3",
  },
} as const;

describe.each(["light", "dark"] as const)("Google button tokens (%s)", (theme) => {
  const tokens = (el: HTMLElement) =>
    Object.fromEntries(Object.keys(GOOGLE_BUTTON[theme]).map((name) => [name, token(el, name)]));

  test("data-theme gives Google's colours whatever the OS prefers", async () => {
    await commands.emulateColorScheme(theme === "light" ? "dark" : "light");
    expect(tokens(mount(theme))).toEqual(GOOGLE_BUTTON[theme]);
  });

  test("the OS preference gives Google's colours when data-theme is absent", async () => {
    await commands.emulateColorScheme(theme);
    expect(tokens(mount())).toEqual(GOOGLE_BUTTON[theme]);
  });

  test("the button's text and line meet WCAG on its fill and on the surfaces around it", () => {
    const el = mount(theme);
    const line = token(el, "--wt-color-google-button-line");
    // Small text (1.4.3).
    expect(
      ratio(token(el, "--wt-color-google-button-text"), token(el, "--wt-color-google-button-fill")),
    ).toBeGreaterThanOrEqual(4.5);
    // Non-text (1.4.11): the sign-in card is drawn on --wt-color-surface-raised.
    for (const surface of [
      "--wt-color-google-button-fill",
      "--wt-color-surface-raised",
      "--wt-color-surface",
      "--wt-color-bg",
    ])
      expect(ratio(line, token(el, surface)), surface).toBeGreaterThanOrEqual(3);
  });
});

const PALETTE = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "magenta",
  "pink",
  "brown",
  "grey",
] as const;
const CALENDAR_FILLS = [
  ...PALETTE.map((name) => `--wt-color-palette-${name}`),
  "--wt-color-day-standard",
  "--wt-color-day-closed",
];
const onFill = (fill: string) => fill.replace("--wt-color-", "--wt-color-on-");

describe.each(["light", "dark"] as const)("calendar day colours (%s)", (theme) => {
  test("each fill has its own text colour, readable on it at 4.5:1 or more", () => {
    const el = mount(theme);
    for (const fill of CALENDAR_FILLS)
      expect(ratio(token(el, onFill(fill)), token(el, fill)), fill).toBeGreaterThanOrEqual(4.5);
  });

  test("the standard and Closed colours are not in the palette and stand apart from each other", () => {
    const el = mount(theme);
    const palette = PALETTE.map((name) => token(el, `--wt-color-palette-${name}`));
    expect(new Set(palette).size).toBe(PALETTE.length);
    for (const reserved of ["--wt-color-day-standard", "--wt-color-day-closed"])
      expect(palette, reserved).not.toContain(token(el, reserved));
    expect(
      ratio(token(el, "--wt-color-day-standard"), token(el, "--wt-color-day-closed")),
    ).toBeGreaterThanOrEqual(3);
  });

  test("the OS preference gives them the same values as the explicit theme", async () => {
    const names = CALENDAR_FILLS.flatMap((fill) => [fill, onFill(fill)]);
    await commands.emulateColorScheme(theme === "light" ? "dark" : "light");
    const explicit = mount(theme);
    const fromTheme = names.map((name) => token(explicit, name));
    expect(fromTheme).not.toContain("");
    explicit.remove();
    await commands.emulateColorScheme(theme);
    const byPreference = mount();
    expect(names.map((name) => token(byPreference, name))).toEqual(fromTheme);
  });
});

// The till map's table fills.
const TABLE_FILLS = ["free", "seated", "bill", "clearing", "reserved"].map(
  (fill) => `--wt-color-table-${fill}`,
);

describe.each(["light", "dark"] as const)("table fill colours (%s)", (theme) => {
  test("each fill has its own text colour, readable on it at 4.5:1 or more", () => {
    const el = mount(theme);
    for (const fill of TABLE_FILLS)
      expect(ratio(token(el, onFill(fill)), token(el, fill)), fill).toBeGreaterThanOrEqual(4.5);
  });

  test("the five fills are different colours", () => {
    const el = mount(theme);
    expect(new Set(TABLE_FILLS.map((fill) => token(el, fill))).size).toBe(TABLE_FILLS.length);
  });

  test("the dots are readable on the surface ring at 3:1 or more", () => {
    const el = mount(theme);
    for (const dot of ["--wt-color-success", "--wt-color-danger"])
      expect(ratio(token(el, dot), token(el, "--wt-color-surface")), dot).toBeGreaterThanOrEqual(3);
  });

  test("the OS preference gives them the same values as the explicit theme", async () => {
    const names = TABLE_FILLS.flatMap((fill) => [fill, onFill(fill)]);
    await commands.emulateColorScheme(theme === "light" ? "dark" : "light");
    const explicit = mount(theme);
    const fromTheme = names.map((name) => token(explicit, name));
    expect(fromTheme).not.toContain("");
    explicit.remove();
    await commands.emulateColorScheme(theme);
    const byPreference = mount();
    expect(names.map((name) => token(byPreference, name))).toEqual(fromTheme);
  });
});

// The fills a prep station picks from, in the order the picker offers them.
const STATION_FILLS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "magenta",
  "pink",
  "brown",
].map((colour) => `--wt-color-station-${colour}`);

describe.each(["light", "dark"] as const)("station colours (%s)", (theme) => {
  test("each fill keeps the text, muted text, warning and danger colours at 4.5:1 or more", () => {
    const el = mount(theme);
    for (const fill of STATION_FILLS)
      for (const text of [
        "--wt-color-text",
        "--wt-color-text-muted",
        "--wt-color-warning",
        "--wt-color-danger",
      ])
        expect(
          ratio(token(el, text), token(el, fill)),
          `${text} on ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
  });

  test("each dot stands 3:1 or more from every station fill and from the surface", () => {
    const el = mount(theme);
    for (const dot of STATION_FILLS.map((fill) => `${fill}-dot`))
      for (const ground of [...STATION_FILLS, "--wt-color-surface"])
        expect(
          ratio(token(el, dot), token(el, ground)),
          `${dot} on ${ground}`,
        ).toBeGreaterThanOrEqual(3);
  });

  // A painted cell keeps its fill when hovered or focused, so its ring is drawn on it; a hovered
  // cell with no station takes the tint.
  test("the focus colour stands 3:1 or more on every station fill and on the hover tint", () => {
    const el = mount(theme);
    for (const ground of [...STATION_FILLS, "--wt-color-surface-lifted"])
      expect(
        ratio(token(el, "--wt-color-focus"), token(el, ground)),
        `--wt-color-focus on ${ground}`,
      ).toBeGreaterThanOrEqual(3);
  });

  test("the fills are different colours, and so are the dots", () => {
    const el = mount(theme);
    expect(new Set(STATION_FILLS.map((fill) => token(el, fill))).size).toBe(STATION_FILLS.length);
    expect(new Set(STATION_FILLS.map((fill) => token(el, `${fill}-dot`))).size).toBe(
      STATION_FILLS.length,
    );
  });

  test("the OS preference gives them the same values as the explicit theme", async () => {
    const names = STATION_FILLS.flatMap((fill) => [fill, `${fill}-dot`]);
    await commands.emulateColorScheme(theme === "light" ? "dark" : "light");
    const explicit = mount(theme);
    const fromTheme = names.map((name) => token(explicit, name));
    expect(fromTheme).not.toContain("");
    explicit.remove();
    await commands.emulateColorScheme(theme);
    const byPreference = mount();
    expect(names.map((name) => token(byPreference, name))).toEqual(fromTheme);
  });
});

/** CIELAB under D65, from an sRGB hex colour. */
const lab = (hex: string): [number, number, number] => {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};

/** CIEDE2000 colour difference between two CIELAB colours (Sharma, Wu and Dalal's formulation). */
type Lab = readonly [number, number, number];
const deltaE2000Lab = ([l1, a1, b1]: Lab, [l2, a2, b2]: Lab) => {
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const [ap1, ap2] = [(1 + g) * a1, (1 + g) * a2];
  const [cp1, cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (b: number, a: number) => (Math.atan2(b, a) / rad + 360) % 360;
  const [hp1, hp2] = [hue(b1, ap1), hue(b2, ap2)];
  let dh = hp2 - hp1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lBar = (l1 + l2) / 2;
  const cpBar = (cp1 + cp2) / 2;
  const hBar =
    cp1 * cp2 === 0
      ? hp1 + hp2
      : Math.abs(hp1 - hp2) <= 180
        ? (hp1 + hp2) / 2
        : (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cpBar;
  const sH = 1 + 0.015 * cpBar * t;
  const rT =
    -2 *
    Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7)) *
    Math.sin(60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
};
const deltaE2000 = (one: string, two: string) => deltaE2000Lab(lab(one), lab(two));

test("the colour difference matches Sharma, Wu and Dalal's published CIEDE2000 test pairs", () => {
  for (const [one, two, published] of [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ] as const)
    expect(deltaE2000Lab(one, two)).toBeCloseTo(published, 3);
  const white = lab("#ffffff");
  expect(white[0]).toBeCloseTo(100, 1);
  expect(Math.hypot(white[1], white[2])).toBeLessThan(0.05);
});

test("every pair of dark station fills is at least as far apart as the closest pair of light ones", () => {
  const fills = (theme: "light" | "dark") => {
    const el = mount(theme);
    const values = STATION_FILLS.map((fill) => token(el, fill));
    el.remove();
    return values;
  };
  const pairs = (values: string[]) =>
    values.flatMap((one, i) =>
      values.slice(i + 1).map((two, j) => ({
        names: `${STATION_FILLS[i]} and ${STATION_FILLS[i + 1 + j]}`,
        apart: deltaE2000(one, two),
      })),
    );
  const closestLight = Math.min(...pairs(fills("light")).map((pair) => pair.apart));
  expect(closestLight).toBeGreaterThan(4);
  for (const pair of pairs(fills("dark")))
    expect(pair.apart, `dark ${pair.names}`).toBeGreaterThanOrEqual(closestLight);
});
