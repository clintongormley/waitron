import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { productDeclarationValues } from "@waitron/menu/src/declaration-values.js";
import type { DashboardApi, PatchDraft } from "../api/client.js";
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

const MILK = productDeclarationValues({
  allergens: { milk: {} },
  dietOverride: null,
  dietaryDeclarations: [],
});

const LIVE: PatchDraft = {
  versionId: "v-3",
  number: 3,
  since: "2026-10-27T09:00:00.000Z",
  declarations: { "p-soup": MILK, "v-cup": MILK },
  queued: [],
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
      await press(el, "review");
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

  it("renders a name an included folder fixes accessibly", async () => {
    const document = structuredClone(LIVE.document);
    const starters = document.root.members[0] as { names: unknown; fixed: unknown };
    starters.names = { en: "Fixed English", es: "Entrantes" };
    starters.fixed = { names: { en: "Fixed English" } };
    const api = {
      getLiveMenu: vi.fn(async () => ({ ...LIVE, document })),
      getMenuPublications: vi.fn(async () => ({
        timeZone: "Europe/Madrid",
        live: null,
        editions: [],
      })),
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
    await pick(el, "Starters");
    expect(el.shadowRoot!.querySelector(".locked-note")!.textContent!.trim()).toBe(
      "The included folder sets this name.",
    );
    await expectNoA11yViolations(host);
  });

  it.each(["en", "es"])("renders the scheduled versions accessibly, in %s", async (locale) => {
    setLocale(locale);
    const queued = ["2026-11-03", "2026-11-10"].map((date, index) => ({
      versionId: `v-q${index}`,
      activatesAt: `${date}T07:00:00.000Z`,
      targets: [{ target: { kind: "offer", menuItemId: "mi-soup" }, stillOld: index === 0 }],
    }));
    const api = {
      getLiveMenu: vi.fn(async () => ({ ...LIVE, queued })),
      getMenuPublications: vi.fn(async () => ({
        timeZone: "Europe/Madrid",
        live: null,
        editions: queued.map(({ versionId, activatesAt }) => ({
          versionId,
          activatesAt,
          state: "queued",
          local: { date: activatesAt.slice(0, 10), time: "08:00", repeated: false },
        })),
      })),
      patchLiveMenu: vi.fn().mockRejectedValue({
        code: "menu_patch.invalid",
        params: { change: 0, field: "declarations" },
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
    await pick(el, "Soup");
    const boxes = () => [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(boxes()).toHaveLength(1);
    await expectNoA11yViolations(host);
    boxes()[0]!.click();
    await settle(el);
    expect(boxes().map(({ checked }) => checked)).toEqual([true]);
    await expectNoA11yViolations(host);
    await press(el, "review");
    expect(boxes().map(({ checked }) => checked)).toEqual([true, false]);
    expect(el.shadowRoot!.querySelectorAll('[data-test="review-note"]')).toHaveLength(2);
    await expectNoA11yViolations(host);
    await press(el, "put-live");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('input[aria-invalid="true"]')).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  it("renders a variant whose dish is ticked accessibly", async () => {
    const document = structuredClone(LIVE.document);
    (document.offers["mi-soup"] as { variants: unknown }).variants = [
      {
        id: "v-cup",
        name: "Cup",
        customerName: null,
        kitchenName: null,
        unitPrice: "2.00",
        ...productDeclarationValues(),
      },
    ];
    const api = {
      getLiveMenu: vi.fn(async () => ({ ...LIVE, document })),
      getMenuPublications: vi.fn(async () => ({
        timeZone: "Europe/Madrid",
        live: null,
        editions: [],
      })),
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
    const box = () => el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await pick(el, "Soup");
    box().click();
    await settle(el);
    await expectNoA11yViolations(host);
    await pick(el, "Cup");
    expect(box().disabled).toBe(true);
    await expectNoA11yViolations(host);
    await press(el, "review");
    expect(el.shadowRoot!.querySelector('[data-test="review-line"]')!.textContent).toContain(
      "Milk",
    );
    await expectNoA11yViolations(host);
  });

  it("renders a dish's variants with their values accessibly", async () => {
    const document = structuredClone(LIVE.document);
    const variant = (id: string, name: string) => ({
      id,
      name,
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: "2.00",
      menuPrice: null,
      unit: {},
      pricingUnit: {},
      vatClass: "reduced",
    });
    (document.offers["mi-soup"] as { variants: unknown }).variants = [
      variant("v-cup", "Cup"),
      variant("v-bowl", "Bowl"),
    ];
    const api = {
      getLiveMenu: vi.fn(async () => ({ ...LIVE, document })),
      getMenuPublications: vi.fn(async () => ({
        timeZone: "Europe/Madrid",
        live: null,
        editions: [],
      })),
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
    await pick(el, "Soup");
    expect(el.shadowRoot!.querySelectorAll('[data-test="variant-values"]')).toHaveLength(2);
    await expectNoA11yViolations(host);
  });
});
