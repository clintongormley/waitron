import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { HomeLayout, HomeTile, MemberRef, SectionMember } from "../api/client.js";
import "./member-list-editor.js";
import { reorder } from "./reorder.js";
import { t } from "../i18n/t.js";

/**
 * A menu's home page layouts: the list of them, the tiles of the one being edited, and a preview of
 * those tiles at a handheld's and a till's width. The host owns the layouts and every write; each
 * action leaves as an event naming the layout it is for.
 */
@customElement("dashboard-home-layout-editor")
export class HomeLayoutEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-6);
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-tap-min) * 7)), 1fr)
        );
        align-items: start;
      }
      section,
      .tiles {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .preview {
        grid-column: 1 / -1;
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .help {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .layouts {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .layouts li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .layouts li[aria-current] {
        border-color: var(--wt-color-primary);
        border-inline-start-width: var(--wt-space-1);
      }
      .layout-name {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-inline-end: auto;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .layouts li[aria-current] .layout-name > span:first-child {
        font-weight: var(--wt-font-weight-bold);
      }
      .mark {
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        font-size: var(--wt-font-size-sm);
      }
      .editing {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .layout-actions {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
      }
      figure {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        min-width: 0;
      }
      figcaption {
        font-weight: var(--wt-font-weight-bold);
      }
      .grid {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding: var(--wt-space-3);
        list-style: none;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-bg);
      }
      .handheld {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        max-width: calc(var(--wt-tap-min) * 9);
      }
      /* Six tiles squeezed into a phone's width break every word, so the till's preview keeps
         a till-like width and scrolls sideways instead. */
      .till {
        grid-template-columns: repeat(6, minmax(0, 1fr));
        min-width: calc(var(--wt-tap-min) * 13);
        max-width: calc(var(--wt-tap-min) * 18);
      }
      .scroller {
        overflow-x: auto;
      }
      .tile {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--wt-space-1);
        min-width: 0;
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        overflow-wrap: anywhere;
        font-size: var(--wt-font-size-sm);
      }
      /* A section opens more choices, so it is drawn as a rounded stack of cards. */
      .tile.section {
        border-radius: var(--wt-radius-lg);
        box-shadow: var(--wt-space-1) var(--wt-space-1) 0 0 var(--wt-color-border);
        margin-inline-end: var(--wt-space-1);
        margin-block-end: var(--wt-space-1);
      }
      .tile.off-menu {
        border-style: dashed;
      }
      .tile-name {
        font-weight: var(--wt-font-weight-bold);
      }
      .tile-kind,
      .tile-note {
        color: var(--wt-color-text-muted);
      }
      .tile-note {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) layouts: HomeLayout[] = [];
  /** The layout being edited; the first layout, which is the default, when it names none of them. */
  @property() selected = "";
  /** The products and library sections the menu's structure reaches: the only tiles on offer. */
  @property({ attribute: false }) products: { id: string; name: string }[] = [];
  @property({ attribute: false }) sections: { id: string; internalName: string }[] = [];
  @property({ type: Boolean }) busy = false;
  @property() menuName = "";

  /** The edited layout's tiles in display order, which a keyboard move rewrites before the host
   * confirms it, so the preview follows the list. */
  @state() private order: HomeTile[] = [];
  #current: HomeLayout | null = null;
  #members: SectionMember[] = [];
  #products: { id: string; name: string }[] = [];
  #sections: { id: string; internalName: string }[] = [];
  #notes: ReadonlyMap<string, string> = new Map();

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("layouts") || changed.has("selected")) {
      this.#current =
        this.layouts.find(({ id }) => id === this.selected) ?? this.layouts[0] ?? null;
      this.order = [...(this.#current?.tiles ?? [])].sort((a, b) => a.position - b.position);
      this.#members = this.order.map(({ memberId, position, ref }) => ({
        id: memberId,
        position,
        ref,
      }));
      this.#notes = new Map(
        this.order
          .filter((tile) => !tile.reachable)
          .map((tile) => [tile.memberId, t("home.not_on_menu")]),
      );
    }
    if (
      changed.has("layouts") ||
      changed.has("selected") ||
      changed.has("products") ||
      changed.has("sections")
    ) {
      // A held tile is named by the layout itself, so a target the menu no longer reaches keeps its
      // name; the member-list editor never offers what the list already holds.
      const tiles = this.#current?.tiles ?? [];
      const heldProducts = tiles.flatMap(({ ref, name }) =>
        ref.kind === "product" ? [{ id: ref.productId, name }] : [],
      );
      const heldSections = tiles.flatMap(({ ref, name }) =>
        ref.kind === "section" ? [{ id: ref.sectionId, internalName: name }] : [],
      );
      this.#products = [
        ...this.products.filter(({ id }) => !heldProducts.some((held) => held.id === id)),
        ...heldProducts,
      ];
      this.#sections = [
        ...this.sections.filter(({ id }) => !heldSections.some((held) => held.id === id)),
        ...heldSections,
      ];
    }
  }

  #emit(type: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #action(test: string, label: string, type: string, layoutId: string, variant = "ghost") {
    return html`<wt-button
      align="start"
      variant=${variant}
      data-test=${test}
      .disabled=${this.busy}
      @click=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) this.#emit(type, { layoutId });
      }}
      >${label}</wt-button
    >`;
  }

  #layoutRow(layout: HomeLayout) {
    const current = layout.id === this.#current?.id;
    const id = layout.id;
    return html`<li data-test=${`layout-${id}`} aria-current=${current ? "true" : nothing}>
      <span class="layout-name">
        <span>${layout.name}</span>
        ${
          layout.isDefault
            ? html`<span class="mark" data-test="default-mark">${t("home.default")}</span>`
            : nothing
        }
        ${
          current
            ? html`<span class="editing" data-test="editing-mark">${t("home.editing")}</span>`
            : nothing
        }
      </span>
      <span class="layout-actions">
        ${
          current
            ? nothing
            : this.#action(`edit-${id}`, t("home.edit"), "wt-layout-select", id, "secondary")
        }
        <wt-row-actions align="end" label=${`${t("home.actions")}: ${layout.name}`}
          >${this.#action(`rename-${id}`, t("home.rename"), "wt-layout-rename", id)}${this.#action(
            `duplicate-${id}`,
            t("home.duplicate"),
            "wt-layout-duplicate",
            id,
          )}${
            layout.isDefault
              ? nothing
              : html`${this.#action(
                  `make-default-${id}`,
                  t("home.make_default"),
                  "wt-layout-default",
                  id,
                )}${this.#action(`delete-${id}`, t("action.delete"), "wt-layout-delete", id)}`
          }</wt-row-actions
        >
      </span>
    </li>`;
  }

  #tile(tile: HomeTile) {
    const kind = tile.ref.kind;
    return html`<li
      class=${`tile ${kind}${tile.reachable ? "" : " off-menu"}`}
      data-tile=${tile.memberId}
    >
      <span class="tile-name" data-test="tile-name">${tile.name}</span>
      <span class="tile-kind" data-test="tile-kind"
        >${t(kind === "product" ? "home.tile_product" : "home.tile_section")}</span
      >
      ${
        tile.reachable
          ? nothing
          : html`<span class="tile-note" data-test="tile-note">${t("home.not_on_menu")}</span>`
      }
    </li>`;
  }

  #grid(which: "handheld" | "till") {
    return html`<figure>
      <figcaption id=${`preview-${which}-caption`} data-test=${`preview-${which}-caption`}>
        ${t(which === "handheld" ? "home.preview_handheld" : "home.preview_till")}
      </figcaption>
      <div
        class="scroller"
        tabindex="0"
        role="region"
        aria-labelledby=${`preview-${which}-caption`}
      >
        <ol class=${`grid ${which}`} data-test=${`preview-${which}`}>
          ${repeat(
            this.order,
            (tile) => tile.memberId,
            (tile) => this.#tile(tile),
          )}
        </ol>
      </div>
    </figure>`;
  }

  #relay(event: Event, type: string, detail: Record<string, unknown>): void {
    event.stopPropagation();
    this.#emit(type, { layoutId: this.#current!.id, ...detail });
  }

  #moved(memberId: string, to: number): void {
    const from = this.order.findIndex((tile) => tile.memberId === memberId);
    this.order = reorder(this.order, from, to);
  }

  #tiles(current: HomeLayout) {
    const heading = t("home.tiles_heading").replace("{name}", current.name);
    // Not a region of its own: the tile table inside is one, under the same name.
    return html`<div class="tiles">
      <h2 id="tiles-heading" data-test="tiles-heading">${heading}</h2>
      <p class="help">${t("home.tiles_help")}</p>
      <dashboard-member-list-editor
        .members=${this.#members}
        .products=${this.#products}
        .sections=${this.#sections}
        .notes=${this.#notes}
        .openable=${false}
        .busy=${this.busy}
        label=${heading}
        listName=${current.name}
        @wt-member-add=${(event: CustomEvent<{ ref: MemberRef }>) =>
          this.#relay(event, "wt-tile-add", { ref: event.detail.ref })}
        @wt-member-remove=${(event: CustomEvent<{ memberId: string }>) =>
          this.#relay(event, "wt-tile-remove", { memberId: event.detail.memberId })}
        @wt-member-move=${(event: CustomEvent<{ memberId: string; to: number }>) => {
          this.#moved(event.detail.memberId, event.detail.to);
          this.#relay(event, "wt-tile-move", event.detail);
        }}
      ></dashboard-member-list-editor>
    </div>`;
  }

  override render() {
    const current = this.#current;
    return html`<section aria-labelledby="layouts-heading">
        <h2 id="layouts-heading">${t("home.layouts_heading")}</h2>
        <p class="help">${t("home.layouts_help")}</p>
        <ul
          class="layouts"
          data-test="layouts"
          aria-label=${t("home.layouts_label").replace("{menu}", this.menuName)}
        >
          ${repeat(
            this.layouts,
            (layout) => layout.id,
            (layout) => this.#layoutRow(layout),
          )}
        </ul>
        <p class="help" data-test="default-note">${t("home.default_note")}</p>
        <div>
          <wt-button
            variant="secondary"
            data-test="add-layout"
            .disabled=${this.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              if (!this.busy) this.#emit("wt-layout-add", {});
            }}
            >${t("home.add")}</wt-button
          >
        </div>
      </section>
      ${current === null ? nothing : this.#tiles(current)}
      ${
        current === null
          ? nothing
          : html`<section class="preview" aria-labelledby="preview-heading">
              <h2 id="preview-heading">${t("home.preview_heading")}</h2>
              ${
                this.order.length === 0
                  ? html`<p class="help" data-test="preview-empty">${t("home.preview_empty")}</p>`
                  : html`${this.#grid("handheld")} ${this.#grid("till")}`
              }
            </section>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-home-layout-editor": HomeLayoutEditor;
  }
}
