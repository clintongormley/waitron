import { mediaTestRendition, useMediaPresentations } from "@waitron/ui/src/test-helpers.js";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, ThemeLogoPrint } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { ThemeLogoPrintFigure } from "./theme-logo-print.js";
import "./theme-logo-print.js";

const drawn = (image: string, data: string, blackDots: number): ThemeLogoPrint => ({
  paperDots: 504,
  address: mediaTestRendition(image, "display"),
  picture: { widthDots: 16, heightDots: 1, data },
  blackDots,
});

const states: Record<
  string,
  { answer: (image: string) => Promise<ThemeLogoPrint>; ready: string }
> = {
  asking: { answer: () => new Promise(() => {}), ready: '[data-test="logo-print"]' },
  shown: {
    answer: async (image) => drawn(image, "8A8=", 8),
    ready: '[data-test="logo-print"] img',
  },
  blank: {
    answer: async (image) => drawn(image, "AAA=", 0),
    ready: '[data-test="logo-print-blank"]',
  },
  failed: {
    answer: async () => Promise.reject(new Error("offline")),
    ready: '[data-test="logo-print-failed"]',
  },
};

let sequence = 0;

useMediaPresentations();

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const cases = (["light", "dark"] as const).flatMap((mode) =>
  Object.keys(states).flatMap((state) =>
    (["en-GB", "es-ES"] as const).map((locale) => ({ mode, state, locale })),
  ),
);

it.each(cases)("How it prints: $state, $locale / $mode", async ({ mode, state, locale }) => {
  setLocale(locale);
  const { answer, ready } = states[state]!;
  const api = { getThemeLogoPrint: vi.fn(answer) } as unknown as DashboardApi;
  const image = `${(30_000 + ++sequence).toString(16).padStart(64, "0")}.webp`;
  const { el, host } = await mountWidget<ThemeLogoPrintFigure>(
    "dashboard-theme-logo-print",
    { api, image },
    mode,
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector(ready)).not.toBeNull());
  await expectNoA11yViolations(host);
});
