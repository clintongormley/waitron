import { LeaveController, registerIcons } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi, Product, ProductEditorValue } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import {
  menuProduct,
  menuProductApi,
  menuProductEditorValue,
  menuProductUnit,
} from "../testing/menu-product-fixture.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import {
  cleanupWidgets,
  dialogClosed,
  dialogMessageOf,
  expectNoA11yViolations,
  mountWidget,
} from "../widgets/test-helpers.js";
import "./menus-screen.js";

registerIcons(DASHBOARD_ICONS);
const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height);
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

class MenuProductTestApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-menus-screen
        .api=${this.api}
        .canEditProducts=${true}
      ></dashboard-menus-screen>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}

customElements.define("menu-product-test-app", MenuProductTestApp);

const address = "/menus/menu/menu-one/view/structure";

async function openMenu(overrides: Partial<DashboardApi> = {}, theme: "light" | "dark" = "light") {
  history.replaceState(null, "", address);
  const { el: app, host } = await mountWidget<MenuProductTestApp>(
    "menu-product-test-app",
    {
      api: { ...menuProductApi(), ...overrides } as DashboardApi,
    },
    theme,
  );
  const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
  const root = screen.shadowRoot!;
  const tree = () => root.querySelector("dashboard-menu-structure-table")!;
  const table = () => tree()?.shadowRoot?.querySelector("wt-data-table")?.shadowRoot;
  const row = () =>
    table()?.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-m-burger"]',
    );
  await expect.poll(row).toBeTruthy();
  const editor = () => root.querySelector<ProductEditor>("dashboard-product-editor");
  const rowAction = async (selector: string) => {
    row()!.show();
    await userEvent.click(page.elementLocator(row()!.querySelector<HTMLElement>(selector)!));
  };
  const open = async (photo = false) => {
    if (photo)
      await userEvent.click(
        page.elementLocator(table()!.querySelector('[data-test="color-m-burger"]')!),
      );
    else await rowAction('[data-test="edit-product-m-burger"]');
    await expect.poll(() => editor()?.open).toBe(true);
    await editor()!.updateComplete;
    return editor()!;
  };
  return { host, root, table, row, editor, rowAction, open };
}

async function changeName(editor: ProductEditor, name: string) {
  const input =
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), name);
}

it("saves a product, refreshes the same Structure row and returns focus to its menu", async () => {
  let product = menuProduct;
  const update = vi
    .fn<DashboardApi["updateProductEditor"]>()
    .mockImplementation(async (id, value) => {
      expect(id).toBe("p-burger");
      product = { ...product, name: value.name };
      return { ...menuProductEditorValue, name: value.name, declarationMenus: [] };
    });
  const menu = await openMenu({
    updateProductEditor: update,
    listLibraryProducts: async () => [product],
  });
  const editor = await menu.open();
  await changeName(editor, "Double burger");
  const modal = editor.shadowRoot!.querySelector("wt-modal")!;
  const closed = dialogClosed(modal);
  await userEvent.click(page.elementLocator(modal.querySelector('[data-test="save"]')!));
  await closed;
  await expect
    .poll(() =>
      menu
        .table()
        ?.querySelector('[data-row-key="m-burger"] [data-test="name"]')
        ?.textContent?.trim(),
    )
    .toBe("Double burger");
  expect(update).toHaveBeenCalledTimes(1);
  await expect.poll(() => menu.table()?.activeElement).toBe(menu.row());
});

it("returns focus to the Structure row after the live menu question closes", async () => {
  let product = menuProduct;
  const menu = await openMenu({
    listLibraryProducts: async () => [product],
    updateProductEditor: async (_id, body) => {
      product = { ...product, name: body.name };
      return {
        ...menuProductEditorValue,
        name: body.name,
        declarationMenus: [{ menuId: "menu-one", name: "Lunch", live: true, queued: [] }],
      };
    },
  });
  const editor = await menu.open();
  const focusRow = vi.spyOn(
    menu.root.querySelector("dashboard-menu-structure-table")!,
    "focusRowMenu",
  );
  await changeName(editor, "Double burger");
  const modal = editor.shadowRoot!.querySelector("wt-modal")!;
  const closed = dialogClosed(modal);
  await userEvent.click(page.elementLocator(modal.querySelector('[data-test="save"]')!));
  await closed;

  const question = page.getByRole("dialog", { name: "Update the live menus now?" });
  await expect.element(question).toBeVisible();
  await expect
    .poll(() => menu.table()?.querySelector('[data-test="name"]')?.textContent?.trim())
    .toBe("Double burger");
  expect(focusRow).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect.element(question).not.toBeInTheDocument();
  await expect.poll(() => menu.table()?.activeElement).toBe(menu.row());
  expect(focusRow).toHaveBeenCalled();
});

it("clears a pending live menu question when browser history leaves Structure", async () => {
  const menu = await openMenu({
    getMenuPrices: async () => [],
    updateProductEditor: async () => ({
      ...menuProductEditorValue,
      declarationMenus: [{ menuId: "menu-one", name: "Lunch", live: true, queued: [] }],
    }),
  });
  const editor = await menu.open();
  await changeName(editor, "Double burger");
  await userEvent.click(
    page.elementLocator(editor.shadowRoot!.querySelector('[data-test="save"]')!),
  );
  const question = page.getByRole("dialog", { name: "Update the live menus now?" });
  await expect.element(question).toBeVisible();

  history.replaceState(null, "", "/menus/menu/menu-one/view/prices");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.element(question).not.toBeInTheDocument();
  history.replaceState(null, "", address);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(menu.row).toBeTruthy();
  expect(menu.root.querySelector("dashboard-live-declarations-dialog")).toBeNull();
});

it("starts at the photo and returns there after opening a variant and pressing Escape", async () => {
  await page.viewport(1440, 900);
  const variant = {
    id: "half",
    name: "Half portion",
    customerName: { en: "Half burger" },
    kitchenName: "HALF BURGER",
    image: null,
    unitPrice: null,
    available: true,
    active: true,
    allergensInherited: true,
    effective: menuProduct,
    courseId: null,
  };
  const parent: Product = { ...menuProduct, variants: [variant] };
  const value: ProductEditorValue = { ...menuProductEditorValue, variants: parent.variants };
  const menu = await openMenu({
    listLibraryProducts: async () => [parent],
    getProductEditor: async (id) =>
      id === "half"
        ? {
            ...menuProductEditorValue,
            ...variant,
            parentId: parent.id,
            unitId: null,
            vatClass: null,
            inherited: menuProduct,
          }
        : value,
  });
  const editor = await menu.open(true);
  await expect
    .poll(() =>
      editor
        .shadowRoot!.querySelector("dashboard-image-upload")
        ?.shadowRoot?.activeElement?.getAttribute("data-test"),
    )
    .toBe("choose-image");
  const variants = editor.shadowRoot!.querySelector("dashboard-variant-table")!;
  const actions =
    variants.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-0"]',
    )!;
  actions.show();
  await userEvent.click(page.elementLocator(actions.querySelector('[data-test="open-0"]')!));
  await expect.poll(() => editor.open && editor.value?.id).toBe("half");
  const closed = dialogClosed(editor.shadowRoot!.querySelector("wt-modal")!);
  await userEvent.keyboard("{Escape}");
  await closed;
  await expect
    .poll(() => menu.table()?.activeElement?.getAttribute("data-test"))
    .toBe("color-m-burger");
  expect(location.pathname).toBe(address);
});

it("shows a product save refusal above Save and keeps the draft available", async () => {
  const menu = await openMenu({
    updateProductEditor: async () => {
      throw { code: "connection.failed" };
    },
  });
  const editor = await menu.open();
  await changeName(editor, "Double burger");
  const modal = editor.shadowRoot!.querySelector("wt-modal")!;
  const save = modal.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
  await userEvent.click(page.elementLocator(save));
  await expect.poll(() => dialogMessageOf(modal)).toBe(codeMessage("connection.failed"));
  expect(editor.open).toBe(true);
  expect(editor.currentValue.name).toBe("Double burger");
  expect(save.disabled).toBe(false);
});

it.each(["add", "remove", "select"] as const)(
  "a pending product read gives way to %s",
  async (action) => {
    let finishRead!: (value: ProductEditorValue) => void;
    const read = new Promise<ProductEditorValue>((resolve) => {
      finishRead = resolve;
    });
    const remove = vi.fn();
    const saveMenuStructure = vi.fn();
    const menu = await openMenu({
      getProductEditor: () => read,
      removeSectionMember: remove,
      saveMenuStructure,
    });
    await menu.rowAction('[data-test="edit-product-m-burger"]');
    if (action === "add") {
      menu.root.querySelector("dashboard-menu-structure-table")!.dispatchEvent(
        new CustomEvent("wt-structure-add", {
          detail: { action: "add-products", path: [] },
          bubbles: true,
          composed: true,
        }),
      );
      const picker = menu.root.querySelector<HTMLElementTagNameMap["wt-modal"]>(
        '[data-test="add-products"]',
      )!;
      await expect.poll(() => picker.open).toBe(true);
    } else if (action === "remove") {
      await menu.rowAction('[data-test="remove-m-burger"]');
      await expect.poll(menu.row).toBeFalsy();
    } else {
      const select = menu.root.querySelector<HTMLElement>('[data-test="select"]')!;
      await userEvent.click(page.elementLocator(select));
    }
    finishRead(menuProductEditorValue);
    await read;
    await new Promise(requestAnimationFrame);
    expect(remove).not.toHaveBeenCalled();
    expect(saveMenuStructure).not.toHaveBeenCalled();
    expect(menu.editor()?.open ?? false).toBe(false);
  },
);

it("leaves the tree available and reports an editor lookup refusal", async () => {
  const menu = await openMenu({
    listExtraLists: async () => {
      throw { code: "connection.failed" };
    },
  });
  await menu.rowAction('[data-test="edit-product-m-burger"]');
  await expect
    .poll(() => menu.root.querySelector('[data-test="structure-write-error"]')?.textContent?.trim())
    .toBe(codeMessage("connection.failed"));
  expect(menu.editor()?.open ?? false).toBe(false);
});

it("passes the menus lookups into the editor and can create a related unit", async () => {
  let units = [menuProductUnit];
  const created = {
    ...menuProductUnit,
    id: "carton",
    staffName: "Carton",
    staffAbbreviation: "ctn",
  };
  const menu = await openMenu({
    listUnits: async () => units,
    createUnit: async () => {
      units = [...units, created];
      return created;
    },
  });
  const editor = await menu.open();
  expect(editor.units.map(({ id }) => id)).toEqual(["each"]);
  await changeName(editor, "New burger");
  editor.dispatchEvent(
    new CustomEvent("wt-create-related", { detail: { kind: "unit" }, bubbles: true }),
  );
  const form = menu.root.querySelector("dashboard-unit-form")!;
  await expect.poll(() => form.open).toBe(true);
  form.dispatchEvent(new CustomEvent("wt-submit", { detail: { value: created }, bubbles: true }));
  await expect.poll(() => editor.currentValue.unitId).toBe("carton");
  await expect.poll(() => editor.units.some(({ id }) => id === "carton")).toBe(true);
  expect(editor.currentValue.name).toBe("New burger");
});

it.each(["light", "dark"] as const)("passes axe with the in-place dialog in %s", async (theme) => {
  const menu = await openMenu({}, theme);
  await menu.open();
  await expectNoA11yViolations(menu.host);
});

it.each(["saved", "other menu", "Prices"] as const)(
  "handles a late product answer for %s",
  async (result) => {
    const saved = result === "saved";
    let product = menuProduct;
    let finish!: () => void;
    const update = vi
      .fn<DashboardApi["updateProductEditor"]>()
      .mockImplementation(async (_id, body) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (!saved) throw { code: "connection.failed" };
        product = { ...product, name: body.name };
        return {
          ...menuProductEditorValue,
          name: body.name,
          declarationMenus: [{ menuId: "menu-one", name: "Lunch", live: true, queued: [] }],
        };
      });
    const menu = await openMenu({
      listMenus: async () => [
        { id: "menu-one", name: "Lunch", active: true, kind: "menu", setPrice: null },
        { id: "menu-two", name: "Dinner", active: true, kind: "menu", setPrice: null },
      ],
      getMenuPrices: async () => [],
      updateProductEditor: update,
      listLibraryProducts: async () => [product],
    });
    const editor = await menu.open();
    await changeName(editor, "Double burger");
    await userEvent.click(
      page.elementLocator(editor.shadowRoot!.querySelector('[data-test="save"]')!),
    );
    expect(update).toHaveBeenCalledTimes(1);
    const prices = result === "Prices";
    const destination = prices
      ? "/menus/menu/menu-one/view/prices"
      : "/menus/menu/menu-two/view/structure";
    history.replaceState(null, "", destination);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect
      .poll(() => menu.root.querySelector("h1")?.textContent?.trim())
      .toBe(prices ? "Lunch" : "Dinner");
    if (saved) {
      await expect.poll(menu.row).toBeTruthy();
      await menu.open();
    }
    finish();
    if (saved) {
      await expect
        .poll(() => menu.table()?.querySelector('[data-test="name"]')?.textContent?.trim())
        .toBe("Double burger");
    } else {
      await expect
        .poll(
          () => menu.root.querySelector('[data-test="member-error"]')?.textContent?.trim() ?? "",
        )
        .toContain("Burger");
    }
    expect(menu.editor()?.open ?? false).toBe(saved);
    expect(menu.root.querySelector("dashboard-live-declarations-dialog")).toBeNull();
    if (prices) {
      history.replaceState(null, "", address);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await expect.poll(menu.row).toBeTruthy();
      await menu.open();
      expect(menu.root.querySelector('[data-test="member-error"]')).toBeNull();
    }
  },
);

it.each([true, false])(
  "returns focus after refresh unless Search already has it (%s)",
  async (typing) => {
    const name = typing ? "Double burger" : "Salad";
    let rows = [menuProduct];
    let finishRefresh!: () => void;
    const menu = await openMenu({
      listLibraryProducts: async () =>
        rows[0]!.name === "Burger"
          ? rows
          : new Promise<Product[]>((resolve) => {
              finishRefresh = () => resolve(rows);
            }),
      updateProductEditor: async () => {
        rows = [{ ...menuProduct, name }];
        return { ...menuProductEditorValue, name, declarationMenus: [] };
      },
    });
    const search = menu.root.querySelector<HTMLElementTagNameMap["wt-input"]>(
      '[name="structure-search"]',
    )!;
    await userEvent.fill(page.elementLocator(search.shadowRoot!.querySelector("input")!), "Burger");
    const editor = await menu.open();
    await changeName(editor, name);
    const modal = editor.shadowRoot!.querySelector("wt-modal")!;
    const closed = dialogClosed(modal);
    await userEvent.click(page.elementLocator(modal.querySelector('[data-test="save"]')!));
    await closed;
    await expect.poll(() => typeof finishRefresh).toBe("function");
    if (typing)
      await userEvent.fill(page.elementLocator(search.shadowRoot!.querySelector("input")!), "Burg");
    finishRefresh();
    await expect
      .poll(() => menu.table()?.querySelector('[data-test="name"]')?.textContent?.trim() ?? "")
      .toBe(typing ? name : "");
    await new Promise(requestAnimationFrame);
    await expect.poll(() => menu.root.activeElement === search).toBe(true);
  },
);

it("clears a post-save read failure when the product list retry succeeds", async () => {
  let product = menuProduct;
  let fail = false;
  const menu = await openMenu({
    listLibraryProducts: async () => {
      if (fail) throw { code: "connection.failed" };
      return [product];
    },
    updateProductEditor: async () => {
      product = { ...product, name: "Double burger" };
      fail = true;
      return { ...menuProductEditorValue, name: product.name, declarationMenus: [] };
    },
  });
  const editor = await menu.open();
  await changeName(editor, "Double burger");
  await userEvent.click(
    page.elementLocator(editor.shadowRoot!.querySelector('[data-test="save"]')!),
  );
  await expect.poll(() => menu.root.querySelector('[data-test="load-error"]') !== null).toBe(true);
  fail = false;
  await userEvent.click(
    page.elementLocator(menu.root.querySelector<HTMLElement>('[data-test="retry"]')!),
  );
  await expect
    .poll(() => menu.table()?.querySelector('[data-test="name"]')?.textContent?.trim())
    .toBe("Double burger");
  expect(menu.root.querySelector('[data-test="structure-write-error"]')).toBeNull();
});

it("returns from Add category to Category, then back to the same Structure row", async () => {
  const menu = await openMenu();
  const editor = await menu.open();
  const category = editor.shadowRoot!.querySelector<HTMLElement>('[name="primary"]')!;
  await userEvent.click(category.shadowRoot!.querySelector("button")!);
  await userEvent.keyboard("{Home}{Enter}");
  const form = menu.root.querySelector("dashboard-category-create-form");
  expect(form).not.toBeNull();
  const modal = form!.shadowRoot!.querySelector("wt-modal")!;
  expect(modal.open).toBe(true);
  const childClosed = dialogClosed(modal);
  await userEvent.keyboard("{Escape}");
  await childClosed;
  await expect.poll(() => editor.shadowRoot!.activeElement).toBe(category);
  const editorClosed = dialogClosed(editor.shadowRoot!.querySelector("wt-modal")!);
  await userEvent.keyboard("{Escape}");
  await editorClosed;
  await expect.poll(() => menu.table()?.activeElement).toBe(menu.row());
});
