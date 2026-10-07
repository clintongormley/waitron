import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { t, setLocale } from "../i18n/t.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { ProductEditor } from "./product-editor.js";
import type { DashboardApi } from "../api/client.js";
import "../screens/catalogue-screen.js";
import type { ProductEditorDraft } from "./product-editor-model.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const product: ProductEditorDraft = {
  name: "Coffee",
  customerName: null,
  description: null,
  kitchenName: null,
  image: null,
  unitId: null,
  unitPrice: "9.00",
  active: true,
  available: true,
  ordering: "public",
  vatClass: "reduced",
  variants: [],
  primaryCategoryId: null,
  color: null,
  modifiers: [],
  allergens: null,
  dietaryDeclarations: [],
  courseId: null,
};
class ProductLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  value: ProductEditorDraft | null = product;
  screenApi?: DashboardApi;
  cancelled = 0;
  open = true;
  override render() {
    return html`${
      this.screenApi
        ? html`<dashboard-catalogue-screen .api=${this.screenApi}></dashboard-catalogue-screen>`
        : html`<dashboard-product-editor
            .open=${this.open}
            .value=${this.value}
            .locales=${["en", "es"]}
            @wt-cancel=${() => {
              this.cancelled++;
              this.open = false;
              this.requestUpdate();
            }}
          ></dashboard-product-editor>`
    }${this.leave.render({
      heading: t("unsaved.heading"),
      message: t("unsaved.message"),
      keepLabel: t("unsaved.keep"),
      discardLabel: t("unsaved.discard"),
    })}`;
  }
}
customElements.define("product-leave-test-app", ProductLeaveApp);
async function mount(value: ProductEditorDraft | null = product) {
  const { el: app } = await mountWidget<ProductLeaveApp>("product-leave-test-app", { value });
  const editor = app.shadowRoot!.querySelector<ProductEditor>("dashboard-product-editor")!;
  await editor.updateComplete;
  const modal = editor.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  return { app, editor, modal };
}
async function edit(editor: ProductEditor, name: string, value: string) {
  const field = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=" + name + "]",
  )!;
  await field.updateComplete;
  const native = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(native), value);
  await editor.updateComplete;
}
async function question(app: ProductLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function cancel(editor: ProductEditor) {
  editor.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await editor.updateComplete;
}
for (const route of ["cancel", "escape"] as const) {
  it(`edited Product ${route} keeps the native editor and draft until Discard`, async () => {
    const { app, editor, modal } = await mount();
    await edit(editor, "name", "Edited coffee");
    if (route === "cancel") await cancel(editor);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(app.cancelled).toBe(0);
    expect(q.open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(editor.currentValue.name).toBe("Edited coffee");
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    await expect.poll(() => q.open).toBe(false);
    await closeReportsDelivered();
    expect(editor.currentValue.name).toBe("Edited coffee");
    expect(app.cancelled).toBe(0);
    await cancel(editor);
    await question(app);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await expect.poll(() => app.cancelled).toBe(1);
    await closeReportsDelivered();
    expect(app.cancelled).toBe(1);
    expect(editor.currentValue.name).toBe("Coffee");
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(false);
  });
}
it("reverted and trimmed-equivalent product values close directly", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "Different");
  await edit(editor, "name", " Coffee ");
  await cancel(editor);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("an Add draft uses its initialized creation defaults as its baseline", async () => {
  const { app, editor } = await mount(null);
  await edit(editor, "name", "Coffee");
  await cancel(editor);
  expect(app.cancelled).toBe(0);
  expect((await question(app)).open).toBe(true);
});
it("input changes and reverts immediately control native unload protection", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "Edited");
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  await edit(editor, "name", "Coffee");
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

async function change(editor: ProductEditor, selector: string, value: unknown) {
  editor
    .shadowRoot!.querySelector(selector)!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await editor.updateComplete;
}
it("valid decimal price spellings compare exactly while invalid raw input remains dirty", async () => {
  const { app, editor } = await mount();
  await change(editor, "[name=unit-price]", "9");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await change(editor, "[name=unit-price]", "009");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await cancel(editor);
  expect((await question(app)).open).toBe(true);
});
it("a dietary-only change immediately enables unload protection", async () => {
  const { editor } = await mount({ ...product, allergens: {} });
  await change(editor, "dashboard-allergen-dietary-picker", { allergens: [], dietary: ["vegan"] });
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
it("commits the exact submitted Product values and invalidates a pending close after write success", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", " Saved coffee ");
  let submitted: ProductEditorDraft | undefined;
  editor.addEventListener("wt-submit", (event) => {
    submitted = (event as CustomEvent<{ value: ProductEditorDraft }>).detail.value;
  });
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(submitted!.name).toBe("Saved coffee");
  await cancel(editor);
  expect((await question(app)).open).toBe(true);
  editor.commitSaved(submitted!);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(app.cancelled).toBe(0);
  await edit(editor, "name", "Later edit");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await cancel(editor);
  expect((await question(app)).open).toBe(true);
});
it("a refused save retains its edited values and still asks before closing", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "Refused coffee");
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  editor.fieldErrors = { name: "Refused by server" };
  await editor.updateComplete;
  await cancel(editor);
  expect((await question(app)).open).toBe(true);
  expect(editor.currentValue.name).toBe("Refused coffee");
  expect(app.cancelled).toBe(0);
});
it("replacing an open Product invalidates its old question and adopts the new baseline", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "Discarded old draft");
  await cancel(editor);
  expect((await question(app)).open).toBe(true);
  app.value = { ...product, name: "New product" };
  app.requestUpdate();
  await app.updateComplete;
  await editor.updateComplete;
  expect(editor.value?.name, "replacement input remains the new Product").toBe("New product");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(editor.currentValue.name).toBe("New product");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.cancelled).toBe(0);
});
it("adding an attachment preserves the original ordered list on Discard", async () => {
  const initial = {
    ...product,
    modifiers: [
      { kind: "extras" as const, id: "same" },
      { kind: "options" as const, id: "same" },
    ],
  };
  const { app, editor } = await mount(initial);
  editor.selectRelated("extras", "other");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await cancel(editor);
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  await expect.poll(() => app.cancelled).toBe(1);
  expect(editor.currentValue.modifiers).toEqual(initial.modifiers);
});

for (const succeeds of [true, false]) {
  it(`real Product write ${succeeds ? "success commits before a failed refresh" : "refusal keeps its draft dirty"}`, async () => {
    let refreshDirty: boolean | undefined;
    let written = false;
    const api = {
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      listCatalogues: async () => [{ id: "menu", name: "Menu", active: true, version: 1 }],
      listCategories: async () => [],
      listUnits: async () => [],
      listExtraLists: async () => [],
      listOptionLists: async () => [],
      listStations: async () => [],
      listCourses: async () => [],
      listProducts: async () => [],
      getFolderRouting: async () => null,
      listMadeAt: async () => {
        if (written) {
          refreshDirty = app.leave.coordinator.isDirty();
          throw { code: "connection.failed" };
        }
        return {};
      },
      createProductEditor: vi.fn(async () => {
        if (!succeeds) throw { code: "product.invalid", params: { field: "name" } };
        written = true;
        return { ...product, id: "created" };
      }),
      getMenuStructure: async () => ({ members: [] }),
    } as unknown as DashboardApi;
    Object.defineProperty(api, "background", { get: () => api });
    const { el: app } = await mountWidget<ProductLeaveApp>("product-leave-test-app", {
      screenApi: api,
    });
    const screen = app.shadowRoot!.querySelector("dashboard-catalogue-screen")!;
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("dashboard-catalogue-browser")).not.toBeNull(),
    );
    screen.shadowRoot!.querySelector("dashboard-catalogue-browser")!.dispatchEvent(
      new CustomEvent("add-product", {
        detail: { categoryId: null },
        bubbles: true,
        composed: true,
      }),
    );
    await screen.updateComplete;
    const editor = screen.shadowRoot!.querySelector<ProductEditor>("dashboard-product-editor")!;
    await editor.updateComplete;
    await edit(editor, "name", " Saved product ");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await vi.waitFor(() => expect(api.createProductEditor).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createProductEditor).mock.calls[0]![1]).toMatchObject({
      name: "Saved product",
      unitPrice: "0.00",
    });
    if (succeeds) {
      await expect.poll(() => refreshDirty).toBe(false);
      await expect.poll(() => editor.open).toBe(false);
      expect(app.leave.coordinator.isDirty()).toBe(false);
      expect((await question(app)).open).toBe(false);
    } else {
      await expect.poll(() => editor.busy).toBe(false);
      expect(editor.currentValue.name).toBe(" Saved product ");
      expect(app.leave.coordinator.isDirty()).toBe(true);
      await cancel(editor);
      expect((await question(app)).open).toBe(true);
    }
  });
}

for (const route of ["cancel", "escape"] as const) {
  it(`nested Variant ${route} protects only the child and retains the parent Product draft`, async () => {
    const { app, editor } = await mount();
    await edit(editor, "name", "Parent draft");
    editor.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
    await editor.updateComplete;
    const child = editor.shadowRoot!.querySelector("dashboard-variant-form")!;
    await child.updateComplete;
    const field =
      child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!;
    await field.updateComplete;
    await userEvent.fill(
      page.elementLocator(field.shadowRoot!.querySelector("input")!),
      "Child draft",
    );
    await child.updateComplete;
    if (route === "cancel")
      child.shadowRoot!.querySelector<HTMLElement>("[data-test=variant-cancel]")!.click();
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(
      child.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    expect(field.shadowRoot!.querySelector("input")!.value).toBe("Child draft");
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await expect.poll(() => child.open).toBe(false);
    await closeReportsDelivered();
    expect(editor.currentValue.name).toBe("Parent draft");
    expect(editor.currentValue.variants).toEqual([]);
    expect(app.cancelled).toBe(0);
    expect(app.leave.coordinator.isDirty()).toBe(true);
  });
}
it("a saved nested Variant commits only its child and leaves the Product unsaved", async () => {
  const { app, editor } = await mount();
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await editor.updateComplete;
  const child = editor.shadowRoot!.querySelector("dashboard-variant-form")!;
  await child.updateComplete;
  const field =
    child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    " Half cup ",
  );
  await child.updateComplete;
  expect(app.leave.coordinator.isDirty([child])).toBe(true);
  child.shadowRoot!.querySelector<HTMLElement>("[data-test=variant-save]")!.click();
  await expect.poll(() => child.open).toBe(false);
  await closeReportsDelivered();
  expect(editor.currentValue.variants).toEqual([
    {
      name: "Half cup",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
      active: true,
    },
  ]);
  expect(app.leave.coordinator.isDirty([child])).toBe(false);
  expect(app.leave.coordinator.isDirty([editor])).toBe(true);
  expect((await question(app)).open).toBe(false);
  await cancel(editor);
  expect((await question(app)).open).toBe(true);
});
it("a clean nested Variant closes directly while retaining an edited Product", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "Parent draft");
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await editor.updateComplete;
  const child = editor.shadowRoot!.querySelector("dashboard-variant-form")!;
  await child.updateComplete;
  child.shadowRoot!.querySelector<HTMLElement>("[data-test=variant-cancel]")!.click();
  await expect.poll(() => child.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(editor.currentValue.name).toBe("Parent draft");
});

it("an enclosing clean Product includes its dirty Variant in a leave request", async () => {
  const { app, editor } = await mount();
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await editor.updateComplete;
  const child = editor.shadowRoot!.querySelector("dashboard-variant-form")!;
  await child.updateComplete;
  const field =
    child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Child only",
  );
  expect(editor.currentValue.name).toBe("Coffee");
  expect(app.leave.coordinator.isDirty([editor])).toBe(true);
  let proceeded = 0;
  const pending = app.leave.coordinator.request({
    scopes: [editor],
    reason: "navigation",
    proceed() {
      proceeded++;
    },
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  expect(await pending).toBe("kept");
  expect(proceeded).toBe(0);
  expect(field.shadowRoot!.querySelector("input")!.value).toBe("Child only");
});
it("modifier display order is dirty even when every list still belongs to the Product", async () => {
  const initial = {
    ...product,
    modifiers: [
      { kind: "extras" as const, id: "same" },
      { kind: "options" as const, id: "same" },
    ],
  };
  const { app, editor } = await mount(initial);
  editor.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-options:same"]')!.focus();
  await userEvent.keyboard("{ArrowUp}");
  await editor.updateComplete;
  expect(editor.currentValue.modifiers).toEqual([...initial.modifiers].reverse());
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{ArrowDown}");
  await editor.updateComplete;
  expect(editor.currentValue.modifiers).toEqual(initial.modifiers);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("the submitted baseline does not swallow edits made after pressing Save", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "First submission");
  let submitted: ProductEditorDraft | undefined;
  editor.addEventListener("wt-submit", (event) => {
    submitted = (event as CustomEvent<{ value: ProductEditorDraft }>).detail.value;
  });
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await edit(editor, "name", "Later draft");
  editor.commitSaved(submitted!);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await cancel(editor);
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  await expect.poll(() => app.cancelled).toBe(1);
  expect(editor.currentValue.name).toBe("First submission");
});
it("disposing an edited Product unregisters unload protection and aborts its question", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "Detached draft");
  await cancel(editor);
  expect((await question(app)).open).toBe(true);
  editor.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.cancelled).toBe(0);
});
it("keeping the Product returns focus to its visible name input", async () => {
  const { app, editor } = await mount();
  await edit(editor, "name", "Kept draft");
  const field =
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!;
  const native = field.shadowRoot!.querySelector("input")!;
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await expect.poll(() => q.open).toBe(false);
  await closeReportsDelivered();
  expect(field.shadowRoot!.activeElement).toBe(native);
  expect(native.value).toBe("Kept draft");
});

it("dietary membership compares by values while modifier order still counts", async () => {
  const { app, editor } = await mount({
    ...product,
    allergens: {},
    dietaryDeclarations: ["halal", "vegan"],
  });
  await change(editor, "dashboard-allergen-dietary-picker", {
    allergens: [],
    dietary: ["vegan", "halal"],
  });
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await cancel(editor);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("equivalent nested Variant prices are clean and invalid raw prices are protected", async () => {
  const { app, editor } = await mount({
    ...product,
    variants: [
      {
        id: "half",
        name: "Half cup",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "9.00",
        active: true,
        available: true,
      },
    ],
  });
  editor
    .shadowRoot!.querySelector("dashboard-variant-table")!
    .dispatchEvent(
      new CustomEvent("wt-edit", { detail: { index: 0 }, bubbles: true, composed: true }),
    );
  await editor.updateComplete;
  const child = editor.shadowRoot!.querySelector("dashboard-variant-form")!;
  await child.updateComplete;
  const field = child.shadowRoot!.querySelector("[name=unitPrice]")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "9" }, bubbles: true, composed: true }),
  );
  await child.updateComplete;
  expect(app.leave.coordinator.isDirty([child])).toBe(false);
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "009" }, bubbles: true, composed: true }),
  );
  await child.updateComplete;
  expect(app.leave.coordinator.isDirty([child])).toBe(true);
  child.shadowRoot!.querySelector<HTMLElement>("[data-test=variant-cancel]")!.click();
  expect((await question(app)).open).toBe(true);
});

it("Product ancestry includes a nested image editor without editing the Product's own fields", async () => {
  await import("@waitron/dashboard-modules");
  const { app, editor } = await mount();
  editor.api = {
    imageLibraryRequest: vi.fn().mockResolvedValue({ images: [], total: 0 }),
  } as unknown as DashboardApi;
  await editor.updateComplete;
  const upload = editor.shadowRoot!.querySelector("dashboard-image-upload")!;
  await upload.updateComplete;
  upload.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
  await upload.updateComplete;
  const picker = upload.shadowRoot!.querySelector("media-image-picker")!;
  await (picker as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const library = picker.shadowRoot!.querySelector("dashboard-image-library")!;
  await library.updateComplete;
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
  await library.updateComplete;
  const field =
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-modal wt-input")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Nested photo",
  );
  expect(app.leave.coordinator.isDirty([editor])).toBe(true);
  expect(editor.currentValue.name).toBe("Coffee");
});
