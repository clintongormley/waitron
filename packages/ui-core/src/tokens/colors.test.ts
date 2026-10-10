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
    for (const text of ["--wt-color-text", "--wt-color-text-muted"]) {
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

const HOVER_FILLS = [
  ["--wt-color-primary-hover", "--wt-color-primary", "--wt-color-on-primary"],
  ["--wt-color-danger-hover", "--wt-color-danger", "--wt-color-on-danger"],
] as const;

describe.each(["light", "dark"] as const)("hover fills (%s)", (theme) => {
  test("each keeps its button's text at 4.5:1 or more and differs from the resting fill", () => {
    const el = mount(theme);
    for (const [hover, base, text] of HOVER_FILLS) {
      expect(
        ratio(token(el, text), token(el, hover)),
        `${theme}: ${text} on ${hover}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(token(el, hover), `${theme}: ${hover}`).not.toBe(token(el, base));
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

// The Hours calendar's day colours: six a special date may pick, and two reserved ones no special
// date can take (a standard day, and a day every department is Closed).
const PALETTE = ["red", "amber", "grey", "blue", "green", "purple"] as const;
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

// The till map's table fills; its status dots are drawn on a --wt-color-surface ring.
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
