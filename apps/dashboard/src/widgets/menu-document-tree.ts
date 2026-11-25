import { installedContentLanguagePresentation } from "@waitron/country-packs";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import type {
  ContentLanguages,
  DocumentMember,
  FrozenOfferVariant,
  MenuDocument,
  MenuClash,
  MenuTarget,
} from "@waitron/shared";
import {
  formatMoney,
  languageDisplayName,
  resolveMenuText,
  tilePrice,
  type MenuView,
} from "@waitron/shared";
import { EACH_UNIT_ID } from "@waitron/menu/src/unit-validation.js";
import { unitPresentation } from "@waitron/menu/src/unit-presentation.js";
import { indexMenuOccurrences } from "@waitron/menu/src/menu-navigation.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { productMedia, productMediaFrame, productMediaStyles } from "./product-media.js";
import { swatchPartStyles } from "./swatch-styles.js";
import { folderFrame, menuTreeCell, menuTreeStyles } from "./menu-tree-presentation.js";

type Row = {
  key: string;
  parentKey: string | null;
  member: DocumentMember | null;
  variant?: FrozenOfferVariant;
};

@customElement("dashboard-menu-document-tree")
export class MenuDocumentTree extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    swatchPartStyles,
    menuTreeStyles,
    productMediaStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        container-type: inline-size;
      }
      wt-data-table::part(table-head) {
        display: none;
      }
      wt-data-table::part(tree-cell) {
        display: flex;
        align-items: center;
      }
      wt-data-table::part(folder-stack) {
        align-self: center;
      }
      wt-data-table::part(preview-row),
      wt-data-table::part(product-cell),
      wt-data-table::part(folder-cell) {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      wt-data-table::part(preview-row) {
        flex: 1;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(name-stack) {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      wt-data-table::part(preview-price) {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      wt-data-table[narrow]::part(preview-row) {
        max-inline-size: calc(
          100cqw - var(--wt-tap-min) - (min(var(--tree-depth, 0), 4) + 2) * var(--wt-space-3)
        );
      }
      wt-data-table[narrow]::part(folder-frame),
      wt-data-table[narrow]::part(product-media) {
        display: inline-flex;
        margin-inline-end: var(--wt-space-2);
      }
      wt-data-table[narrow]::part(thumb-frame),
      wt-data-table[narrow]::part(thumb-placeholder) {
        display: inline-grid;
        inline-size: var(--wt-space-6);
        block-size: var(--wt-space-6);
      }
      wt-data-table[narrow]::part(folder-frame),
      wt-data-table[narrow]::part(product-media) {
        inline-size: var(--wt-space-6);
        block-size: var(--wt-space-6);
      }
      wt-data-table::part(thumb-placeholder) {
        display: inline-grid;
        place-items: center;
      }
      wt-data-table::part(media-placeholder-icon) {
        color: var(--wt-color-text);
      }
      wt-data-table::part(target) {
        background: var(--wt-color-surface-lifted);
        outline: var(--wt-focus-ring);
      }
      wt-data-table::part(note) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(note) {
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ attribute: false }) document: MenuDocument | null = null;
  @property({ attribute: false }) inspectionKey: unknown = null;
  @property({ attribute: false }) view: MenuView = { kind: "internal" };
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "es",
    languages: ["es", "en"],
  };
  @property({ attribute: false }) rootMedia?: { image: string | null; color: string | null };
  @property({ attribute: false }) clashes: readonly MenuClash[] = [];
  #snapshot: MenuDocument | null = null;
  #generation = 0;
  @state() private highlightedKey: string | null = null;
  #clearHighlight = (event: Event) => {
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node.getAttribute("aria-current") === "true" &&
            node.getRootNode() === this.shadowRoot?.querySelector("wt-data-table")?.shadowRoot,
        )
    )
      return;
    this.highlightedKey = null;
  };

  override connectedCallback() {
    super.connectedCallback();
    window.document.addEventListener("click", this.#clearHighlight, true);
  }

  override disconnectedCallback() {
    window.document.removeEventListener("click", this.#clearHighlight, true);
    super.disconnectedCallback();
  }

  async reveal(target: MenuTarget, focus = false): Promise<boolean> {
    const document = this.document;
    const inspectionKey = this.inspectionKey;
    await this.updateComplete;
    if (
      this.document !== document ||
      this.inspectionKey !== inspectionKey ||
      this.#snapshot === null ||
      target.kind === "home" ||
      target.kind === "set_menu"
    )
      return false;
    const occurrences = indexMenuOccurrences(this.#snapshot);
    const pathMatches = (ids: string[]) =>
      target.kind !== "title" &&
      ids.length === target.sectionIds.length &&
      ids.every((id, i) => id === target.sectionIds[i]);
    const exists =
      target.kind === "title"
        ? target.menuId === this.#snapshot.menuId
        : target.kind === "list" && target.sectionIds.length === 0
          ? true
          : occurrences.some(({ target: occurrence }) =>
              occurrence.kind === "product"
                ? target.kind === "product" &&
                  pathMatches(occurrence.sectionIds) &&
                  occurrence.menuItemId === target.menuItemId &&
                  occurrence.productId === target.productId
                : occurrence.kind === "section" &&
                  (target.kind === "section" || target.kind === "list") &&
                  pathMatches(occurrence.sectionIds),
            );
    if (!exists) return false;
    let key = target.kind === "title" ? "root" : target.sectionIds.join("/") || "root";
    if (target.kind === "product") {
      const offer = this.#snapshot.offers[target.menuItemId];
      key = [...target.sectionIds, target.menuItemId].join("/");
      if (offer?.variants.some(({ id }) => id === target.variantId)) key += `/${target.variantId}`;
    }
    this.highlightedKey = key;
    await this.updateComplete;
    if (this.document !== document || this.inspectionKey !== inspectionKey) return false;
    const table = this.shadowRoot!.querySelector("wt-data-table")!;
    await table.revealRow(key);
    if (this.document !== document || this.inspectionKey !== inspectionKey) return false;
    if (focus)
      table
        .shadowRoot!.querySelector<HTMLElement>('[aria-current="true"]')
        ?.focus({ preventScroll: true });
    return true;
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("document") || changed.has("inspectionKey")) {
      this.#snapshot = this.document === null ? null : structuredClone(this.document);
      this.#generation++;
      this.highlightedKey = null;
    }
  }

  #rows(): Row[] {
    const rows: Row[] = [{ key: "root", parentKey: null, member: null }];
    const walk = (members: DocumentMember[], parentKey: string, sections: string[]) => {
      for (const member of members) {
        const id =
          member.kind === "section"
            ? member.sectionId
            : member.kind === "set_menu"
              ? `set-menu:${member.menuId}`
              : member.menuItemId;
        const key = [...sections, id].join("/");
        rows.push({ key, parentKey, member });
        if (member.kind === "section") walk(member.members, key, [...sections, id]);
        if (member.kind === "product")
          for (const variant of this.#snapshot!.offers[member.menuItemId]?.variants ?? [])
            rows.push({ key: `${key}/${variant.id}`, parentKey: key, member, variant });
      }
    };
    walk(this.#snapshot!.root.members, "root", []);
    return rows;
  }

  #nameCell(row: Row) {
    const { member, variant } = row;
    const marked = row.key === this.highlightedKey;
    const targetPart = marked ? " target" : "";
    const current = marked ? "true" : nothing;
    const tab = marked ? -1 : nothing;
    if (member === null) {
      const media = this.rootMedia;
      return html`<span part="folder-cell"
        >${folderFrame(
          productMediaFrame(
            media?.image ?? null,
            media?.color ?? null,
            false,
            false,
            "section-menu",
          ),
        )}<span
          part=${`name-stack folder-stack${targetPart}`}
          aria-current=${current}
          tabindex=${tab}
        >
          <span data-test="root-name" lang="">${this.#snapshot!.menuName}</span>
          ${this.#snapshot!.root.members.length === 0 ? html`<span part="note">${t("menus.structure_empty")}</span>` : nothing}
        </span></span
      >`;
    }
    const offer = this.#offer(row);
    const set = member.kind === "set_menu" ? this.#snapshot!.setMenus?.[member.menuId] : undefined;
    const text = this.#text(row);
    const folder = member.kind === "section";
    const stack = html`<span
      part=${`name-stack${folder ? " folder-stack" : ""}${targetPart}`}
      aria-current=${current}
      tabindex=${tab}
    >
      <span data-test="name" lang=${text.language ?? ""}>${text.text}</span>
      ${text.missingRequested ? html`<span part="note">${t("customer_menu.missing_translation").replace("{language}", languageDisplayName(this.view.kind === "customer" ? this.view.language : this.languages.defaultLanguage, currentLocale(), false, installedContentLanguagePresentation()))}</span>` : nothing}
    </span>`;
    const media = folder
      ? productMediaFrame(
          member.image,
          member.color,
          false,
          false,
          member.includedMenu ? "section-menu" : "folder",
        )
      : productMedia({
          key: row.key,
          name: text.text,
          image: variant?.image ?? offer?.image ?? null,
          color: offer?.color ?? null,
          fallbackIcon: member.kind === "set_menu" ? "section-menu" : "prep-station",
          editable: false,
          busy: false,
        });
    const locale = currentLocale();
    const item = variant ?? offer;
    const unit =
      item?.unit && item.unit.id !== EACH_UNIT_ID
        ? unitPresentation(item.unit, locale, this.languages).abbreviation
        : "";
    const disputed = this.clashes.some(
      ({ productId, variantId }) =>
        productId === offer?.productId && (variant === undefined || variantId === variant.id),
    );
    const price =
      item && !disputed
        ? tilePrice(item.unitPrice, variant ? [] : offer!.variants, unit, locale)
        : set && formatMoney(set.terms.price, locale);
    return html`<span part="preview-row"
      >${menuTreeCell(folder ? "section" : "product", media, stack)}
      ${price ? html`<span part="preview-price" data-test="price">${price}</span>` : nothing}
    </span>`;
  }

  #offer({ member }: Row) {
    return member?.kind === "product" ? this.#snapshot!.offers[member.menuItemId] : undefined;
  }

  #text(row: Row) {
    const { member, variant } = row;
    if (member?.kind === "section")
      return resolveMenuText(member.names, member.internalName, this.view, this.languages);
    if (member?.kind === "set_menu") {
      const set = this.#snapshot!.setMenus?.[member.menuId];
      return resolveMenuText(
        set?.terms.names ?? null,
        set?.name ?? member.name,
        this.view,
        this.languages,
      );
    }
    const item = variant ?? this.#offer(row);
    return resolveMenuText(
      item?.customerName ?? null,
      item?.name ?? t("members.missing"),
      this.view,
      this.languages,
    );
  }

  #canExpand(row: Row): boolean {
    return (
      row.member?.kind === "section" ||
      (row.variant === undefined && !!this.#offer(row)?.variants.length)
    );
  }

  #columns(): DataTableColumn<Row>[] {
    return [{ key: "name", label: t("members.name"), cell: (row) => this.#nameCell(row) }];
  }

  override render(): unknown {
    if (this.#snapshot === null) return nothing;
    return keyed(
      this.#generation,
      html`<wt-data-table
        aria-label=${t("menus.tree_heading")}
        expandAllLabel=${t("folders.expand_all")}
        collapseAllLabel=${t("folders.collapse_all")}
        initiallyCollapsed
        wrap-to-fit
        .rows=${this.#rows()}
        .columns=${this.#columns()}
        .rowKey=${(row: Row) => row.key}
        .rowParent=${(row: Row) => row.parentKey}
        .rowCollapsible=${(row: Row) => this.#canExpand(row)}
        .rowActivation=${(row: Row) => (this.#canExpand(row) ? "toggle" : "none")}
        .rowToggleLabel=${(row: Row, expanded: boolean) => fill(expanded ? "menus.collapse" : "menus.expand", { name: row.member === null ? this.#snapshot!.menuName : this.#text(row).text })}
        ><div slot="toolbar-start"><slot name="view"></slot></div
      ></wt-data-table>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-document-tree": MenuDocumentTree;
  }
}
