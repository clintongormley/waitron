import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { applyTokens } from "@waitron/ui-core/tokens";
import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";
import { THEME_CHOICES, THEME_STORAGE_KEY, chooseTheme, startThemeChoice } from "./theme-choice.js";
import { VENUE_THEME_STORAGE_KEY, startVenueTheme } from "./venue-theme.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const PRIMARY = "--wt-color-primary";
const WAITRON_LIGHT_PRIMARY = WAITRON_DEFAULTS.light[PRIMARY]!;
const WAITRON_DARK_PRIMARY = WAITRON_DEFAULTS.dark[PRIMARY]!;

const theme = deriveTheme({
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
  brandFix: { dark: true },
});
const GREEN = { hash: "green-hash", css: themeSheet(theme), logo: null };

const never = () => new Promise<Response>(() => {});

const primary = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue(PRIMARY).trim();

const PAIRS = (["light", "dark"] as const).flatMap((system) =>
  THEME_CHOICES.map((setting) => [system, setting] as const),
);

function picksDark(system: "light" | "dark", setting: string): boolean {
  return setting === "dark" || (setting === "device" && system === "dark");
}

let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;

function start(): void {
  fetchImpl = vi.fn<typeof fetch>(never);
  applyTokens(document.documentElement);
  startVenueTheme(document.documentElement, { fetchImpl });
  startThemeChoice(document.documentElement);
}

beforeEach(() => {
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  localStorage.removeItem(THEME_STORAGE_KEY);
});

afterEach(async () => {
  chooseTheme("device");
  await commands.emulateColorScheme(null);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: never });
});

describe("Follow device with a venue theme", () => {
  beforeEach(() => {
    localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(GREEN));
    start();
  });

  it("has light and dark versions that differ from each other and from Waitron's", () => {
    expect(theme.light[PRIMARY]).not.toBe(theme.dark[PRIMARY]);
    expect(theme.light[PRIMARY]).not.toBe(WAITRON_LIGHT_PRIMARY);
    expect(theme.dark[PRIMARY]).not.toBe(WAITRON_DARK_PRIMARY);
    expect(WAITRON_LIGHT_PRIMARY).not.toBe(WAITRON_DARK_PRIMARY);
  });

  it.each(PAIRS)(
    "each setting paints the version it picks: system %s, setting %s",
    async (system, setting) => {
      await commands.emulateColorScheme(system);
      chooseTheme(setting);
      expect(primary()).toBe(
        picksDark(system, setting) ? theme.dark[PRIMARY] : theme.light[PRIMARY],
      );
    },
  );

  it("changing the setting or the system mode sends no request", async () => {
    for (const system of ["light", "dark"] as const) {
      await commands.emulateColorScheme(system);
      for (const setting of THEME_CHOICES) chooseTheme(setting);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("Follow device without a venue theme", () => {
  beforeEach(start);

  it.each(PAIRS)(
    "the control without a venue theme paints Waitron's own: system %s, setting %s",
    async (system, setting) => {
      await commands.emulateColorScheme(system);
      chooseTheme(setting);
      expect(primary()).toBe(
        picksDark(system, setting) ? WAITRON_DARK_PRIMARY : WAITRON_LIGHT_PRIMARY,
      );
    },
  );
});
