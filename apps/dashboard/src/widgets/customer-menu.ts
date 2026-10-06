import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { MenuDocument, MenuTarget } from "@waitron/catalogue/src/menu-document-types.js";
import type { MenuView } from "@waitron/catalogue/src/customer-menu-presentation.js";
import { indexMenuOccurrences, menuTargetKey } from "@waitron/catalogue/src/menu-navigation.js";
import type { ContentLanguages } from "@waitron/shared";
import { customerMenuStyles, renderCustomerMenu } from "./customer-menu-renderer.js";

type ProductTarget = Extract<MenuTarget, { kind: "product" }>;
function dishKey(target: ProductTarget): string {
  return menuTargetKey({
    ...target,
    variantId: undefined,
    listId: undefined,
    extraProductId: undefined,
    optionLabelId: undefined,
    field: { kind: "summary" },
  });
}

@customElement("dashboard-customer-menu")
export class CustomerMenu extends LitElement {
  static override styles = [baseStyles, customerMenuStyles];
  @property({ attribute: false }) document: MenuDocument | null = null;
  @property({ attribute: false }) inspectionKey: unknown = null;
  @property({ type: Boolean }) showUnavailable = true;
  @property({ attribute: false }) view: MenuView = { kind: "customer", language: "en" };
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @property({ attribute: false }) highlighted: readonly MenuTarget[] = [];
  @property({ attribute: false }) label: (
    key: string,
    values?: Readonly<Record<string, string>>,
  ) => string = (key, values) => values?.amount ?? key;
  @property({ attribute: false }) mediaUrl: (filename: string) => string = (filename) => filename;
  @state() private expanded = new Set<string>();
  @state() private detail: MenuTarget | null = null;
  @state() private selectedVariantId: string | null = null;
  @state() private picks = new Map<string, number>();
  @state() private options = new Map<string, string>();
  @state() private unavailable = false;
  private opener: string | null = null;

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("document") || changed.has("inspectionKey")) {
      this.expanded = new Set();
      this.detail = null;
      this.selectedVariantId = null;
      this.picks = new Map();
      this.options = new Map();
      this.unavailable = false;
      this.opener = null;
    }
  }
  private open(target: ProductTarget) {
    if (this.detail?.kind !== "product" || dishKey(this.detail) !== dishKey(target)) {
      this.picks = new Map();
      this.options = new Map();
      const offer = this.document!.offers[target.menuItemId]!;
      for (const list of offer.offeredModifiers) {
        if (list.kind === "extras")
          for (const item of list.items)
            this.picks.set(JSON.stringify([list.id, item.productId]), item.preselected ? 1 : 0);
        else if (list.defaultLabelId !== null) this.options.set(list.id, list.defaultLabelId);
      }
      this.selectedVariantId = offer.variants[0]?.id ?? null;
    }
    this.detail = target;
    if (target.variantId !== undefined) this.selectedVariantId = target.variantId;
    else if (
      ["price", "image", "unit", "allergens", "diet", "override", "vat"].includes(target.field.kind)
    )
      this.selectedVariantId = null;
  }
  private pick(listId: string, productId: string, requested: number) {
    if (this.detail?.kind !== "product" || !Number.isFinite(requested)) return;
    const list = this.document!.offers[this.detail.menuItemId]!.offeredModifiers.find(
      (m) => m.id === listId,
    );
    if (list?.kind !== "extras") return;
    const item = list.items.find((i) => i.productId === productId);
    if (item === undefined) return;
    const other = list.items.reduce(
      (sum, i) =>
        sum +
        (i.productId === productId
          ? 0
          : (this.picks.get(JSON.stringify([listId, i.productId])) ?? 0)),
      0,
    );
    const itemMax = item.maxQuantity ?? Infinity,
      listMax = list.maxPicks === null ? Infinity : Math.max(0, list.maxPicks - other);
    this.picks = new Map(this.picks).set(
      JSON.stringify([listId, productId]),
      Math.max(0, Math.min(Math.floor(requested), itemMax, listMax)),
    );
  }
  private resolved(target: MenuTarget): boolean {
    if (this.document === null || target.kind === "home") return false;
    if (target.kind === "title") return target.menuId === this.document.menuId;
    const occurrences = indexMenuOccurrences(this.document);
    if (target.kind === "list")
      return (
        target.sectionIds.length === 0 ||
        occurrences.some(
          (o) =>
            o.target.kind === "section" &&
            JSON.stringify(o.target.sectionIds) === JSON.stringify(target.sectionIds),
        )
      );
    const base = { ...target, field: { kind: "summary" as const } };
    if (target.kind === "section")
      return occurrences.some((o) => menuTargetKey(o.target) === menuTargetKey(base));
    if (
      !occurrences.some(
        (o) => o.target.kind === "product" && menuTargetKey(o.target) === dishKey(target),
      )
    )
      return false;
    const offer = this.document.offers[target.menuItemId];
    if (offer === undefined || offer.productId !== target.productId) return false;
    if (target.variantId !== undefined && !offer.variants.some((v) => v.id === target.variantId))
      return false;
    if (target.listId !== undefined) {
      const list = offer.offeredModifiers.find((m) => m.id === target.listId);
      if (list === undefined) return false;
      if (
        target.extraProductId !== undefined &&
        (list.kind !== "extras" || !list.items.some((i) => i.productId === target.extraProductId))
      )
        return false;
      if (
        target.optionLabelId !== undefined &&
        (list.kind !== "options" || !list.labels.some((l) => l.id === target.optionLabelId))
      )
        return false;
    } else if (target.extraProductId !== undefined || target.optionLabelId !== undefined)
      return false;
    return true;
  }
  async reveal(target: MenuTarget, focus = true): Promise<boolean> {
    const snapshot = this.document;
    const inspectionKey = this.inspectionKey;
    await this.updateComplete;
    if (this.document !== snapshot || this.inspectionKey !== inspectionKey) return false;
    if (!this.resolved(target)) {
      this.unavailable = true;
      await this.updateComplete;
      return false;
    }
    this.unavailable = false;
    if (target.kind === "product" || target.kind === "section" || target.kind === "list") {
      this.expanded = new Set(this.expanded);
      for (let n = 1; n <= target.sectionIds.length; n++)
        this.expanded.add(
          menuTargetKey({
            kind: "section",
            sectionIds: target.sectionIds.slice(0, n),
            field: { kind: "summary" },
          }),
        );
      if (target.kind === "product") this.open(target);
      else this.detail = target;
    }
    await this.updateComplete;
    if (this.document !== snapshot || this.inspectionKey !== inspectionKey) return false;
    const nodes = [...this.shadowRoot!.querySelectorAll<HTMLElement>("[data-change-target]")];
    const destination = nodes
      .filter((n) => n.dataset.changeTarget === menuTargetKey(target))
      .at(-1);
    if (destination === undefined) {
      this.unavailable = true;
      await this.updateComplete;
      return false;
    }
    if (focus) {
      destination.focus({ preventScroll: true });
      destination.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
    return true;
  }
  private async closeDetail() {
    this.detail = null;
    await this.updateComplete;
    const opener = [
      ...this.shadowRoot!.querySelectorAll<HTMLButtonElement>("button[data-product-open]"),
    ].find((n) => n.dataset.productOpen === this.opener);
    opener?.focus({ preventScroll: true });
  }
  override render() {
    if (this.document === null) return nothing;
    const snapshot = this.document,
      inspection = this.detail,
      inspectionKey = this.inspectionKey;
    const own =
      <Args extends unknown[]>(action: (...args: Args) => void) =>
      (...args: Args): void => {
        if (
          this.document === snapshot &&
          this.detail === inspection &&
          this.inspectionKey === inspectionKey
        )
          action(...args);
      };
    return html`${this.unavailable && this.showUnavailable ? html`<p role="status">${this.label("unavailable_target")}</p>` : nothing}${renderCustomerMenu(
      {
        document: this.document,
        view: this.view,
        languages: this.languages,
        expanded: this.expanded,
        detail: this.detail,
        selectedVariantId: this.selectedVariantId,
        picks: this.picks,
        options: this.options,
        highlighted: this.highlighted,
        label: this.label,
        mediaUrl: this.mediaUrl,
        onExpand: own((target: MenuTarget) => {
          const key = menuTargetKey(target);
          this.expanded = new Set(this.expanded);
          if (this.expanded.has(key)) this.expanded.delete(key);
          else this.expanded.add(key);
        }),
        onDetail: own((target: MenuTarget | null) => {
          if (target === null) {
            void this.closeDetail();
            return;
          }
          if (target.kind === "product") {
            this.opener = dishKey(target);
            this.open(target);
          }
        }),
        onVariant: own((id: string | null) => {
          this.selectedVariantId = id;
        }),
        onPick: own((list: string, id: string, quantity: number) => this.pick(list, id, quantity)),
        onOption: own((list: string, id: string) => {
          this.options = new Map(this.options).set(list, id);
        }),
      },
    )}`;
  }
}
