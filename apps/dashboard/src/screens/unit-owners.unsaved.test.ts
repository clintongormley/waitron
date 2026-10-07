import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi, UnitInput } from "../api/client.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import "./units-screen.js";
import "./catalogue-screen.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
class UnitOwnersApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  catalogue = false;
  override render() {
    return html`${
      this.catalogue
        ? html`<dashboard-catalogue-screen .api=${this.api}></dashboard-catalogue-screen>`
        : html`<dashboard-units-screen .api=${this.api}></dashboard-units-screen>`
    }${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("unit-owners-leave-test-app", UnitOwnersApp);
function api(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const client = {
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general" }),
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
    listMadeAt: async () => ({}),
    getMenuStructure: async () => ({ members: [] }),
    createUnit: async (input: UnitInput) => ({ id: "new-unit", ...input }),
    ...overrides,
  } as unknown as DashboardApi;
  Object.defineProperty(client, "background", { get: () => client });
  return client;
}
async function field(form: HTMLElement, name: string, value: string) {
  const input = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  )!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await (form as LitElement).updateComplete;
}
async function question(app: UnitOwnersApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
for (const succeeds of [true, false]) {
  it(`Units create ${succeeds ? "commits before its failed refresh" : "refusal retains an edited form"}`, async () => {
    let written = false;
    let dirtyDuringRefresh: boolean | undefined;
    const client = api({
      listUnits: async () => {
        if (written) {
          dirtyDuringRefresh = app.leave.coordinator.isDirty();
          throw { code: "connection.failed" };
        }
        return [];
      },
      createUnit: vi.fn(async (input: UnitInput) => {
        if (!succeeds)
          throw { code: "unit.translation_required", params: { language: "en", field: "name" } };
        written = true;
        return { id: "box", ...input };
      }),
    });
    const { el: app } = await mountWidget<UnitOwnersApp>("unit-owners-leave-test-app", {
      api: client,
    });
    const screen = app.shadowRoot!.querySelector("dashboard-units-screen")!;
    await vi.waitFor(() =>
      expect(
        screen.shadowRoot!.querySelector<HTMLElement>(".header-actions [data-test=create]"),
      ).not.toBeNull(),
    );
    screen.shadowRoot!.querySelector<HTMLElement>(".header-actions [data-test=create]")!.click();
    await screen.updateComplete;
    const form = screen.shadowRoot!.querySelector("dashboard-unit-form")!;
    await form.updateComplete;
    await field(form, "name-en", " Box ");
    await field(form, "abbreviation-en", " bx ");
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await vi.waitFor(() =>
      expect(client.createUnit).toHaveBeenCalledExactlyOnceWith({
        name: { en: "Box" },
        abbreviation: { en: "bx" },
        precision: 0,
      }),
    );
    if (succeeds) {
      await expect.poll(() => dirtyDuringRefresh).toBe(false);
      await expect.poll(() => form.open).toBe(false);
      expect(app.leave.coordinator.isDirty()).toBe(false);
      expect((await question(app)).open).toBe(false);
    } else {
      await expect.poll(() => form.busy).toBe(false);
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
      expect((await question(app)).open).toBe(true);
      expect(form.open).toBe(true);
    }
  });
}
async function relatedUnit(parentName?: string) {
  const client = api();
  const { el: app } = await mountWidget<UnitOwnersApp>("unit-owners-leave-test-app", {
    api: client,
    catalogue: true,
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
  const product = screen.shadowRoot!.querySelector<ProductEditor>("dashboard-product-editor")!;
  await product.updateComplete;
  if (parentName) {
    await field(product, "name", parentName);
    expect(product.currentValue.name).toBe(parentName);
  }
  product.dispatchEvent(
    new CustomEvent("wt-create-related", {
      detail: { kind: "unit" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("dashboard-unit-form")!;
  await form.updateComplete;
  return { app, screen, product, form, client };
}
it("a dirty Related Unit blocks an ancestor leave request for its clean Product", async () => {
  const { app, product, form } = await relatedUnit();
  await field(form, "name-en", "Child draft");
  expect(app.leave.coordinator.isDirty([product])).toBe(true);
  let left = false;
  const leaving = app.leave.coordinator.request({
    scopes: [product],
    reason: "navigation",
    proceed() {
      left = true;
    },
  });
  expect((await question(app)).open).toBe(true);
  expect(product.open).toBe(true);
  expect(form.open).toBe(true);
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  expect(await leaving).toBe("kept");
  expect(left).toBe(false);
});
it("Related Unit Save commits the child before attaching its id and leaves the Product dirty", async () => {
  const { app, product, form } = await relatedUnit("Parent draft");
  await field(form, "name-en", "Box");
  await field(form, "abbreviation-en", "bx");
  let childDirtyAtAttach: boolean | undefined;
  const select = product.selectRelated.bind(product);
  product.selectRelated = (kind, id) => {
    childDirtyAtAttach = app.leave.coordinator.isDirty([form]);
    select(kind, id);
  };
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  await expect.poll(() => childDirtyAtAttach).toBe(false);
  await expect.poll(() => form.open).toBe(false);
  expect(product.currentValue).toMatchObject({ name: "Parent draft", unitId: "new-unit" });
  expect(app.leave.coordinator.isDirty([product])).toBe(true);
  await closeReportsDelivered();
  product.shadowRoot!.querySelector<HTMLElement>('[slot="cancel"]')!.click();
  expect((await question(app)).open).toBe(true);
});
