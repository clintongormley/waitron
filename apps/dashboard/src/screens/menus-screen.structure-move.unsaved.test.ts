import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { LeaveController, NavigationGuard, registerIcons, type WtPriceInput } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, Product } from "../api/client.js";
import type { MenuReadPart, MenuStructureNode } from "../api/menu-api.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  cleanupWidgets,
  documentProduct,
  menuDocument,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import type { MenusScreen } from "./menus-screen.js";
import "./menus-screen.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

class StructureMoveLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-menus-screen .api=${this.api}></dashboard-menus-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("structure-move-leave-test-app", StructureMoveLeaveApp);

/** A menu holding Burger at its top level and an empty Drinks section. */
function client(
  save: () => Promise<unknown> = async () => ({ dropped: [] }),
  current = false,
  variants: Product["variants"] = [],
) {
  const nodes: MenuStructureNode[] = [
    { memberId: "m-burger", ref: { kind: "product", productId: "p-burger" } },
    {
      memberId: "m-drinks",
      ref: { kind: "section", sectionId: "s-drinks" },
      internalName: "Drinks",
      names: {},
      image: null,
      color: null,
      ownerMenuId: "menu",
      children: [],
    },
  ];
  const reads = {
    structure: async () => ({
      rootSectionId: "root",
      root: { id: "root", internalName: "Menu", names: {}, image: null, color: null, members: [] },
      includable: [],
      includedBy: [],
      nodes: structuredClone(nodes),
    }),
    home: async () => ({
      homeSectionId: "home",
      shortcuts: [],
      order: "home_first",
    }),
    prices: async () => [],
    status: async () =>
      current
        ? { state: "current", clashes: 0, version: 1, publishedAt: "2026-11-26T10:00:00Z" }
        : { state: "unpublished", clashes: 0 },
    preview: async () => ({
      setMenuProblems: [],
      live: null,
      clashes: [],
      hash: "b".repeat(64),
      changes: [],
      warnings: [],
      status: { state: "unpublished", clashes: 0 },
      document: menuDocument([documentProduct("mi-burger", "p-burger")], { "p-burger": "Burger" }),
    }),
  };
  const api = {
    listMenus: async () => [{ id: "menu", name: "Menu", active: true }],
    listLibraryProducts: async () => [
      {
        id: "p-burger",
        name: "Burger",
        active: true,
        available: true,
        unitPrice: "8.00",
        modifiers: [],
        variants,
      },
    ],
    listCategories: async () => [],
    getMenuSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
    moveSectionMembersInto: vi.fn(async () => []),
    saveMenuStructure: vi.fn(save),
    getMenuStructure: () => reads.structure(),
    getMenuHome: () => reads.home(),
    getMenuStatus: () => reads.status(),
    getMenuPreview: () => reads.preview(),
    getMenuRead: async (_id: string, parts: readonly MenuReadPart[]) =>
      Object.fromEntries(
        await Promise.all(
          parts.map(async (part) => [part, { status: 200, body: await reads[part]() }]),
        ),
      ),
  } as unknown as DashboardApi & {
    moveSectionMembersInto: ReturnType<typeof vi.fn>;
    saveMenuStructure: ReturnType<typeof vi.fn>;
  };
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

async function mount(api: DashboardApi) {
  history.replaceState(null, "", "/menus/menu/menu/view/structure");
  const { el: app } = await mountWidget<StructureMoveLeaveApp>("structure-move-leave-test-app", {
    api,
  });
  const screen = app.shadowRoot!.querySelector<MenusScreen>("dashboard-menus-screen")!;
  const tree = () => screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!;
  const rows = () => tree().shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
  await vi.waitFor(() =>
    expect(rows().querySelector('tr[data-row-key="m-burger"]')).not.toBeNull(),
  );
  screen
    .shadowRoot!.querySelector('wt-icon-button[data-test="select"]')!
    .shadowRoot!.querySelector("button")!
    .click();
  await vi.waitFor(() =>
    expect(rows().querySelector('[data-test="select-m-burger"]')).not.toBeNull(),
  );
  rows().querySelector<HTMLInputElement>('[data-test="select-m-burger"]')!.click();
  const move = () =>
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="selection-move"]',
    )!;
  await vi.waitFor(() => expect(move().disabled).toBe(false));
  move().click();
  const window = () =>
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
      'wt-modal[data-test="move-selected"]',
    )!;
  await vi.waitFor(() => expect(window().open).toBe(true));
  const destination = () =>
    window().querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[name="destination"]',
    )!;
  await vi.waitFor(() => expect(destination()).not.toBeNull());
  return { app, screen, window, destination };
}

async function question(app: StructureMoveLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

function cancel(window: HTMLElementTagNameMap["wt-modal"]): void {
  window.querySelector<HTMLElement>('[data-test="move-selected-cancel"]')!.click();
}

it("closes on Cancel without asking when no destination is chosen", async () => {
  const { app, window } = await mount(client());
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(window());
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect((await question(app)).open).toBe(false);
});

it("asks before Escape discards a chosen destination, and Keep leaves the window open", async () => {
  const { app, window, destination } = await mount(client());
  await chooseOption(destination(), "s-drinks");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  await vi.waitFor(() => expect(q.open).toBe(false));
  expect(window().open).toBe(true);
  expect(destination().value).toBe("s-drinks");
});

it("asks before Escape discards a chosen destination, and Discard closes it", async () => {
  const { app, window, destination } = await mount(client());
  await chooseOption(destination(), "s-drinks");
  destination().focus();
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("stages the move and keeps its member id in the one Structure save", async () => {
  const api = client();
  const { app, screen, window, destination } = await mount(api);
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  expect(api.moveSectionMembersInto).not.toHaveBeenCalled();
  expect(api.saveMenuStructure).not.toHaveBeenCalled();
  expect(app.leave.coordinator.isDirty()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>('[data-test="structure-save"]')!.click();
  await vi.waitFor(() =>
    expect(api.saveMenuStructure).toHaveBeenCalledExactlyOnceWith("menu", {
      rootMembers: [{ id: "m-drinks", ref: { kind: "section", sectionId: "s-drinks" } }],
      sections: [
        {
          id: "s-drinks",
          internalName: "Drinks",
          names: {},
          image: null,
          color: null,
          members: [{ id: "m-burger", ref: { kind: "product", productId: "p-burger" } }],
        },
      ],
      prices: [],
    }),
  );
  await vi.waitFor(() => expect(app.leave.coordinator.isDirty()).toBe(false));
  expect((await question(app)).open).toBe(false);
});

it.each([undefined, "prices.1.price", "rootMembers.1.ref", "sections.1.internalName"])(
  "keeps the arrangement and allows retry when a Structure Save refusal has no visible field (%s)",
  async (field) => {
    const api = client(async () => {
      throw {
        code: "menu_section.member_duplicate",
        ...(field === undefined ? {} : { params: { field } }),
      };
    });
    const { app, screen, window, destination } = await mount(api);
    await chooseOption(destination(), "s-drinks");
    window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
    await vi.waitFor(() => expect(window().open).toBe(false));
    const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="structure-save"]',
    )!;
    save.click();
    await vi.waitFor(() =>
      expect(save.closest("wt-form-actions")!.error).toContain(
        codeMessage("menu_section.member_duplicate"),
      ),
    );
    expect(save.disabled).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    save.click();
    await vi.waitFor(() => expect(api.saveMenuStructure).toHaveBeenCalledTimes(2));
    expect(api.saveMenuStructure.mock.calls[1]).toEqual(api.saveMenuStructure.mock.calls[0]);
  },
);

it("asks before cancelling, and restores the saved placement only after Discard", async () => {
  const api = client();
  const { app, screen, window, destination } = await mount(api);
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  const cancel = screen.shadowRoot!.querySelector<HTMLElement>('[data-test="structure-cancel"]');
  expect(cancel).not.toBeNull();
  cancel!.click();
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(() => expect(q.open).toBe(false));
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.click(cancel!);
  await vi.waitFor(() => expect(q.open).toBe(true));
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await vi.waitFor(() => expect(app.leave.coordinator.isDirty()).toBe(false));
  const table = screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!;
  expect(table.nodes.map((node) => node.memberId)).toEqual(["m-burger", "m-drinks"]);
  expect(api.saveMenuStructure).not.toHaveBeenCalled();
});

it("stages an explicit price and the movement in the same Save", async () => {
  const api = client();
  const { screen, window, destination } = await mount(api);
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  const table = screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!;
  const field = () =>
    table
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("wt-price-input")
      ?.shadowRoot!.querySelector("input");
  await vi.waitFor(() => expect(field()).toBeInstanceOf(HTMLInputElement));
  await userEvent.fill(field()!, "9.25");
  expect(api.saveMenuStructure).not.toHaveBeenCalled();
  screen.shadowRoot!.querySelector<HTMLElement>('[data-test="structure-save"]')!.click();
  await vi.waitFor(() =>
    expect(api.saveMenuStructure).toHaveBeenCalledExactlyOnceWith(
      "menu",
      expect.objectContaining({ prices: [{ productId: "p-burger", price: "9.25" }] }),
    ),
  );
});

it.each([false, true])(
  "shows a refused price at Save or at its field (hidden: %s)",
  async (hidden) => {
    let refuse!: (error: unknown) => void;
    const pending = new Promise<never>((_, reject) => (refuse = reject));
    const api = client(() => pending);
    const { screen, window, destination } = await mount(api);
    await chooseOption(destination(), "s-drinks");
    window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
    await vi.waitFor(() => expect(window().open).toBe(false));
    const table = screen
      .shadowRoot!.querySelector("dashboard-menu-structure-table")!
      .shadowRoot!.querySelector("wt-data-table")!;
    const body = table.shadowRoot!;
    const price = () => body.querySelector("wt-price-input")!;
    await vi.waitFor(() => expect(price()).not.toBeNull());
    await userEvent.fill(price().shadowRoot!.querySelector("input")!, "9.25");
    const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="structure-save"]',
    )!;
    await userEvent.click(save);
    await vi.waitFor(() => expect(api.saveMenuStructure).toHaveBeenCalledOnce());
    if (hidden) {
      onTestFinished(() => sessionStorage.removeItem("waitron.menu-structure.table"));
      table.chooseFilter("available", ["no"]);
      await vi.waitFor(() => expect(price()).toBeNull());
    }
    refuse({ code: "product.invalid", params: { field: "prices.0.price" } });
    if (hidden) {
      await vi.waitFor(() =>
        expect(save.closest("wt-form-actions")!.error).toContain(codeMessage("product.invalid")),
      );
      table.chooseFilter("available", []);
    }
    await vi.waitFor(() => expect(price().error).toBe(codeMessage("product.invalid")));
    if (hidden) expect(price().value).toBe("9.25");
    else await vi.waitFor(() => expect(body.activeElement).toBe(price()));
    expect(save.disabled).toBe(false);
  },
);

it.each([false, true])(
  "places a section refusal where it can be read (hidden: %s)",
  async (hidden) => {
    const code = "menu_section.member_duplicate";
    const api = client(async () => {
      throw { code, params: { field: "sections.0.internalName" } };
    });
    const { screen, window, destination } = await mount(api);
    await chooseOption(destination(), "s-drinks");
    window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
    await vi.waitFor(() => expect(window().open).toBe(false));
    const table = screen
      .shadowRoot!.querySelector("dashboard-menu-structure-table")!
      .shadowRoot!.querySelector("wt-data-table")!;
    const body = table.shadowRoot!;
    const section = () => body.querySelector('tr[data-row-key="m-drinks"]');
    if (hidden) {
      onTestFinished(() => sessionStorage.removeItem("waitron.menu-structure.table"));
      table.chooseFilter("available", ["no"]);
      await vi.waitFor(() => expect(section()).toBeNull());
    }
    const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="structure-save"]',
    )!;
    await userEvent.click(save);
    if (hidden) {
      await vi.waitFor(() =>
        expect(save.closest("wt-form-actions")!.error).toBe(codeMessage(code)),
      );
    } else {
      await vi.waitFor(() =>
        expect(section()?.querySelector('[role="alert"]')?.textContent).toBe(codeMessage(code)),
      );
      await vi.waitFor(() =>
        expect(body.activeElement).toBe(section()!.querySelector("wt-row-actions")),
      );
      expect(save.closest("wt-form-actions")!.error).toBe("");
    }
    expect(save.disabled).toBe(false);
  },
);

it("focuses an out-of-range structure price and reenables Save after a correction", async () => {
  const api = client();
  const { screen, window, destination } = await mount(api);
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  const body = screen
    .shadowRoot!.querySelector("dashboard-menu-structure-table")!
    .shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
  const price = body.querySelector("wt-price-input")!;
  const input = price.shadowRoot!.querySelector("input")!;
  const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="structure-save"]',
  )!;
  await userEvent.fill(input, "10000000000");
  await userEvent.click(save);
  await vi.waitFor(() => expect(price.error).toBe(t("editor.price_invalid")));
  await vi.waitFor(() => expect(body.activeElement).toBe(price));
  expect(api.saveMenuStructure).not.toHaveBeenCalled();
  expect(save.disabled).toBe(true);
  await userEvent.fill(input, "9.25");
  await vi.waitFor(() => expect(save.disabled).toBe(false));
});

it("holds the tab until the manager accepts discarding the move", async () => {
  const { app, screen, window, destination } = await mount(client());
  const guard = new NavigationGuard(globalThis.window, {
    isDirty: () => app.leave.coordinator.isDirty(),
    request: (proceed, signal) =>
      app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
  });
  try {
    await chooseOption(destination(), "s-drinks");
    window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
    await vi.waitFor(() => expect(window().open).toBe(false));
    const tab = screen
      .shadowRoot!.querySelector("wt-tabs")!
      .shadowRoot!.querySelector<HTMLElement>('[data-key="home"]')!;
    await userEvent.click(tab);
    const q = await question(app);
    await vi.waitFor(() => expect(q.open).toBe(true));
    expect(location.pathname).toContain("/view/structure");
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!);
    await vi.waitFor(() => expect(location.pathname).toContain("/view/home"));
    expect(app.leave.coordinator.isDirty()).toBe(false);
  } finally {
    guard.dispose();
  }
});

it("names the row and variant price that Save dropped from the submitted arrangement", async () => {
  const api = client(
    async () => ({
      dropped: [
        { memberId: "m-burger", reason: "deleted" },
        { productId: "p-burger", variantId: "large", reason: "deleted" },
      ],
    }),
    false,
    [
      {
        id: "large",
        name: "Large portion",
        active: true,
        available: true,
        unitPrice: "8.00",
        customerName: null,
        kitchenName: "LARGE BURGER",
        image: null,
        allergensInherited: true,
        courseId: null,
        effective: {
          unitPrice: "8.00",
          allergens: null,
          vatClass: "general",
          takeawayVatRate: "21.00",
          primaryCategoryId: null,
          courseId: null,
        },
      },
    ],
  );
  const { screen, window, destination } = await mount(api);
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  const tree = screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!;
  await tree.setExpanded("m-drinks/m-burger", true);
  const field = tree
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<WtPriceInput>(
      'tr[data-row-key="m-drinks/m-burger/large"] wt-price-input',
    )!;
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, "9.25");
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>('[data-test="structure-save"]')!,
  );
  await vi.waitFor(() =>
    expect(
      screen.shadowRoot!.querySelector('[data-test="structure-dropped"]')?.textContent,
    ).toContain("Burger, Burger › Large portion"),
  );
  expect(api.saveMenuStructure).toHaveBeenCalledExactlyOnceWith(
    "menu",
    expect.objectContaining({
      prices: [{ productId: "p-burger", variantId: "large", price: "9.25" }],
    }),
  );
});

it("offers Save and review on a current menu and opens Preview only after the write", async () => {
  let finish!: (result: unknown) => void;
  const pending = new Promise((resolve) => (finish = resolve));
  const api = client(() => pending, true);
  const { screen, window, destination } = await mount(api);
  expect(screen.shadowRoot!.querySelector('[data-test="review-publish"]')).toBeNull();
  await chooseOption(destination(), "s-drinks");
  window().querySelector<HTMLElement>('[data-test="move-selected-save"]')!.click();
  await vi.waitFor(() => expect(window().open).toBe(false));
  const review = screen.shadowRoot!.querySelector<HTMLElement>('[data-test="review-publish"]');
  expect(review?.getAttribute("variant")).toBe("secondary");
  review!.click();
  const dialog = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    '[data-test="structure-review"]',
  )!;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  dialog.querySelector<HTMLElement>('[data-test="structure-save-review"]')!.click();
  await vi.waitFor(() => expect(api.saveMenuStructure).toHaveBeenCalledOnce());
  expect(location.pathname).toContain("/view/structure");
  finish({ dropped: [] });
  await vi.waitFor(() => expect(location.pathname).toContain("/view/preview"));
});

it("still asks after the screen was taken out of the page and put back", async () => {
  const { app, screen, window, destination } = await mount(client());
  await chooseOption(destination(), "s-drinks");
  await reattachAfterDetachedUpdate(screen);
  await vi.waitFor(() => expect(window()?.open).toBe(true));
  await vi.waitFor(() => expect(app.leave.coordinator.isDirty()).toBe(true));
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  await vi.waitFor(() => expect(q.open).toBe(true));
  expect(window().open).toBe(true);
});
