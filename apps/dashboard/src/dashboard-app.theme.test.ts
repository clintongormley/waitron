import { commands } from "vitest/browser";
import { chooseTheme, startThemeChoice, THEME_STORAGE_KEY } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import darkLockup from "../../../packages/ui/brand/waitron-lockup-dark.svg?raw";
import lightLockup from "../../../packages/ui/brand/waitron-lockup.svg?raw";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

afterEach(async () => {
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  await commands.emulateColorScheme(null);
  cleanupWidgets();
});

/** The signed-out shell's reads, each resolving, so a stray rejection is a finding. */
function stubApi(): DashboardApi {
  return {
    getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    putLocale: vi.fn().mockResolvedValue(undefined),
    passkeySignals: vi.fn().mockResolvedValue({
      rpId: "localhost",
      userId: "cDE",
      credentialIds: [],
      name: "manager@example.com",
      displayName: "Manager",
    }),
  } as unknown as DashboardApi;
}

// Vite may inline a small SVG as a data URL, rewriting its quotes and spacing on the way, so the
// served drawing is compared with the file's once both are parsed.
const drawing = (svg: string) =>
  new XMLSerializer()
    .serializeToString(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement)
    .replace(/\s+/g, " ");
const served = async (url: string) => drawing(await (await fetch(url)).text());

async function mountShell(): Promise<{ host: HTMLElement; shown: () => Promise<string> }> {
  const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  const img = el.shadowRoot!.querySelector<HTMLImageElement>(
    '[data-test=brand-banner] img[alt="Waitron"]',
  )!;
  return { host, shown: async () => (img.currentSrc ? served(img.currentSrc) : "") };
}

it("tells the two lockups apart", () => {
  expect(drawing(darkLockup)).not.toBe(drawing(lightLockup));
});

it("with Dark chosen the banner shows the dark lockup, whatever the computer is set to", async () => {
  await commands.emulateColorScheme("light");
  const { shown } = await mountShell();
  chooseTheme("dark");
  await expect.poll(shown).toBe(drawing(darkLockup));
  await commands.emulateColorScheme("dark");
  await expect.poll(shown).toBe(drawing(darkLockup));
});

it("with Light chosen it shows the light lockup, whatever the computer is set to", async () => {
  // The computer is dark before the shell draws, so a stale light drawing cannot pass the first poll.
  await commands.emulateColorScheme("dark");
  const { shown } = await mountShell();
  chooseTheme("light");
  await expect.poll(shown).toBe(drawing(lightLockup));
  await commands.emulateColorScheme("light");
  await expect.poll(shown).toBe(drawing(lightLockup));
});

it("on Follow device it follows the computer, and a change of choice applies at once", async () => {
  const { shown } = await mountShell();
  await commands.emulateColorScheme("dark");
  await expect.poll(shown).toBe(drawing(darkLockup));
  chooseTheme("light");
  await expect.poll(shown).toBe(drawing(lightLockup));
  chooseTheme("device");
  await expect.poll(shown).toBe(drawing(darkLockup));
});

it("a choice saved before the page started is what the logo shows", async () => {
  await commands.emulateColorScheme("light");
  const { host, shown } = await mountShell();
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  startThemeChoice(host);
  await expect.poll(shown).toBe(drawing(darkLockup));
});
