import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ContentLanguageController,
  baseStyles,
  readableTextColor,
  visuallyHiddenStyles,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import { formatMoney } from "@waitron/shared";
import {
  HOME_GRID_COLUMNS,
  arrangeHome,
  foldForSearch,
  indexDocument,
  shownMembers,
  tileFill,
  type HomeIndex,
} from "@waitron/catalogue/src/device-home.js";
import type { DocumentTile, HomeTileMode } from "@waitron/catalogue/src/menu-document-types.js";
import type {
  DocumentMember,
  FrozenOffer,
  HomeDevice,
  HomeDisplay,
  MenuDocument,
} from "../api/client.js";
import { localizedName } from "../i18n/localized.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

type SectionNode = Extract<DocumentMember, { kind: "section" }>;

type PreviewIndex = HomeIndex<FrozenOffer>;

function thumb(image: string): TemplateResult {
  return html`<img class="thumb" src=${`/media/${encodeURIComponent(image)}`} alt="" />`;
}

const paints = new Map<string, string>();

/** Custom properties for a tile painted in a colour `tileFill` has checked, with black or white ink
 * for contrast. Worked out once per colour, not on every render of every tile. */
function tilePaint(color: string): string {
  let paint = paints.get(color);
  if (paint === undefined)
    paints.set(color, (paint = `--tile-fill:${color};--tile-ink:${readableTextColor(color)}`));
  return paint;
}

/**
 * A menu's Device Home Page as a handheld or a till draws it, from a published-menu document:
 * search, then the shortcuts and the menu's own structure in the order the device's display sets,
 * with the same columns and tile fill. Sections open behind a breadcrumb; products do nothing, and
 * it sends no events. Search finds this document's products only, where a device may also find
 * other menus' products.
 */
@customElement("dashboard-device-home-preview")
export class DeviceHomePreview extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .frame {
        display: grid;
        gap: var(--wt-space-4);
        align-content: start;
        width: 100%;
        /* The till's inset beside its menu: the page's 24px padding (apps/till/index.html) and its
           order screen's own (till-table-order-screen.ts's .screen), so the grid gets the width a
           device's gives it. */
        padding: var(--wt-space-3) calc(var(--wt-space-5) + var(--wt-space-4));
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-bg);
      }

      .frame[data-device="handheld"] {
        max-width: calc(var(--wt-tap-min) * 9);
      }

      .frame[data-device="till"] {
        max-width: calc(var(--wt-tap-min) * 29);
      }

      section,
      [data-region="search"] {
        display: grid;
        gap: var(--wt-space-2);
        min-width: 0;
      }

      p {
        margin: 0;
      }

      .note,
      .empty,
      .price,
      .kind {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      [data-region="results"] h2 {
        ${visuallyHiddenStyles}
      }

      .divider {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }

      .divider::before,
      .divider::after {
        content: "";
        flex: 1;
        border-block-start: 1px solid var(--wt-color-border);
      }

      .grid {
        display: grid;
        gap: var(--wt-space-3);
        grid-template-columns: ${unsafeCSS(HOME_GRID_COLUMNS)};
      }

      .thumb {
        display: block;
        width: 100%;
        aspect-ratio: 4 / 3;
        object-fit: cover;
        border-radius: var(--wt-radius-sm);
      }

      .tile,
      .slot {
        width: 100%;
        min-height: calc(var(--wt-tap-min) * 1.5);
      }

      /* A product tile is not a control here, so it is drawn to look like the device's button. */
      div.tile {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      wt-button.tile::part(button) {
        height: 100%;
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-2);
      }

      .label {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 0;
        text-align: center;
        overflow-wrap: anywhere;
      }

      .label > * {
        max-width: 100%;
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
      }

      div.tile[data-painted],
      wt-button.tile[data-painted]::part(button) {
        background: var(--tile-fill);
        border-color: var(--tile-fill);
        color: var(--tile-ink);
      }

      wt-button.tile[data-painted]::part(button):hover:not(:disabled) {
        border-color: var(--tile-ink);
      }

      .tile[data-painted] .price,
      .tile[data-painted] .kind,
      .tile[data-painted] wt-icon {
        color: inherit;
      }

      .breadcrumb ol {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .breadcrumb li {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        overflow-wrap: anywhere;
      }

      .breadcrumb [aria-current] {
        font-weight: var(--wt-font-weight-bold);
        padding-inline: var(--wt-space-2);
      }

      .sep {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  /** The draft as a publish would make it live; nothing renders while it is null. */
  @property({ attribute: false }) document: MenuDocument | null = null;

  /** Which device's display it draws. */
  @property() device: HomeDevice = "handheld";

  /** The open section's path of section ids: its first among the members home shows, else
   * anywhere in the menu; each next among the previous one's members. Empty is home. */
  @state() private path: string[] = [];

  @state() private query = "";

  #indexed?: { document: MenuDocument; index: PreviewIndex; names: [FrozenOffer, string][] };

  #trailShown: SectionNode[] = [];

  /** Products not sold separately are left out, as the till leaves them out: they are ordered
   * only as an extra on another dish. */
  #index(document: MenuDocument): { index: PreviewIndex; names: [FrozenOffer, string][] } {
    if (this.#indexed?.document === document) return this.#indexed;
    const index = indexDocument(document.root.members, (id) => {
      const offer = document.offers[id];
      return offer?.ordering === "not_sold_separately" ? undefined : offer;
    });
    const names = [...index.products.values()].map((offer): [FrozenOffer, string] => [
      offer,
      foldForSearch(offer.name),
    ]);
    this.#indexed = { document, index, names };
    return this.#indexed;
  }

  /** One included menu can appear in two lists, each copy with its own name, so each step looks
   * first among the members its list draws. */
  #trail(
    path: string[],
    index: PreviewIndex,
    home: readonly DocumentMember[],
  ): SectionNode[] | null {
    const trail: SectionNode[] = [];
    for (const id of path) {
      const previous = trail.at(-1);
      const among = (members: readonly DocumentMember[]) =>
        members.find(
          (member): member is SectionNode =>
            member.kind === "section" && member.sectionId === id && index.sections.has(id),
        );
      const next =
        previous === undefined
          ? (among(shownMembers(home)) ?? index.sections.get(id))
          : (among(shownMembers(previous.members)) ?? among(previous.members));
      if (next === undefined) return null;
      trail.push(next);
    }
    return trail;
  }

  /** A new document that no longer holds the open section shows home instead. */
  override willUpdate(): void {
    if (this.document === null) return;
    const trail = this.#trail(
      this.path,
      this.#index(this.document).index,
      this.document.root.members,
    );
    if (trail === null) this.path = [];
    this.#trailShown = trail ?? [];
  }

  #sectionName(section: SectionNode): string {
    return localizedName(section.names) || section.internalName;
  }

  #grid(content: unknown, display: HomeDisplay): TemplateResult {
    return html`<div class="grid" style=${`--columns: ${display.columns};`}>${content}</div>`;
  }

  #productTile(offer: FrozenOffer, mode: HomeTileMode): TemplateResult {
    const unit = localizedName(offer.unit.abbreviation) || offer.unit.id;
    const price = `${formatMoney(offer.unitPrice, currentLocale())}/${unit}`;
    const fill = tileFill(mode, offer.image, offer.color);
    const paint = fill.kind === "color" ? tilePaint(fill.color) : undefined;
    return html`<div
      class="tile"
      data-kind="product"
      style=${paint ?? nothing}
      ?data-painted=${paint !== undefined}
    >
      <span class="label">
        ${fill.kind === "image" ? thumb(fill.image) : nothing}
        <span class="name">${offer.name}</span>
        <span class="price">${price}</span>
      </span>
    </div>`;
  }

  #sectionTile(section: SectionNode, mode: HomeTileMode, path: string[]): TemplateResult {
    const fill = tileFill(mode, section.image, section.color);
    const paint = fill.kind === "color" ? tilePaint(fill.color) : undefined;
    return html`<wt-button
      class="tile"
      data-kind="section"
      style=${paint ?? nothing}
      ?data-painted=${paint !== undefined}
      @click=${() => {
        this.path = [...path, section.sectionId];
      }}
    >
      <span class="label">
        ${fill.kind === "image" ? thumb(fill.image) : html`<wt-icon name="folder"></wt-icon>`}
        <span class="name">${this.#sectionName(section)}</span>
        <span class="kind">${t("home.tile_section")}</span>
      </span>
    </wt-button>`;
  }

  /** The tile for a section or product the index holds, else nothing; `path` is where a section
   * opens beneath. A structural member is drawn from itself, a shortcut from the index. */
  #tile(
    ref: DocumentTile | DocumentMember,
    path: string[],
    index: PreviewIndex,
    mode: HomeTileMode,
  ): TemplateResult | typeof nothing {
    if (ref.kind === "empty") return nothing;
    if (ref.kind === "section") {
      const section = index.sections.get(ref.sectionId);
      if (section === undefined) return nothing;
      return this.#sectionTile("members" in ref ? ref : section, mode, path);
    }
    const offer = index.products.get(ref.productId);
    return offer === undefined ? nothing : this.#productTile(offer, mode);
  }

  #home(document: MenuDocument, index: PreviewIndex, display: HomeDisplay): TemplateResult {
    const shortcuts = document.home.shortcuts.map((tile) =>
      this.#tile(tile, [], index, display.tiles),
    );
    const members = shownMembers(document.root.members).map((member) =>
      this.#tile(member, [], index, display.tiles),
    );
    const { blocks, divider } = arrangeHome(
      display.order,
      shortcuts.some((cell) => cell !== nothing),
      members.some((cell) => cell !== nothing),
    );
    return html`${blocks.map((block, place) => {
      const shortcutBlock = block === "shortcuts";
      const label = t(shortcutBlock ? "home.block_shortcuts" : "home.block_menu");
      const cells = shortcutBlock
        ? shortcuts.map((cell) =>
            cell === nothing ? html`<span class="slot" aria-hidden="true"></span>` : cell,
          )
        : members;
      const region = shortcutBlock ? "shortcuts" : "structure";
      return place === 1 && divider
        ? html`<section data-region=${region} aria-labelledby=${`${region}-divider`}>
            <h2 class="divider" id=${`${region}-divider`}><span>${label}</span></h2>
            ${this.#grid(cells, display)}
          </section>`
        : html`<section data-region=${region} aria-label=${label}>
            ${this.#grid(cells, display)}
          </section>`;
    })}`;
  }

  #sectionView(trail: SectionNode[], index: PreviewIndex, display: HomeDisplay): TemplateResult {
    const current = trail.at(-1)!;
    return html`<section data-region="section">
      <nav class="breadcrumb" aria-label=${t("home.breadcrumb")}>
        <ol>
          <li>
            <wt-button
              variant="ghost"
              @click=${() => {
                this.path = [];
              }}
              >${t("home.breadcrumb_home")}</wt-button
            >
            <span class="sep" aria-hidden="true">›</span>
          </li>
          ${trail.slice(0, -1).map(
            (section, position) =>
              html`<li>
                <wt-button
                  variant="ghost"
                  @click=${() => {
                    this.path = this.path.slice(0, position + 1);
                  }}
                  >${this.#sectionName(section)}</wt-button
                >
                <span class="sep" aria-hidden="true">›</span>
              </li>`,
          )}
          <li><span aria-current="location">${this.#sectionName(current)}</span></li>
        </ol>
      </nav>
      ${this.#grid(
        shownMembers(current.members).map((member) =>
          this.#tile(member, this.path, index, display.tiles),
        ),
        display,
      )}
    </section>`;
  }

  #results(names: [FrozenOffer, string][], display: HomeDisplay): TemplateResult {
    const wanted = foldForSearch(this.query.trim());
    const found = names.filter(([, name]) => name.includes(wanted)).map(([offer]) => offer);
    return html`<section data-region="results" aria-labelledby="results-heading">
      <h2 id="results-heading">${t("home.results")}</h2>
      ${
        found.length === 0
          ? html`<p class="empty">${t("home.no_results")}</p>`
          : this.#grid(
              found.map((offer) => this.#productTile(offer, display.tiles)),
              display,
            )
      }
    </section>`;
  }

  override render() {
    const document = this.document;
    if (document === null) return nothing;
    const { index, names } = this.#index(document);
    const display = document.home[this.device];
    const trail = this.#trailShown;
    let view: TemplateResult;
    if (this.query.trim() !== "") view = this.#results(names, display);
    else if (trail.length > 0) view = this.#sectionView(trail, index, display);
    else view = this.#home(document, index, display);
    return html`<div class="frame" data-device=${this.device}>
      <div data-region="search">
        <p class="note" data-test="search-note">${t("home.search_note")}</p>
        <wt-input
          type="search"
          name="home-preview-search"
          label=${t("home.search")}
          .value=${this.query}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.query = event.detail.value;
          }}
        ></wt-input>
      </div>
      ${view}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-device-home-preview": DeviceHomePreview;
  }
}
