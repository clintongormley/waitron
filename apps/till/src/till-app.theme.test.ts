import { commands } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { chooseTheme, startThemeChoice, THEME_STORAGE_KEY, type WtThemeChooser } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillApi } from "./api/client.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

afterEach(async () => {
  cleanupWidgets();
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  await commands.emulateColorScheme(null);
});

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue({
      locale: "es-ES",
      venueName: "Bar Pepe",
      nif: "B12345678",
      orderFlow: "prepay",
      formFactor: "till",
      capabilities: [],
    }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: "till" }),
    reportBattery: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const bg = (host: HTMLElement) => getComputedStyle(host).getPropertyValue("--wt-color-bg").trim();
const DARK_BG = "#101216";

async function pickDarkOn(screenTag: string, overrides: Record<string, unknown> = {}) {
  await commands.emulateColorScheme("light");
  const { el, host } = await mountWidget<TillApp>("till-app", { api: stubApi(overrides) });
  startThemeChoice(host);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector(screenTag)).not.toBeNull());
  await flush(el);
  const screen = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    screenTag,
  )!;
  await screen.updateComplete;
  const chooser = () =>
    screen.shadowRoot!.querySelector<WtThemeChooser>("[data-test=theme-chooser]")!;
  chooser().shadowRoot!.querySelector<HTMLElement>("[data-test=theme-trigger]")!.click();
  await chooser().updateComplete;
  chooser().shadowRoot!.querySelector<HTMLElement>("[data-test=theme-dark]")!.click();
  await vi.waitFor(() => expect(bg(host)).toBe(DARK_BG));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  await screen.updateComplete;
  expect(chooser().active).toBe("dark");
}

it("a pick on the sign-in screen turns the till dark and keeps it, with nobody signed in", async () => {
  await pickDarkOn("till-lock-screen");
});

it("a pick on the join screen does the same", async () => {
  await pickDarkOn("till-enrol-screen", {
    getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
  });
});
