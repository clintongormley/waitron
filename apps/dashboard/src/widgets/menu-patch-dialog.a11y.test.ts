import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import type { DashboardApi, LiveMenu } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";
import "./menu-patch-dialog.js";
import type { MenuPatchDialog } from "./menu-patch-dialog.js";

const LIVE: LiveMenu = {
  versionId: "v-3",
  number: 3,
  since: "2026-10-27T09:00:00.000Z",
  document: menuDocument(
    [
      documentSection("sec-starters", "Starters", [
        documentProduct("mi-soup", "p-soup"),
        documentProduct("mi-salad", "p-salad"),
      ]),
    ],
    { "p-soup": "Soup", "p-salad": "Salad" },
  ),
};

const states = ["nothing picked", "form", "field error", "review", "refused"] as const;

const savedLanguages = currentContentLanguages();

beforeEach(() => {
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
});
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
  setContentLanguages(savedLanguages);
});

async function settle(el: MenuPatchDialog): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function pick(el: MenuPatchDialog, label: string): Promise<void> {
  [...el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test="tree"] button')]
    .find((button) => button.textContent!.trim() === label)!
    .click();
  await settle(el);
}

async function type(el: MenuPatchDialog, tag: string, name: string, value: string) {
  const host = el.shadowRoot!.querySelector(`${tag}[name="${name}"]`)!;
  await userEvent.fill(page.elementLocator(host.shadowRoot!.querySelector("input")!), value);
  await settle(el);
}

async function press(el: MenuPatchDialog, name: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`wt-form-actions [data-test="${name}"]`)!.click();
  await settle(el);
}

const bottom = (el: MenuPatchDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error;

describe.each(["light", "dark"] as const)("the patch dialog (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const api = {
      getLiveMenu: vi.fn(async () => LIVE),
      getMenuPublications: vi.fn(async () => ({
        timeZone: "Europe/Madrid",
        live: null,
        editions: [],
      })),
      patchLiveMenu: vi.fn().mockRejectedValue({
        code: "menu_patch.unchanged",
        params: { menuId: "menu-lunch" },
      }),
      imageLibraryRequest: vi.fn(),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<MenuPatchDialog>(
      "dashboard-menu-patch-dialog",
      { api, menuId: "menu-lunch", menuName: "Lunch Menu", open: true },
      theme,
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="tree"] button')).not.toBeNull(),
    );
    if (state !== "nothing picked") {
      await pick(el, "Soup");
      await type(el, "wt-price-input", "price", "4");
    }
    if (state === "field error") {
      await pick(el, "Salad");
      await type(el, "wt-input", "name", "");
      expect(bottom(el)).toBe("Correct the fields marked on Salad to continue.");
    }
    if (state === "review" || state === "refused") {
      await press(el, "review");
      expect(el.shadowRoot!.querySelector('[data-test="review-step"]')).not.toBeNull();
    }
    if (state === "refused") {
      await press(el, "put-live");
      await vi.waitFor(() => expect(bottom(el)).not.toBe(""));
    }
    await settle(el);
    await expectNoA11yViolations(host);
  });
});
