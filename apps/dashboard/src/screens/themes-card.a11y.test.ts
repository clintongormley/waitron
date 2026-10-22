import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtDeleteDialog, WtDialog } from "@waitron/ui";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./themes-card.js";

type Card = HTMLElementTagNameMap["dashboard-themes-card"];

function theme(id: string, name: string, choices: ThemeChoices): ThemeView {
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

const lucia = theme("t-lucia", "Bar Lucía", {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
});
/** `#2a6fb0` warns on dark screens only. */
const summer = theme("t-summer", "Summer terrace", { ...WAITRON_CHOICES, brandColor: "#2a6fb0" });
const list: ThemeList = { themes: [lucia, summer], inUse: "t-lucia" };

const cases = (["menu", "switch", "delete"] as const).flatMap((state) =>
  (["light", "dark"] as const).flatMap((mode) =>
    ["en-GB", "es-ES"].map((locale) => ({ state, mode, locale })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function choose(el: Card, key: string, item: string): Promise<void> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const actions = table.shadowRoot!.querySelector<HTMLElement>(
    `tr[data-row-key="${key}"] wt-row-actions`,
  )!;
  await userEvent.click(actions.shadowRoot!.querySelector("button")!);
  if (item !== "") {
    await userEvent.click(actions.querySelector<HTMLElement>(`[data-test="${item}-${key}"]`)!);
  }
  await el.updateComplete;
}

it.each(cases)("themes card, $state, $locale / $mode", async ({ state, mode, locale }) => {
  setLocale(locale);
  const api = { getVenueTheme: vi.fn() } as unknown as DashboardApi;
  const { el, host } = await mountWidget<Card>(
    "dashboard-themes-card",
    { api, list, canEdit: true },
    mode,
  );
  if (state === "menu") {
    await choose(el, "t-summer", "");
    const remove = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector('[data-test="delete-t-summer"]')!;
    expect(remove.getAttribute("variant")).toBe("danger");
  } else if (state === "switch") {
    await choose(el, "t-summer", "use");
    const switcher = el.shadowRoot!.querySelector("dashboard-theme-switch-dialog")!;
    await switcher.updateComplete;
    const dialog = switcher.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    expect(dialog.querySelectorAll("li")).toHaveLength(1);
  } else {
    await choose(el, "t-lucia", "delete");
    const dialog = el.shadowRoot!.querySelector<WtDeleteDialog>("wt-delete-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelectorAll("[data-group=ends] li")).toHaveLength(1);
  }
  await expectNoA11yViolations(host);
});
