import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import type { ContentLanguages } from "@waitron/shared";
import {
  resolveMenuText,
  type MenuView,
} from "@waitron/catalogue/src/customer-menu-presentation.js";
import type { DocumentMember, MenuDocument } from "@waitron/catalogue/src/menu-document-types.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { productMedia, productMediaFrame, productMediaStyles } from "./product-media.js";
import { swatchPartStyles } from "./swatch-styles.js";
import { folderFrame, menuTreeCell, menuTreeStyles } from "./menu-tree-presentation.js";

type Row = { key: string; parentKey: string | null; member: DocumentMember | null };

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
      wt-data-table[narrow]::part(name-stack) {
        min-width: 0;
        max-inline-size: max(
          var(--wt-tap-min),
          calc(100cqw - var(--wt-tap-min) * 6 - var(--wt-space-3) * 2)
        );
        overflow-wrap: anywhere;
      }
      wt-data-table::part(kind),
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
  #snapshot: MenuDocument | null = null;
  #generation = 0;

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("document") || changed.has("inspectionKey")) {
      this.#snapshot = this.document === null ? null : structuredClone(this.document);
      this.#generation++;
    }
  }

  #rows(): Row[] {
    const rows: Row[] = [{ key: "root", parentKey: null, member: null }];
    const walk = (members: DocumentMember[], parentKey: string, sections: string[]) => {
      for (const member of members) {
        const id = member.kind === "section" ? member.sectionId : member.menuItemId;
        const key = [...sections, id].join("/");
        rows.push({ key, parentKey, member });
        if (member.kind === "section") walk(member.members, key, [...sections, id]);
      }
    };
    walk(this.#snapshot!.root.members, "root", []);
    return rows;
  }

  #nameCell(row: Row) {
    const member = row.member;
    if (member === null)
      return html`<span part="folder-cell"
        >${folderFrame()}<span part="name-stack folder-stack"
          ><span data-test="root-name">${this.#snapshot!.menuName}</span
          >${this.#snapshot!.root.members.length === 0 ? html`<span part="note">${t("menus.structure_empty")}</span>` : nothing}</span
        ></span
      >`;
    const offer = member.kind === "product" ? this.#snapshot!.offers[member.menuItemId] : undefined;
    const text = this.#text(member);
    const stack = html`<span
      part=${member.kind === "section" ? "name-stack folder-stack" : "name-stack"}
    >
      <span data-test="name">${text.text}</span>
      ${text.missingRequested ? html`<span part="note">${t("customer_menu.missing_translation").replace("{language}", this.view.kind === "customer" ? this.view.language : this.languages.defaultLanguage)}</span>` : nothing}
      ${text.missingRequested && text.origin === "staff" ? html`<span part="note">${t("customer_menu.staff_fallback")}</span>` : nothing}
    </span>`;
    const media =
      member.kind === "section"
        ? productMediaFrame(member.image, member.color)
        : productMedia({
            key: row.key,
            name: text.text,
            image: offer?.image ?? null,
            color: offer?.color ?? null,
            editable: false,
            busy: false,
          });
    return menuTreeCell(member.kind, media, stack);
  }

  #text(member: DocumentMember) {
    const offer = member.kind === "product" ? this.#snapshot!.offers[member.menuItemId] : undefined;
    const staff =
      member.kind === "section" ? member.internalName : (offer?.name ?? t("members.missing"));
    const names = member.kind === "section" ? member.names : (offer?.customerName ?? null);
    return resolveMenuText(names, staff, this.view, this.languages);
  }

  #columns(): DataTableColumn<Row>[] {
    return [
      { key: "name", label: t("members.name"), cell: (row) => this.#nameCell(row) },
      {
        key: "kind",
        label: t("members.kind"),
        cell: (row) =>
          row.member === null
            ? nothing
            : html`<span part="kind"
                >${t(row.member.kind === "section" ? "members.kind_section" : "members.kind_product")}</span
              >`,
      },
      // Availability is a live overlay, absent from the frozen document.
      {
        key: "available",
        label: t("editor.available"),
        cell: (row) =>
          row.member?.kind === "product"
            ? html`<span part="kind" data-test="available">—</span>`
            : nothing,
      },
    ];
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
        .rows=${this.#rows()}
        .columns=${this.#columns()}
        .rowKey=${(row: Row) => row.key}
        .rowParent=${(row: Row) => row.parentKey}
        .rowCollapsible=${(row: Row) => row.member !== null}
        .rowActivation=${(row: Row) => (row.member?.kind === "section" ? "toggle" : "none")}
        .rowToggleLabel=${(row: Row, expanded: boolean) => t(expanded ? "menus.collapse" : "menus.expand").replace("{name}", row.member === null ? this.#snapshot!.menuName : this.#text(row.member).text)}
      ></wt-data-table>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-document-tree": MenuDocumentTree;
  }
}
