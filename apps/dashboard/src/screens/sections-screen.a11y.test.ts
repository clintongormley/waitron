import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { SectionsScreen } from "./sections-screen.js";
import type { DashboardApi, LibrarySection, Product } from "../api/client.js";

afterEach(cleanupWidgets);

/** The three names read differently, so a surface showing the wrong one is visible (CLAUDE.md §3). */
const lager = {
  id: "p-lager",
  name: "Lager",
  customerName: { es: "Cerveza rubia" },
  kitchenName: "LAG",
  categoryId: null,
  active: true,
} as unknown as Product;

const sections: LibrarySection[] = [
  {
    id: "s-drinks",
    internalName: "Drinks",
    names: { es: "Bebidas" },
    image: null,
    color: "#aabbcc",
    members: [
      { id: "m-lager", position: 0, ref: { kind: "product", productId: "p-lager" } },
      { id: "m-beer", position: 1, ref: { kind: "section", sectionId: "s-beer" } },
    ],
  },
  { id: "s-beer", internalName: "Beer", names: {}, image: null, color: null, members: [] },
];

const usages = {
  "s-drinks": { menus: [{ id: "c1", name: "Lunch Menu" }], sections: [] },
  "s-beer": {
    menus: [{ id: "c1", name: "Lunch Menu" }],
    sections: [{ id: "s-drinks", internalName: "Drinks" }],
  },
};

function api(state: "empty" | "populated" | "failed"): DashboardApi {
  return {
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listSections:
      state === "failed"
        ? vi.fn().mockRejectedValue(new Error("offline"))
        : vi.fn().mockResolvedValue(state === "empty" ? [] : sections),
    listSectionUsages: vi.fn().mockResolvedValue(state === "empty" ? {} : usages),
    listLibraryProducts: vi.fn().mockResolvedValue([lager]),
    listCategories: vi.fn().mockResolvedValue([]),
    getSectionUsages: vi.fn(async (id: string) => usages[id as keyof typeof usages]),
    createSection: vi.fn(),
    duplicateSection: vi.fn(),
  } as unknown as DashboardApi;
}

async function mount(state: "empty" | "populated" | "failed", theme: "light" | "dark") {
  const mounted = await mountWidget<SectionsScreen>(
    "dashboard-sections-screen",
    { api: api(state) },
    theme,
  );
  await vi.waitFor(() => {
    if (mounted.el.shadowRoot!.querySelector('p[role="status"]')) throw new Error("loading");
  });
  return mounted;
}

async function clickInTable(el: SectionsScreen, control: string): Promise<void> {
  const table = el.shadowRoot!.querySelector('[data-test="sections"]') as unknown as {
    updateComplete: Promise<unknown>;
    shadowRoot: ShadowRoot;
  };
  await table.updateComplete;
  table.shadowRoot.querySelector<HTMLElement>(`[data-test="${control}"]`)!.click();
  await el.updateComplete;
}

function modal(el: SectionsScreen, testId: string): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(`wt-modal[data-test="${testId}"]`)!;
}

describe.each(["light", "dark"] as const)("sections screen (%s)", (theme) => {
  it.each(["empty", "populated", "failed"] as const)("accessible %s state", async (state) => {
    const { host } = await mount(state, theme);
    await expectNoA11yViolations(host);
  });

  it("accessible editor, with its wider use and members", async () => {
    const { el, host } = await mount("populated", theme);
    await clickInTable(el, "open-s-drinks");
    await vi.waitFor(() =>
      expect(
        modal(el, "editor").querySelector('[data-test="editor-used-in"]')!.textContent,
      ).toContain("Lunch Menu"),
    );
    await expectNoA11yViolations(host);
  });

  it("accessible editor refusing a blank name", async () => {
    const { el, host } = await mount("empty", theme);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-section"]')!.click();
    await el.updateComplete;
    modal(el, "editor").querySelector<HTMLElement>('[data-test="editor-save"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("accessible Add products view", async () => {
    const { el, host } = await mount("populated", theme);
    await clickInTable(el, "open-s-drinks");
    modal(el, "editor").querySelector<HTMLElement>('[data-test="open-add-products"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("accessible duplicate form", async () => {
    const { el, host } = await mount("populated", theme);
    await clickInTable(el, "duplicate-s-drinks");
    await expectNoA11yViolations(host);
  });

  it("accessible delete dialog listing where the section is used", async () => {
    const { el, host } = await mount("populated", theme);
    await clickInTable(el, "delete-s-beer");
    await vi.waitFor(() =>
      expect(modal(el, "delete").querySelector('[data-test="delete-sections"]')).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });
});
