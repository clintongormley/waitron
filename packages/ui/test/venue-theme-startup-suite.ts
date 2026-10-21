import { commands } from "vitest/browser";
import { describe, expect, inject, it } from "vitest";
import { VENUE_THEME_STORAGE_KEY } from "../src/venue-theme.js";
import {
  FIXTURE_ANSWER,
  FIXTURE_DARK_BG,
  FIXTURE_LIGHT_BG,
  WAITRON_LIGHT_BG,
} from "./venue-theme-fixture.js";
import type { StartupProbeResult, StartupScenario } from "./venue-theme-startup.js";

declare module "vitest" {
  export interface ProvidedContext {
    startupEngines: string[];
  }
}

declare module "vitest/browser" {
  interface BrowserCommands {
    probeVenueThemeStartup(scenario: StartupScenario): Promise<StartupProbeResult>;
  }
}

const STORED = JSON.stringify(FIXTURE_ANSWER);

/** The eight start-up cases, once per engine the app's config provides as `startupEngines`. */
export function describeVenueThemeStartup(app: string): void {
  const engines = inject("startupEngines") as StartupScenario["engine"][];
  describe.each(engines)(`the ${app}'s start-up in %s`, { timeout: 30_000 }, (engine) => {
    const probe = (scenario: Partial<StartupScenario>) =>
      commands.probeVenueThemeStartup({
        storageKey: VENUE_THEME_STORAGE_KEY,
        stored: null,
        answer: "never",
        answerBody: STORED,
        colorScheme: "light",
        engine,
        ...scenario,
      });

    it("a stored copy paints on the first frame while the server never answers", async () => {
      const result = await probe({ stored: STORED });
      expect(result.firstThemedBg).toBe(FIXTURE_LIGHT_BG);
      expect(result.bgAfter).toBe(FIXTURE_LIGHT_BG);
      expect(result.appRendered).toBe(true);
      expect(result.themeRequests).toBe(1);
      expect(result.themeRequestsTraced).toBe(1);
    });

    it("with no stored copy the first frame is Waitron's", async () => {
      const result = await probe({});
      expect(result.firstThemedBg).toBe(WAITRON_LIGHT_BG);
      expect(result.appRendered).toBe(true);
    });

    it("an answer after 500 ms repaints and is stored", async () => {
      const result = await probe({ answer: "late" });
      expect(result.firstThemedBg).toBe(WAITRON_LIGHT_BG);
      expect(result.bgAfter).toBe(FIXTURE_LIGHT_BG);
      expect(JSON.parse(result.storedAfter!)).toEqual(FIXTURE_ANSWER);
      expect(result.themeRequests).toBe(1);
    });

    it.each(["refused", "failed", "not-json"] as const)(
      "a refused, failed or non-JSON answer keeps the stored copy and the page (%s)",
      async (answer) => {
        const result = await probe({ stored: STORED, answer });
        expect(result.bgAfter).toBe(FIXTURE_LIGHT_BG);
        expect(result.storedAfter).toBe(STORED);
        expect(result.appRendered).toBe(true);
        expect(result.themeRequests).toBe(1);
      },
    );

    it("a malformed stored copy leaves a working page in Waitron's colours", async () => {
      const result = await probe({ stored: "{broken" });
      expect(result.firstThemedBg).toBe(WAITRON_LIGHT_BG);
      expect(result.appRendered).toBe(true);
    });

    it("on a dark device the stored copy paints its dark version on the first frame", async () => {
      const result = await probe({ stored: STORED, colorScheme: "dark" });
      expect(result.firstThemedBg).toBe(FIXTURE_DARK_BG);
    });
  });
}
