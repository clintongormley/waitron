import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { ModifiersScreen } from "./modifiers-screen.js";
import type { CatalogueSummary, DashboardApi, ExtraList, OptionList } from "../api/client.js";

afterEach(cleanupWidgets);

const catalogues: CatalogueSummary[] = [{ id: "cat-1", name: "Main", active: true, version: 1 }];

/** The three names read differently, so a surface showing the wrong one is visible (CLAUDE.md §3). */
const optionList: OptionList = {
  id: "o1",
  name: "Doneness",
  customerName: { es: "Punto de la carne" },
  kitchenName: "DONE",
  defaultLabelId: "l1",
  active: true,
  labels: [
    {
      id: "l1",
      name: "Rare",
      customerName: { es: "Poco hecho" },
      kitchenName: "RAR",
      available: true,
    },
  ],
};

const extraList: ExtraList = {
  id: "e1",
  name: "Breads",
  customerName: { es: "Elige tu pan" },
  kitchenName: "BRD",
  minPicks: 1,
  maxPicks: 1,
  active: true,
  items: [],
};

function api(state: "empty" | "populated" | "failed"): DashboardApi {
  const lists = <T>(value: T[]) =>
    state === "failed"
      ? vi.fn().mockRejectedValue(new Error("offline"))
      : vi.fn().mockResolvedValue(state === "empty" ? [] : value);
  return {
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listProducts: vi.fn().mockResolvedValue([]),
    listExtraLists: lists([extraList]),
    listOptionLists: lists([optionList]),
    getExtraListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Café" }],
      menus: [{ id: "mn1", name: "Desayuno" }],
    }),
    getOptionListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Solomillo" }],
      menus: [{ id: "mn1", name: "Menú noche" }],
    }),
  } as unknown as DashboardApi;
}

async function settle(el: ModifiersScreen): Promise<void> {
  await vi.waitFor(() => {
    if (el.shadowRoot!.querySelector('[role="status"]')) throw new Error("loading");
  });
}

async function selectTab(el: ModifiersScreen, key: string): Promise<void> {
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

/** Click a control inside one tab's table (its cells live in the table's shadow root). */
async function clickInTable(el: ModifiersScreen, testId: string, control: string): Promise<void> {
  const found = el.shadowRoot!.querySelector(`[data-test="${testId}"]`) as unknown as {
    updateComplete: Promise<unknown>;
    shadowRoot: ShadowRoot;
  };
  await found.updateComplete;
  found.shadowRoot.querySelector<HTMLElement>(`[data-test="${control}"]`)!.click();
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("modifiers screen (%s)", (theme) => {
  it.each(["empty", "populated", "failed"] as const)("accessible %s state", async (state) => {
    const { el, host } = await mountWidget<ModifiersScreen>(
      "dashboard-modifiers-screen",
      { api: api(state) },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });

  it("accessible Options tab", async () => {
    const { el, host } = await mountWidget<ModifiersScreen>(
      "dashboard-modifiers-screen",
      { api: api("populated") },
      theme,
    );
    await settle(el);
    await selectTab(el, "options");
    await expectNoA11yViolations(host);
  });

  it.each([
    ["extras", "extra-lists", "open-extra-e1"],
    ["options", "option-lists", "open-option-o1"],
  ] as const)("accessible %s detail modal", async (tab, testId, control) => {
    const { el, host } = await mountWidget<ModifiersScreen>(
      "dashboard-modifiers-screen",
      { api: api("populated") },
      theme,
    );
    await settle(el);
    if (tab === "options") await selectTab(el, "options");
    await clickInTable(el, testId, control);
    const modal = el.shadowRoot!.querySelector('wt-modal[data-test="detail-modal"]')!;
    await vi.waitFor(() => expect(modal.querySelector('[data-test="list-usage"]')).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  it.each([
    ["extras", "extra-lists", "delete-extra-e1"],
    ["options", "option-lists", "delete-option-o1"],
  ] as const)(
    "accessible %s delete dialog with a dependants preview",
    async (tab, testId, control) => {
      const { el, host } = await mountWidget<ModifiersScreen>(
        "dashboard-modifiers-screen",
        { api: api("populated") },
        theme,
      );
      await settle(el);
      if (tab === "options") await selectTab(el, "options");
      await clickInTable(el, testId, control);
      const dialog = el.shadowRoot!.querySelector('wt-modal[data-test="delete-dialog"]')!;
      await vi.waitFor(() =>
        expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
    },
  );

  it.each([
    ["extras", "add-extra-list", "dashboard-extra-list-form"],
    ["options", "add-option-list", "dashboard-option-list-form"],
  ] as const)("accessible %s editor", async (tab, control, formTag) => {
    const { el, host } = await mountWidget<ModifiersScreen>(
      "dashboard-modifiers-screen",
      { api: api("populated") },
      theme,
    );
    await settle(el);
    if (tab === "options") await selectTab(el, "options");
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${control}"]`)!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector(formTag)!;
    await form.updateComplete;
    await expectNoA11yViolations(host);
  });
});
