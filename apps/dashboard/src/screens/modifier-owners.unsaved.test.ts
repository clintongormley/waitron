import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi, ExtraListInput, OptionListInput } from "../api/client.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./modifiers-screen.js";
import "./catalogue-screen.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
class ModifierOwnersApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  catalogue = false;
  override render() {
    return html`${
      this.catalogue
        ? html`<dashboard-catalogue-screen .api=${this.api}></dashboard-catalogue-screen>`
        : html`<dashboard-modifiers-screen .api=${this.api}></dashboard-modifiers-screen>`
    }${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("modifier-owners-leave-test-app", ModifierOwnersApp);
function api(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const client = {
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general" }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    listCatalogues: async () => [{ id: "menu", name: "Menu", active: true, version: 1 }],
    listCategories: async () => [],
    listUnits: async () => [],
    listExtraLists: async () => [
      {
        id: "extras",
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: false,
        items: [],
        usage: { products: 0 },
      },
    ],
    listOptionLists: async () => [
      {
        id: "options",
        name: "Options",
        customerName: null,
        kitchenName: null,
        active: false,
        labels: [],
        defaultLabelId: null,
        usage: { products: 0 },
      },
    ],
    listStations: async () => [],
    listCourses: async () => [],
    listProducts: async () => [],
    getFolderRouting: async () => null,
    listMadeAt: async () => ({}),
    getMenuStructure: async () => ({ members: [] }),

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
async function question(app: ModifierOwnersApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}

for (const kind of ["extras", "options"] as const) {
  for (const related of [false, true]) {
    it(`${related ? "Related" : "Modifiers"} ${kind} commits its write before refresh refusal`, async () => {
      let written = false;
      let dirtyAtRefresh: boolean | undefined;
      let writtenInput: ExtraListInput | OptionListInput | undefined;
      const client = api({
        [related
          ? kind === "extras"
            ? "createExtraList"
            : "createOptionList"
          : kind === "extras"
            ? "updateExtraList"
            : "updateOptionList"]: vi.fn(async (...args: unknown[]) => {
          const input = args.at(-1) as ExtraListInput | OptionListInput;
          writtenInput = input;
          written = true;
          return { id: kind, ...input };
        }),
      });
      const onRefresh = () => {
        if (written) {
          dirtyAtRefresh = app.leave.coordinator.isDirty([form]);
          throw { code: "connection.failed" };
        }
      };
      if (kind === "extras") {
        const read = client.listExtraLists.bind(client);
        client.listExtraLists = async () => {
          onRefresh();
          return await read();
        };
      } else {
        const read = client.listOptionLists.bind(client);
        client.listOptionLists = async () => {
          onRefresh();
          return await read();
        };
      }
      const { el: app } = await mountWidget<ModifierOwnersApp>("modifier-owners-leave-test-app", {
        api: client,
        catalogue: related,
      });
      let product: ProductEditor | undefined;
      const screen = app.shadowRoot!.querySelector(
        related ? "dashboard-catalogue-screen" : "dashboard-modifiers-screen",
      )!;
      if (related) {
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
        product = screen.shadowRoot!.querySelector<ProductEditor>("dashboard-product-editor")!;
        await product.updateComplete;
        await field(product, "name", "Parent draft");
        product.dispatchEvent(
          new CustomEvent("wt-create-related", { detail: { kind }, bubbles: true, composed: true }),
        );
      } else {
        await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-tabs")).not.toBeNull());
        if (kind === "options") {
          screen.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
            new CustomEvent("wt-tab-change", {
              detail: { value: "options" },
              bubbles: true,
              composed: true,
            }),
          );
          await screen.updateComplete;
        }
        const table = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
          `[data-test="${kind === "extras" ? "extra" : "option"}-lists"]`,
        )!;
        await table.updateComplete;
        table
          .shadowRoot!.querySelector<HTMLElement>(
            `[data-test="edit-${kind === "extras" ? "extra" : "option"}-${kind}"]`,
          )!
          .click();
      }
      await screen.updateComplete;
      const form = screen.shadowRoot!.querySelector(
        kind === "extras" ? "dashboard-extra-list-form" : "dashboard-option-list-form",
      )!;
      await form.updateComplete;
      await field(form, "name", " Saved list ");
      if (related) {
        form.shadowRoot!.querySelector("wt-switch")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { checked: false },
            bubbles: true,
            composed: true,
          }),
        );
        await form.updateComplete;
      }
      expect(app.leave.coordinator.isDirty([form])).toBe(true);
      if (product) expect(app.leave.coordinator.isDirty([product])).toBe(true);
      let dirtyAtAttach: boolean | undefined;
      if (product) {
        const select = product.selectRelated.bind(product);
        product.selectRelated = (kind, id) => {
          dirtyAtAttach = app.leave.coordinator.isDirty([form]);
          select(kind, id);
        };
      }
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
      if (product) await expect.poll(() => dirtyAtAttach).toBe(false);
      await expect.poll(() => dirtyAtRefresh).toBe(false);
      expect(writtenInput).toEqual(
        kind === "extras"
          ? {
              name: "Saved list",
              customerName: null,
              kitchenName: null,
              minPicks: 0,
              maxPicks: null,
              active: false,
              items: [],
            }
          : {
              name: "Saved list",
              customerName: null,
              kitchenName: null,
              active: false,
              defaultLabelId: null,
              labels: [],
            },
      );
      expect(form.open).toBe(false);
      expect(app.leave.coordinator.isDirty([form])).toBe(false);
      if (product) {
        expect(app.leave.coordinator.isDirty([product])).toBe(true);
        expect(product.currentValue.name).toBe("Parent draft");
      }
      expect((await question(app)).open).toBe(false);
    });
  }
}
for (const kind of ["extras", "options"] as const) {
  it(`dirty Related ${kind} blocks leaving a clean Product`, async () => {
    const { el: app } = await mountWidget<ModifierOwnersApp>("modifier-owners-leave-test-app", {
      api: api(),
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
    product.dispatchEvent(
      new CustomEvent("wt-create-related", { detail: { kind }, bubbles: true, composed: true }),
    );
    await screen.updateComplete;
    const form = screen.shadowRoot!.querySelector(
      kind === "extras" ? "dashboard-extra-list-form" : "dashboard-option-list-form",
    )!;
    await form.updateComplete;
    await field(form, "name", "Child draft");
    expect(app.leave.coordinator.isDirty([product])).toBe(true);
    let left = false;
    const leaving = app.leave.coordinator.request({
      scopes: [product],
      reason: "navigation",
      proceed() {
        left = true;
      },
    });
    const q = await question(app);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    expect(await leaving).toBe("kept");
    expect(left).toBe(false);
    expect(form.open).toBe(true);
  });
}
