import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DashboardApi, ThemeLogoPrint } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { DashboardThemeLogoPrint } from "./theme-logo-print.js";
import "./theme-logo-print.js";

const BLACK: ThemeLogoPrint = {
  paperDots: 504,
  picture: { widthDots: 16, heightDots: 1, data: "8A8=" },
  blackDots: 8,
};
const BLANK: ThemeLogoPrint = {
  paperDots: 504,
  picture: { widthDots: 16, heightDots: 1, data: "AAA=" },
  blackDots: 0,
};

const states: Record<string, { answer: () => Promise<ThemeLogoPrint>; ready: string }> = {
  asking: { answer: () => new Promise(() => {}), ready: '[data-test="logo-print"]' },
  shown: { answer: async () => BLACK, ready: '[data-test="logo-print"] img' },
  blank: { answer: async () => BLANK, ready: '[data-test="logo-print-blank"]' },
  failed: {
    answer: async () => Promise.reject(new Error("offline")),
    ready: '[data-test="logo-print-failed"]',
  },
};

let sequence = 0;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ images: {} }), {
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanupWidgets();
  vi.unstubAllGlobals();
});

const cases = (["light", "dark"] as const).flatMap((mode) =>
  Object.keys(states).map((state) => ({ mode, state })),
);

it.each(cases)("How it prints: $state / $mode", async ({ mode, state }) => {
  const { answer, ready } = states[state]!;
  const api = { getThemeLogoPrint: vi.fn(answer) } as unknown as DashboardApi;
  const image = `${(30_000 + ++sequence).toString(16).padStart(64, "0")}.webp`;
  const { el, host } = await mountWidget<DashboardThemeLogoPrint>(
    "dashboard-theme-logo-print",
    { api, image },
    mode,
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector(ready)).not.toBeNull());
  await expectNoA11yViolations(host);
});
