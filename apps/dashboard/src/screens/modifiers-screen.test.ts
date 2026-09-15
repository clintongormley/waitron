import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { ModifiersScreen } from "./modifiers-screen.js";
import type { DashboardApi, Modifier, ModifierDependants } from "../api/client.js";
import type { ModifierForm } from "../widgets/modifier-form.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
afterEach(cleanupWidgets);
// The deep-link tests below rewrite the address bar; restore it so later tests read a clean URL.
const originalHref = location.href;
afterEach(() => {
  history.replaceState(null, "", originalHref);
});
const modifier: Modifier = { id: "m", type: "text", name: { es: "Nota" }, available: true };
function api(overrides: Partial<DashboardApi> = {}) {
  return {
    listModifiers: vi.fn().mockResolvedValue([modifier]),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    createModifier: vi.fn().mockResolvedValue(modifier),
    updateModifier: vi.fn().mockResolvedValue(modifier),
    deleteModifier: vi.fn().mockResolvedValue(undefined),
    getModifierDependants: vi.fn().mockResolvedValue({ products: [], menus: [], orders: 0 }),
    ...overrides,
  } as unknown as DashboardApi;
}
async function mount(client = api()) {
  const { el } = await mountWidget<ModifiersScreen>("dashboard-modifiers-screen", { api: client });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  return el;
}
/** The entries of the modifier form's shared error summary, in order. */
async function summaryEntries(form: ModifierForm) {
  await form.updateComplete;
  const summary = form.shadowRoot!.querySelector("wt-form-error-summary");
  if (summary === null) return [];
  await summary.updateComplete;
  return [...summary.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent);
}
function submitText(form: ModifierForm) {
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { type: "text", name: { es: "Nota" }, available: true } },
      bubbles: true,
      composed: true,
    }),
  );
}
async function create(el: ModifiersScreen) {
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-modifier"]')!.click();
  await el.updateComplete;
  return el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!;
}
it("shows searchable rows and opens the shared form", async () => {
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table") as unknown as {
    rows: Modifier[];
    searchable: boolean;
  };
  // The table receives every row and searches them itself via each column's searchValue; the
  // screen no longer filters the list or renders its own search box.
  expect(table.rows).toEqual([modifier]);
  expect(table.searchable).toBe(true);
  expect(el.shadowRoot!.querySelector('[name="modifier-search"]')).toBeNull();
  expect((await create(el)).open).toBe(true);
});
it("adds a modifier from a header button with an accessible name", async () => {
  const el = await mount();
  const button = el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-modifier"]')!;
  expect(button.textContent).toContain(t("modifiers.add"));
  button.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(true);
});
it("configures the table to remember its view and default to Name ascending", async () => {
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")! as unknown as {
    viewKey: string;
    sortKey: string;
    sortDirection: string;
    searchable: boolean;
  };
  expect(table.viewKey).toBe("waitron.modifiers.table");
  expect(table.sortKey).toBe("name");
  expect(table.sortDirection).toBe("ascending");
  expect(table.searchable).toBe(true);
});
it("has no modifier-level Available column", async () => {
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")! as unknown as {
    columns: { key: string }[];
  };
  expect(table.columns.map((c) => c.key)).toEqual(["name", "type", "choices", "actions"]);
});
it("shows the number of choices for an extras or options modifier", async () => {
  const extras: Modifier = {
    id: "x",
    type: "extras",
    name: { es: "Toppings" },
    available: true,
    required: false,
    maxTotalQuantity: null,
    choices: [
      {
        id: "c1",
        name: { es: "Queso" },
        available: true,
        priceDelta: "1.50",
        maxQuantity: 1,
        preselected: false,
        vatClass: null,
        suitableFor: [],
      },
      {
        id: "c2",
        name: { es: "Jamón" },
        available: true,
        priceDelta: "2.00",
        maxQuantity: 1,
        preselected: false,
        vatClass: null,
        suitableFor: [],
      },
    ],
  };
  const el = await mount(api({ listModifiers: vi.fn().mockResolvedValue([extras]) }));
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  await vi.waitFor(() => expect(table.shadowRoot!.textContent).toContain("2"));
});
it("keeps failed saves in the form and closes after successful writes even if reload fails", async () => {
  const client = api({
    createModifier: vi
      .fn()
      .mockRejectedValueOnce({ code: "options.group_invalid" })
      .mockResolvedValue(modifier),
  });
  const el = await mount(client);
  const form = await create(el);
  const submit = () =>
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { type: "text", name: { es: "Nota" }, available: true } },
        bubbles: true,
        composed: true,
      }),
    );
  submit();
  await vi.waitFor(() => expect(Object.keys(form.fieldErrors)).not.toHaveLength(0));
  expect(form.open).toBe(true);
  vi.mocked(client.listModifiers).mockRejectedValue(new Error("load failed"));
  submit();
  await vi.waitFor(() => expect(form.open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});
it("refreshes with the passive client without replacing an open draft", async () => {
  const background = api();
  const liveData = new LiveData();
  const client = api({ background, liveData });
  const el = await mount(client);
  const form = await create(el);
  form
    .shadowRoot!.querySelector('[name="name-es"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Draft" } }));
  await form.updateComplete;
  liveData.invalidate([{ type: "option_groups", id: "m" }]);
  await vi.waitFor(() => expect(background.listModifiers).toHaveBeenCalled());
  expect(
    (form.shadowRoot!.querySelector('[name="name-es"]') as unknown as { value: string }).value,
  ).toBe("Draft");
});
it("shows failed initial loads and retries", async () => {
  const client = api({
    listModifiers: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([modifier]),
  });
  const { el } = await mountWidget<ModifiersScreen>("dashboard-modifiers-screen", { api: client });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="retry"]')!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
});
// The delete confirmation carries a dependants preview: it lists the products and menu items that
// would lose the modifier, blocks while an open order still uses it, and shows its own error when
// the preview cannot load. These mirror the categories screen's delete tests.
async function openDelete(el: ModifiersScreen) {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-m"]')!.click();
  await el.updateComplete;
}
function deleteDialog(el: ModifiersScreen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="delete-dialog"]',
  )!;
}
function confirmDelete(el: ModifiersScreen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="confirm-delete"]',
  )!;
}
it("shows a spinner in the delete dialog and keeps delete disabled until the preview resolves", async () => {
  let resolve!: (value: ModifierDependants) => void;
  const client = api({
    getModifierDependants: vi
      .fn()
      .mockReturnValue(new Promise<ModifierDependants>((r) => (resolve = r))),
  });
  const el = await mount(client);
  await openDelete(el);
  const dialog = deleteDialog(el);
  expect(dialog.querySelector("wt-spinner")).not.toBeNull();
  expect(confirmDelete(el).disabled).toBe(true);
  resolve({ products: [], menus: [], orders: 0 });
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  expect(dialog.querySelector("wt-spinner")).toBeNull();
});
it("lists the affected products and menu items and enables delete", async () => {
  const client = api({
    getModifierDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: { es: "Café" } }],
      menus: [{ id: "mn1", name: { es: "Desayuno" } }],
      orders: 0,
    }),
  });
  const el = await mount(client);
  await openDelete(el);
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
  );
  const warning = dialog.querySelector('[data-test="delete-warning"]')!;
  expect(warning.getAttribute("role")).toBe("alert");
  expect(warning.textContent).toContain(t("modifiers.delete_warning_intro"));
  expect(warning.textContent).toContain(
    t("modifiers.delete_warning_products").replace("{count}", "1"),
  );
  expect(warning.textContent).toContain(
    t("modifiers.delete_warning_menus").replace("{count}", "1"),
  );
  // The affected products and menu items now render in a wt-data-table (matching the categories
  // delete dialog), so their names live in the table's shadow root, not the host's light DOM.
  const deleteProducts = dialog.querySelector('[data-test="modifier-delete-products"]')!;
  const deleteMenus = dialog.querySelector('[data-test="modifier-delete-menus"]')!;
  await vi.waitFor(() => expect(deleteProducts.shadowRoot!.textContent).toContain("Café"));
  await vi.waitFor(() => expect(deleteMenus.shadowRoot!.textContent).toContain("Desayuno"));
  expect(dialog.querySelector('[data-test="orders-block"]')).toBeNull();
  expect(confirmDelete(el).disabled).toBe(false);
});
it("blocks deletion while an open order uses the modifier", async () => {
  const client = api({
    getModifierDependants: vi.fn().mockResolvedValue({ products: [], menus: [], orders: 2 }),
  });
  const el = await mount(client);
  await openDelete(el);
  const dialog = deleteDialog(el);
  await vi.waitFor(() => expect(dialog.querySelector('[data-test="orders-block"]')).not.toBeNull());
  expect(dialog.querySelector('[data-test="orders-block"]')!.textContent).toContain(
    t("modifiers.delete_orders_block"),
  );
  expect(confirmDelete(el).disabled).toBe(true);
});
it("shows no warning and enables delete when nothing depends on the modifier", async () => {
  const el = await mount();
  await openDelete(el);
  const dialog = deleteDialog(el);
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  expect(dialog.querySelector('[data-test="delete-warning"]')).toBeNull();
  expect(dialog.querySelector('[data-test="modifier-delete-products"]')).toBeNull();
  expect(dialog.querySelector('[data-test="modifier-delete-menus"]')).toBeNull();
  expect(dialog.querySelector('[data-test="orders-block"]')).toBeNull();
  expect(dialog.querySelector("wt-spinner")).toBeNull();
});
it("says the delete preview failed and keeps delete disabled", async () => {
  const client = api({
    getModifierDependants: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const el = await mount(client);
  await openDelete(el);
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  const err = dialog.querySelector('[data-test="dependants-error"]')!;
  expect(err.textContent).toContain(t("modifiers.delete_preview_error"));
  expect(err.getAttribute("role")).toBe("alert");
  expect(dialog.querySelector("wt-spinner")).toBeNull();
  expect(confirmDelete(el).disabled).toBe(true);
});
it("keeps a rejected delete in the dialog with its reason, then closes and reloads on success", async () => {
  const client = api({
    deleteModifier: vi
      .fn()
      .mockRejectedValueOnce({
        code: "modifier.in_use",
        params: { dependency: "order", modifierId: "m" },
      })
      .mockResolvedValue(undefined),
  });
  const el = await mount(client);
  await openDelete(el);
  const dialog = deleteDialog(el);
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  expect(client.deleteModifier).not.toHaveBeenCalled();
  confirmDelete(el).click();
  await vi.waitFor(() => expect(client.deleteModifier).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(dialog.textContent).toContain(t("modifiers.in_use.order")));
  expect(dialog.open).toBe(true);
  // Retrying the same delete succeeds: the dialog closes and the list reloads.
  confirmDelete(el).click();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(client.deleteModifier).toHaveBeenLastCalledWith("m");
  expect(client.listModifiers).toHaveBeenCalledTimes(2);
});
// A failed preview on one modifier must not poison the next dialog: reopening mints a fresh
// generation, so the stale rejection is discarded.
it("clears a failed delete preview when the dialog is reopened", async () => {
  const client = api({
    getModifierDependants: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ products: [], menus: [], orders: 0 }),
  });
  const el = await mount(client);
  await openDelete(el);
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await el.updateComplete;
  await openDelete(el);
  await vi.waitFor(async () => {
    await el.updateComplete;
    expect(confirmDelete(el).disabled).toBe(false);
  });
  expect(dialog.querySelector('[data-test="dependants-error"]')).toBeNull();
});
// The reopen test above lets the first fetch fully settle before reopening, so it never has two
// requests in flight at once — it cannot catch a stale response clobbering a fresh one. These two
// exercise the actual race the generation guard exists for: two fetches for the SAME modifier in
// flight at once, where the older one settles LATE and must be discarded. Following the categories
// suite, they open the same row TWICE WITHOUT closing (`#openDelete` has no guard against being
// called while already open), so the only thing under test is the generation guard — not wt-modal's
// `.open`/native-`wt-close` timing, which crosses a macrotask boundary a fixed wait cannot pin. A
// resolved/rejected promise's continuation and the Lit update it triggers are both microtask work,
// so `updateComplete` (awaited twice: once for the fetch's own continuation, once for the paint)
// genuinely settles the outcome. Remove EITHER `if (generation === this.#deleteGeneration)` check in
// #loadDependants and one of these goes red (proven by deletion).
it("ignores a stale preview success from an earlier open of the same modifier", async () => {
  let resolveFirst!: (value: ModifierDependants) => void;
  let rejectSecond!: (error: Error) => void;
  const client = api({
    getModifierDependants: vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ModifierDependants>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<ModifierDependants>((_resolve, reject) => (rejectSecond = reject)),
      ),
  });
  const el = await mount(client);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const clickDelete = () =>
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-m"]')!.click();
  clickDelete(); // first open — its fetch never resolves yet
  await el.updateComplete;
  clickDelete(); // reopen the SAME modifier without closing — a second, fresh fetch starts
  await el.updateComplete;
  const dialog = deleteDialog(el);
  rejectSecond(new Error("offline")); // the current (second) request fails
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  // The stale first request lands LATE with a DIFFERENT, successful (empty) outcome.
  resolveFirst({ products: [], menus: [], orders: 0 });
  await el.updateComplete;
  await el.updateComplete;
  // The stale success must not clear the error or enable Delete.
  expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull();
  expect(confirmDelete(el).disabled).toBe(true);
});
it("ignores a stale preview failure from an earlier open of the same modifier", async () => {
  let rejectFirst!: (error: Error) => void;
  let resolveSecond!: (value: ModifierDependants) => void;
  const client = api({
    getModifierDependants: vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ModifierDependants>((_resolve, reject) => (rejectFirst = reject)),
      )
      .mockImplementationOnce(
        () => new Promise<ModifierDependants>((resolve) => (resolveSecond = resolve)),
      ),
  });
  const el = await mount(client);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const clickDelete = () =>
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-m"]')!.click();
  clickDelete(); // first open — its fetch never resolves yet
  await el.updateComplete;
  clickDelete(); // reopen the SAME modifier without closing — a second, fresh fetch starts
  await el.updateComplete;
  const dialog = deleteDialog(el);
  resolveSecond({ products: [], menus: [], orders: 0 }); // the current (second) request succeeds
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  rejectFirst(new Error("offline")); // the stale first request fails LATE
  await el.updateComplete;
  await el.updateComplete;
  // The stale failure must not surface the error block or disable Delete.
  expect(dialog.querySelector('[data-test="dependants-error"]')).toBeNull();
  expect(confirmDelete(el).disabled).toBe(false);
});
it("displays only enabled content translations", async () => {
  const { setLocale } = await import("../i18n/t.js");
  setLocale("en");
  try {
    const el = await mount(
      api({
        listModifiers: vi
          .fn()
          .mockResolvedValue([{ ...modifier, name: { es: "Nota", en: "Hidden English" } }]),
        getContentLanguages: vi
          .fn()
          .mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
      }),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.textContent).toContain("Nota");
    expect(table.shadowRoot!.textContent).not.toContain("Hidden English");
  } finally {
    setLocale("es");
  }
});
it("passes structured server validation fields into the reusable form", async () => {
  const client = api({
    createModifier: vi
      .fn()
      .mockRejectedValue({ code: "modifier.invalid", params: { field: "choices.0.priceDelta" } }),
  });
  const el = await mount(client);
  const form = await create(el);
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { type: "text", name: { es: "Nota" }, available: true } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(form.fieldErrors["choices.0.priceDelta"]).toBeTruthy());
});
it("shows a field-less server rejection's own message in the form", async () => {
  const client = api({
    updateModifier: vi.fn().mockRejectedValue({
      code: "modifier.in_use",
      params: { dependency: "choice", modifierId: "m" },
    }),
  });
  const el = await mount(client);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-m"]')!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!;
  submitText(form);
  await vi.waitFor(async () =>
    expect(await summaryEntries(form)).toEqual([t("modifiers.in_use.choice")]),
  );
  expect(form.open).toBe(true);
});
it("lists a field's server error once in the summary and shows it beside that field", async () => {
  const client = api({
    createModifier: vi
      .fn()
      .mockRejectedValue({ code: "modifier.invalid", params: { field: "name.es" } }),
  });
  const el = await mount(client);
  const form = await create(el);
  submitText(form);
  const message = codeMessage("modifier.invalid");
  await vi.waitFor(async () => expect(await summaryEntries(form)).toEqual([message]));
  expect(
    (form.shadowRoot!.querySelector('[name="name-es"]') as unknown as { error: string }).error,
  ).toBe(message);
});
// Clicking a modifier's name opens a read-only "products that use this modifier" modal, listing the
// products and menu items the shared `modifierDependants` query returns — mirroring the categories
// screen's products modal. These replace the old read-only details modal (removed with its
// choice-summary panel).
async function openProducts(el: ModifiersScreen, modifier: Modifier) {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>(`[data-test="open-${modifier.id}"]`)!.click();
  await el.updateComplete;
  return el.shadowRoot!.querySelector(
    'wt-modal[data-test="products-modal"]',
  )! as unknown as HTMLElement & {
    open: boolean;
  };
}
it("opens a products modal when a modifier row is clicked", async () => {
  const client = api({
    getModifierDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: { es: "Hamburguesa" } }],
      menus: [],
      orders: 0,
    }),
  });
  const el = await mount(client);
  const modal = await openProducts(el, modifier);
  expect(modal.open).toBe(true);
  expect(client.getModifierDependants).toHaveBeenCalledWith("m");
  const products = el.shadowRoot!.querySelector('[data-test="modifier-products"]')!;
  expect(products).not.toBeNull();
  await vi.waitFor(() => expect(products.shadowRoot!.textContent).toContain("Hamburguesa"));
});
it("lists the menu items using a modifier in the products modal", async () => {
  const client = api({
    getModifierDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: { es: "Hamburguesa" } }],
      menus: [{ id: "mn1", name: { es: "Menú del día" } }],
      orders: 0,
    }),
  });
  const el = await mount(client);
  await openProducts(el, modifier);
  const menus = el.shadowRoot!.querySelector('[data-test="modifier-usage-menus"]')!;
  await vi.waitFor(() => expect(menus.shadowRoot!.textContent).toContain("Menú del día"));
});
it("shows a spinner then Close in the products modal, and closes it", async () => {
  let resolve!: (value: ModifierDependants) => void;
  const client = api({
    getModifierDependants: vi
      .fn()
      .mockReturnValue(new Promise<ModifierDependants>((r) => (resolve = r))),
  });
  const el = await mount(client);
  const modal = await openProducts(el, modifier);
  expect(modal.querySelector("wt-spinner")).not.toBeNull();
  resolve({ products: [], menus: [], orders: 0 });
  await vi.waitFor(() => expect(modal.querySelector("wt-spinner")).toBeNull());
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="close-products"]')!.click();
  await el.updateComplete;
  expect(modal.open).toBe(false);
});
it("says the products modal preview failed", async () => {
  const client = api({
    getModifierDependants: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const el = await mount(client);
  const modal = await openProducts(el, modifier);
  await vi.waitFor(() => expect(modal.querySelector('[data-test="usage-error"]')).not.toBeNull());
  expect(modal.querySelector('[data-test="usage-error"]')!.textContent).toContain(
    t("modifiers.usage_error"),
  );
});
it("dismisses the products modal when it closes itself", async () => {
  const el = await mount();
  const modal = await openProducts(el, modifier);
  expect(modal.open).toBe(true);
  modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(modal.open).toBe(false);
});
// A `?modifier=<id>` deep link opens that modifier's editor once, then clears the param so a refresh
// does not reopen it — mirroring the categories screen's `?category=<id>` behaviour.
it("opens the editor for a ?modifier=<id> deep link and clears the param", async () => {
  history.replaceState(null, "", "/manage/modifiers?modifier=m");
  const el = await mount();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(true),
  );
  expect(new URL(location.href).searchParams.get("modifier")).toBeNull();
});
it("ignores an unknown ?modifier=<id> deep link without opening the editor", async () => {
  history.replaceState(null, "", "/manage/modifiers?modifier=nope");
  const el = await mount();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(false);
});
