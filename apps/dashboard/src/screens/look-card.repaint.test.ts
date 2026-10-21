import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VENUE_THEME_STORAGE_KEY, applyTokens, readVenueTheme, startVenueTheme } from "@waitron/ui";
import { themeSheet, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./look-card.js";

type Card = HTMLElementTagNameMap["dashboard-look-card"];

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: {}, dark: {} },
};
const SAVED: ThemeChoices = { ...LUCIA, brandColor: "#b12525", brandFix: {} };

function view(id: string, name: string, choices: ThemeChoices): ThemeView {
  const derived = deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived.light,
    dark: derived.dark,
    warnings: derived.warnings,
  };
}
const lucia = view("t-lucia", "Bar Lucía", LUCIA);
const other = view("t-other", "Terraza", SAVED);

const rejecting = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));
const primary = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--wt-color-primary").trim();

beforeEach(async () => {
  setLocale("en-GB");
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  applyTokens(document.documentElement);
  const fetchImpl = vi.fn<typeof fetch>(async () =>
    Response.json({ hash: "h1", css: "", logo: null }),
  );
  startVenueTheme(document.documentElement, { fetchImpl });
  await readVenueTheme(() => Promise.reject(new Error("the start-up reading is reused")));
});

afterEach(() => {
  cleanupWidgets();
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
  setLocale("en-GB");
});

async function editAndSave(list: ThemeList) {
  const getVenueTheme = vi.fn(async () => ({
    hash: "h2",
    css: themeSheet(deriveTheme(SAVED)),
    logo: null,
  }));
  const saveTheme = vi.fn(async (id: string, choices: ThemeChoices) =>
    view(id, "Bar Lucía", choices),
  );
  const api = { saveTheme, getVenueTheme } as unknown as DashboardApi;
  const { el } = await mountWidget<Card>("dashboard-look-card", { api, list, canEdit: true });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!);
  await el.updateComplete;
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>('button.swatch[data-color="#b12525"]')!,
  );
  await el.updateComplete;
  return { el, saveTheme, getVenueTheme };
}

it("a save of the theme in use repaints this dashboard at once", async () => {
  const savedPrimary = deriveTheme(SAVED).light["--wt-color-primary"]!;
  expect(primary()).not.toBe(savedPrimary);
  const { el, saveTheme, getVenueTheme } = await editAndSave({ themes: [lucia], inUse: "t-lucia" });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!);
  await expect.poll(primary).toBe(savedPrimary);
  expect(saveTheme).toHaveBeenCalledTimes(1);
  expect(getVenueTheme).toHaveBeenCalledTimes(1);
});

it("a save of a theme another dashboard has stopped using reads no venue theme", async () => {
  const { el, saveTheme, getVenueTheme } = await editAndSave({ themes: [lucia], inUse: "t-lucia" });
  el.list = { themes: [lucia, other], inUse: "t-other" };
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!);
  await expect
    .poll(() => el.shadowRoot!.querySelector("section.settings-card")!.hasAttribute("data-editing"))
    .toBe(false);
  expect(saveTheme).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(getVenueTheme).not.toHaveBeenCalled();
});
