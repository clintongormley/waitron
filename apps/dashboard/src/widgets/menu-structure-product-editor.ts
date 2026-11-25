import { nothing, type LitElement } from "lit";
import type { CategorySummary, DashboardApi, MenuSettingsAnswer, Product } from "../api/client.js";
import type { ContentLanguages } from "@waitron/shared";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { ProductEditorDialog, type ProductEditorChoices } from "./product-editor-dialog.js";

export interface StructureProductEdit {
  productId: string;
  path: string[];
  field?: "image";
}

type Lookups = Pick<ProductEditorChoices, "units" | "courses" | "extraLists" | "optionLists">;

interface Effects {
  api(): DashboardApi;
  products(): Product[];
  categories(): CategorySummary[];
  settings(): MenuSettingsAnswer | null;
  languages(): ContentLanguages | null;
  showError(message: string | null): void;
  reportRefusal(name: string, error: unknown): void;
  refreshProducts(): Promise<void>;
  returnFocusTo(path: string[], photo: boolean): void;
  windowClosed(): void;
}

export class MenuStructureProductEditor {
  readonly #dialog: ProductEditorDialog;
  #lookup: Lookups = { units: [], courses: [], extraLists: [], optionLists: [] };
  #target: StructureProductEdit | null = null;
  #returning = false;

  constructor(
    host: LitElement,
    private readonly effects: Effects,
  ) {
    this.#dialog = new ProductEditorDialog(host, {
      api: effects.api,
      choices: () => this.#choices(),
      clearError: () => effects.showError(null),
      readError: (error) => effects.showError(codeMessage(codeOf(error))),
      opened: () => {
        if (this.#target) effects.returnFocusTo(this.#target.path, this.#target.field === "image");
      },
      closed: (alreadyClosed) => {
        this.#target = null;
        this.#returning = true;
        if (alreadyClosed) this.#afterClose();
      },
      afterClose: () => this.#afterClose(),
      saved: effects.refreshProducts,
      lateRefused: (product, error) => {
        if (product !== null) effects.reportRefusal(product.name, error);
      },
      changeChoices: async (kind, current) => {
        const api = this.#background();
        if (kind === "unit") {
          const units = await api.listUnits();
          if (current()) this.#lookup.units = units;
        } else if (kind === "extras") {
          const lists = await api.listExtraLists();
          if (current()) this.#lookup.extraLists = lists;
        } else if (kind === "options") {
          const lists = await api.listOptionLists();
          if (current()) this.#lookup.optionLists = lists;
        } else {
          const courses = await api.listCourses();
          if (current()) this.#lookup.courses = courses;
        }
        if (current()) host.requestUpdate();
      },
    });
  }

  #background(): DashboardApi {
    const api = this.effects.api();
    return api.background ?? api;
  }

  #choices(): ProductEditorChoices {
    return {
      ...this.#lookup,
      products: this.effects.products(),
      categories: this.effects.categories(),
      menuSettings: this.effects.settings(),
      contentLanguages: this.effects.languages(),
    };
  }

  open(target: StructureProductEdit): void {
    this.#target = target;
    this.#returning = false;
    void this.#dialog.openExisting(target.productId, target.field, async (current) => {
      const api = this.#background();
      const [units, courses, extraLists, optionLists] = await Promise.all([
        api.listUnits(),
        api.listCourses(),
        api.listExtraLists(),
        api.listOptionLists(),
      ]);
      if (current()) this.#lookup = { units, courses, extraLists, optionLists };
    });
  }

  get saving(): boolean {
    return this.#dialog.busy;
  }

  cancelRead(): void {
    if (this.#dialog.reading) this.close();
  }

  close(): void {
    this.#target = null;
    this.#returning = false;
    if (this.#dialog.reading || this.#dialog.open || this.#dialog.busy) this.#dialog.close();
  }

  #afterClose(): void {
    if (!this.#returning) return;
    this.#returning = false;
    this.effects.windowClosed();
  }

  render(active: boolean) {
    return active ? this.#dialog.render(this.#choices()) : nothing;
  }
}
