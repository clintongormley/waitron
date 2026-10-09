import {
  LitElement,
  css,
  html,
  nothing,
  unsafeCSS,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  ContentLanguageController,
  baseStyles,
  readableTextColor,
  reorder,
  visuallyHiddenStyles,
} from "@waitron/ui";
import { DragEdgeScroll } from "@waitron/ui/src/drag-edge-scroll.js";
import {
  holdPageCursor,
  pointerElementsAt,
  releasePageCursor,
} from "@waitron/ui/src/reorder-table.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { formatMoney } from "@waitron/shared";
import {
  HOME_GRID_COLUMNS,
  arrangeHome,
  foldForSearch,
  indexDocument,
  openedSection,
  searchFor,
  sectionTrail,
  shownMembers,
  tileFill,
  tilePaths,
  type HomeIndex,
  type SectionStep,
} from "@waitron/catalogue/src/device-home.js";
import type { DocumentTile, HomeTileMode } from "@waitron/catalogue/src/menu-document-types.js";
import type {
  DocumentMember,
  FrozenOffer,
  HomeDevice,
  HomeDisplay,
  HomeTile,
  MenuDocument,
} from "../api/client.js";
import { localizedName } from "../i18n/localized.js";
import { DRAG_THRESHOLD_PX, capturePointer, releasePointer } from "./pointer-drag.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

type SectionNode = Extract<DocumentMember, { kind: "section" }>;

type PreviewIndex = HomeIndex<FrozenOffer>;

type ShortcutKind = "product" | "section";

const ADD_TILES: { kind: ShortcutKind; label: () => string }[] = [
  { kind: "product", label: () => t("home.add_products_tile") },
  { kind: "section", label: () => t("home.add_sections_tile") },
];

const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

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
 * with the same columns and tile fill. Sections open behind a breadcrumb; products do nothing.
 * Search finds this document's products only, where a device may also find other menus' products.
 *
 * Given `shortcuts`, the home view's shortcut block is drawn from that list instead, each tile with
 * a grip and a menu to remove it, followed by two tiles to add more; it then sends
 * `wt-shortcut-move`, `wt-shortcut-remove` and `wt-shortcut-add` and saves nothing itself; a move
 * shows at once until the host hands it a new list.
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
        padding: var(--wt-space-3) calc(var(--wt-space-5) + var(--wt-space-4));
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-bg);
      }

      .frame[data-device="handheld"] {
        max-width: calc(var(--wt-tap-min) * 9);
        padding-inline: var(--wt-space-4);
        --home-tile-min: calc(var(--wt-tap-min) * 1.5);
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

      .grid[data-editing] {
        row-gap: var(--wt-space-5);
      }

      .shortcut {
        display: grid;
        grid-template-rows: 1fr auto;
        min-width: 0;
      }

      .controls {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--wt-space-1);
        height: var(--wt-tap-min);
      }

      .grip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        touch-action: none;
        user-select: none;
        cursor: var(--reorder-drag-cursor, grab);
      }

      .shortcut[data-dragging] {
        opacity: var(--wt-opacity-disabled);
      }

      .shortcut[data-drop="before"] {
        box-shadow: calc(-1 * var(--wt-space-1)) 0 0 0 var(--wt-color-primary);
      }

      .shortcut[data-drop="after"] {
        box-shadow: var(--wt-space-1) 0 0 0 var(--wt-color-primary);
      }

      .grip:disabled {
        cursor: default;
        opacity: var(--wt-opacity-disabled);
      }

      div.tile[data-state] {
        border-style: dashed;
        background: var(--wt-color-bg);
        color: var(--wt-color-text-muted);
      }

      /* The margin stands in for a shortcut's grip strip, so an add tile is as tall as the
         shortcut tiles beside it rather than the tile and its strip together. */
      wt-button.add {
        width: 100%;
        min-height: calc(var(--wt-tap-min) * 1.5);
        margin-block-end: var(--wt-tap-min);
      }

      wt-button.add::part(button) {
        height: 100%;
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-2);
        border-style: dashed;
        border-color: var(--wt-color-primary);
        background: transparent;
        color: var(--wt-color-primary-text);
      }

      wt-button.add::part(button):hover:not(:disabled) {
        border-style: solid;
      }

      wt-button.add wt-icon {
        color: var(--wt-color-primary);
      }

      .status {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  /** The draft as a publish would make it live; nothing renders while it is null. */
  @property({ attribute: false }) document: MenuDocument | null = null;

  /** Which device's display it draws. */
  @property() device: HomeDevice = "handheld";

  /** The working shortcuts, in order, to edit on the home view; null draws the document's own,
   * read-only. */
  @property({ attribute: false }) shortcuts: HomeTile[] | null = null;

  /** While set, nothing can be moved, removed or added. */
  @property({ type: Boolean }) busy = false;

  @state() private announcement = "";

  /** The shortcuts' member ids after moves the host has not answered with a new list yet. */
  #order: string[] | null = null;

  #refocus: string | null = null;

  /** A pressed grip; `dragging` once the pointer has travelled far enough to be a drag. */
  #press: {
    memberId: string;
    name: string;
    grip: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null = null;

  readonly #edgeScroll = new DragEdgeScroll();

  /** Where the pointer was last seen during a drag. */
  #pointer = { x: 0, y: 0 };

  /** The shortcut the dragged one would take the place of, if released now. */
  @state() private dropOn: string | null = null;

  /** The open section's path, as {@link sectionTrail} reads it. Empty is home. */
  @state() private path: SectionStep[] = [];

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

  /** A new document that no longer holds the open section shows home instead. */
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("shortcuts")) this.#order = null;
    if (this.document === null) return;
    const trail = sectionTrail(this.path, this.#index(this.document).index);
    if (trail === null) this.path = [];
    this.#trailShown = trail ?? [];
  }

  /** `repeat` moves a tile by moving its node, and a focused node that is moved loses focus. */
  protected override updated(): void {
    const memberId = this.#refocus;
    this.#refocus = null;
    if (memberId === null) return;
    const grip = this.#control<HTMLButtonElement>("grip", memberId);
    if (grip && this.shadowRoot!.activeElement !== grip) grip.focus();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#endPress();
  }

  #control<T extends HTMLElement>(part: string, id: string): T | null {
    return this.shadowRoot?.querySelector<T>(`[data-test="${part}-${CSS.escape(id)}"]`) ?? null;
  }

  /** Focuses the shortcut's ⋮ once drawn; false when it is not drawn. */
  async focusShortcut(memberId: string): Promise<boolean> {
    await this.updateComplete;
    const menu = this.#control("actions", memberId);
    menu?.focus();
    return menu !== null;
  }

  /** Focuses the tile that adds shortcuts of `kind` once drawn; false when it is not drawn. */
  async focusAdd(kind: ShortcutKind): Promise<boolean> {
    await this.updateComplete;
    const tile = this.#control("add", kind);
    tile?.focus();
    return tile !== null;
  }

  #send(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #editable(list: HomeTile[]): HomeTile[] {
    const order = this.#order;
    if (order === null) return list;
    return order.flatMap((memberId) => list.filter((tile) => tile.memberId === memberId));
  }

  #shortcutIds(): string[] {
    return this.#editable(this.shortcuts ?? []).map((tile) => tile.memberId);
  }

  #move(memberId: string, name: string, to: number): void {
    const ids = this.#shortcutIds();
    this.#order = reorder(ids, ids.indexOf(memberId), to);
    this.#refocus = memberId;
    this.announcement = t("action.reordered")
      .replace("{item}", name)
      .replace("{index}", String(to + 1))
      .replace("{total}", String(ids.length));
    this.#send("wt-shortcut-move", { memberId, to });
  }

  #gripKey(event: KeyboardEvent, memberId: string, name: string): void {
    const step = KEY_STEPS[event.key];
    if (step === undefined || this.busy || this.shortcuts === null) return;
    // Without this the arrow scrolls the page, carrying the tile out from under the grip.
    event.preventDefault();
    const ids = this.#shortcutIds();
    const to = ids.indexOf(memberId) + step;
    if (to < 0 || to >= ids.length) return;
    this.#move(memberId, name, to);
  }

  #gripDown(event: PointerEvent, memberId: string, name: string): void {
    if (event.button !== 0 || this.busy || this.#press !== null) return;
    const grip = event.currentTarget as HTMLElement;
    capturePointer(grip, event.pointerId);
    this.#press = {
      memberId,
      name,
      grip,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("pointerup", this.#onPointerUp);
    document.addEventListener("pointercancel", this.#onPointerCancel);
    document.addEventListener("keydown", this.#onDragKey, true);
  }

  /** The shortcut cell under the pointer, other than the dragged one; never an add tile or the
   * menu block, so those are never a place to drop. */
  #shortcutAt(x: number, y: number, dragged: string): string | null {
    for (const element of pointerElementsAt(x, y)) {
      if (element.getRootNode() !== this.shadowRoot) continue;
      if (!(element instanceof HTMLElement) || !element.classList.contains("shortcut")) continue;
      const over = element.dataset.memberId!;
      return over === dragged ? null : over;
    }
    return null;
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    const press = this.#press!;
    if (event.pointerId !== press.pointerId) return;
    this.#pointer = { x: event.clientX, y: event.clientY };
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      holdPageCursor();
      this.requestUpdate();
      this.#edgeScroll.start(press.grip, this.#pointer, () => this.#trackDrop());
    }
    this.#edgeScroll.update(this.#pointer);
    this.#trackDrop();
  };

  #trackDrop(): void {
    this.dropOn = this.#shortcutAt(this.#pointer.x, this.#pointer.y, this.#press!.memberId);
  }

  readonly #onPointerUp = (event: PointerEvent): void => {
    const press = this.#press!;
    if (event.pointerId !== press.pointerId) return;
    const over = this.dropOn;
    this.#endPress();
    if (over === null || this.busy) return;
    // A new list from the host while the pointer was held may have dropped either shortcut.
    const ids = this.#shortcutIds();
    const to = ids.indexOf(over);
    if (to >= 0 && ids.includes(press.memberId)) this.#move(press.memberId, press.name, to);
  };

  readonly #onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.#press!.pointerId) this.#endPress();
  };

  readonly #onDragKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    // Escape here ends the drag only, not a dialog the preview sits in.
    event.preventDefault();
    event.stopPropagation();
    this.#endPress();
  };

  #endPress(): void {
    const press = this.#press;
    if (press === null) return;
    this.#edgeScroll.stop();
    this.#press = null;
    releasePointer(press.grip, press.pointerId);
    if (press.dragging) releasePageCursor();
    this.dropOn = null;
    this.requestUpdate();
    document.removeEventListener("pointermove", this.#onPointerMove);
    document.removeEventListener("pointerup", this.#onPointerUp);
    document.removeEventListener("pointercancel", this.#onPointerCancel);
    document.removeEventListener("keydown", this.#onDragKey, true);
  }

  #dropSide(memberId: string): "before" | "after" | typeof nothing {
    const press = this.#press;
    if (press === null || this.dropOn !== memberId) return nothing;
    const ids = this.#shortcutIds();
    return ids.indexOf(memberId) < ids.indexOf(press.memberId) ? "before" : "after";
  }

  /** A shortcut's face and the name it is known by: the device's tile, or a dashed, muted
   * one when the menu no longer reaches its target or a device would draw nothing. */
  #shortcutFace(
    tile: HomeTile,
    index: PreviewIndex,
    mode: HomeTileMode,
  ): { face: TemplateResult; name: string } {
    const { ref } = tile;
    if (!tile.reachable || ref.kind === "missing") {
      const name = t("home.missing").replace("{name}", tile.missingName ?? tile.name);
      return {
        name,
        face: html`<div class="tile" data-state="missing">
          <span class="label"><span class="name">${name}</span></span>
        </div>`,
      };
    }
    const opens = ref.kind === "section" ? [{ sectionId: ref.sectionId, copy: 0 }] : [];
    const face = this.#tile(ref, opens, index, mode);
    if (face === nothing)
      return {
        name: tile.name,
        face: html`<div class="tile" data-state="hidden">
          <span class="label">
            <span class="name">${tile.name}</span>
            <span class="kind">${t("home.not_shown")}</span>
          </span>
        </div>`,
      };
    const name =
      ref.kind === "section"
        ? this.#sectionName(openedSection(ref.sectionId, index)!)
        : index.products.get(ref.productId)!.name;
    return { name, face };
  }

  #editCell(tile: HomeTile, index: PreviewIndex, mode: HomeTileMode): TemplateResult {
    const { memberId } = tile;
    const { face, name } = this.#shortcutFace(tile, index, mode);
    return html`<div
      class="shortcut"
      data-member-id=${memberId}
      data-drop=${this.#dropSide(memberId)}
      ?data-dragging=${this.#press?.dragging === true && this.#press.memberId === memberId}
    >
      ${face}
      <div class="controls">
        <button
          type="button"
          class="grip"
          data-test=${`grip-${memberId}`}
          aria-label=${`${t("members.reorder")}: ${name}`}
          ?disabled=${this.busy}
          @keydown=${(event: KeyboardEvent) => this.#gripKey(event, memberId, name)}
          @pointerdown=${(event: PointerEvent) => this.#gripDown(event, memberId, name)}
        >
          <wt-icon name="grip"></wt-icon>
        </button>
        <wt-row-actions
          align="end"
          data-test=${`actions-${memberId}`}
          label=${`${t("members.actions")}: ${name}`}
          ><wt-button
            align="start"
            variant="secondary"
            data-test=${`remove-${memberId}`}
            .disabled=${this.busy}
            @click=${() => {
              if (!this.busy) this.#send("wt-shortcut-remove", { memberId });
            }}
            >${t("home.remove")}</wt-button
          ></wt-row-actions
        >
      </div>
    </div>`;
  }

  #editCells(list: HomeTile[], index: PreviewIndex, mode: HomeTileMode): TemplateResult {
    return html`${repeat(
      this.#editable(list),
      (tile) => tile.memberId,
      (tile) => this.#editCell(tile, index, mode),
    )}${ADD_TILES.map(
      ({ kind, label }) =>
        html`<wt-button
          class="add"
          variant="secondary"
          data-test=${`add-${kind}`}
          .disabled=${this.busy}
          @click=${() => {
            if (!this.busy) this.#send("wt-shortcut-add", { kind });
          }}
        >
          <span class="label"><wt-icon name="plus"></wt-icon><span>${label()}</span></span>
        </wt-button>`,
    )}`;
  }

  #sectionName(section: SectionNode): string {
    return localizedName(section.names) || section.internalName;
  }

  #grid(content: unknown, display: HomeDisplay, editing = false): TemplateResult {
    return html`<div
      class="grid"
      ?data-editing=${editing}
      style=${`--columns: ${display.columns};`}
    >
      ${content}
    </div>`;
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

  #sectionTile(section: SectionNode, mode: HomeTileMode, opens: SectionStep[]): TemplateResult {
    const fill = tileFill(mode, section.image, section.color);
    const paint = fill.kind === "color" ? tilePaint(fill.color) : undefined;
    return html`<wt-button
      class="tile"
      data-kind="section"
      style=${paint ?? nothing}
      ?data-painted=${paint !== undefined}
      @click=${() => {
        this.path = opens;
      }}
    >
      <span class="label">
        ${fill.kind === "image" ? thumb(fill.image) : html`<wt-icon name="folder"></wt-icon>`}
        <span class="name">${this.#sectionName(section)}</span>
        <span class="kind">${t("home.tile_section")}</span>
      </span>
    </wt-button>`;
  }

  /** The tile for a section or product the index holds, else nothing; `opens` is the path a
   * section tile opens. A structural member is drawn from itself, a shortcut from the copy it
   * opens. */
  #tile(
    ref: DocumentTile | DocumentMember,
    opens: SectionStep[],
    index: PreviewIndex,
    mode: HomeTileMode,
  ): TemplateResult | typeof nothing {
    if (ref.kind === "empty") return nothing;
    if (ref.kind === "section") {
      if (!index.sections.has(ref.sectionId)) return nothing;
      const section = "members" in ref ? ref : openedSection(ref.sectionId, index)!;
      return this.#sectionTile(section, mode, opens);
    }
    const offer = index.products.get(ref.productId);
    return offer === undefined ? nothing : this.#productTile(offer, mode);
  }

  #listTiles(
    list: readonly DocumentMember[],
    path: SectionStep[],
    index: PreviewIndex,
    mode: HomeTileMode,
  ): (TemplateResult | typeof nothing)[] {
    const opens = tilePaths(list, path);
    return list.map((member, place) => this.#tile(member, opens[place]!, index, mode));
  }

  #home(document: MenuDocument, index: PreviewIndex, display: HomeDisplay): TemplateResult {
    const shortcuts = document.home.shortcuts.map((tile) =>
      this.#tile(
        tile,
        tile.kind === "section" ? [{ sectionId: tile.sectionId, copy: 0 }] : [],
        index,
        display.tiles,
      ),
    );
    const members = this.#listTiles(index.home, [], index, display.tiles);
    const editing = this.shortcuts;
    const { blocks, divider } = arrangeHome(
      display.order,
      editing !== null || shortcuts.some((cell) => cell !== nothing),
      members.some((cell) => cell !== nothing),
    );
    return html`${blocks.map((block, place) => {
      const shortcutBlock = block === "shortcuts";
      const label = t(shortcutBlock ? "home.block_shortcuts" : "home.block_menu");
      const cells = !shortcutBlock
        ? members
        : editing !== null
          ? this.#editCells(editing, index, display.tiles)
          : shortcuts.map((cell) =>
              cell === nothing ? html`<span class="slot" aria-hidden="true"></span>` : cell,
            );
      const region = shortcutBlock ? "shortcuts" : "structure";
      return place === 1 && divider
        ? html`<section data-region=${region} aria-labelledby=${`${region}-divider`}>
            <h2 class="divider" id=${`${region}-divider`}><span>${label}</span></h2>
            ${this.#grid(cells, display, shortcutBlock && editing !== null)}
          </section>`
        : html`<section data-region=${region} aria-label=${label}>
            ${this.#grid(cells, display, shortcutBlock && editing !== null)}
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
        this.#listTiles(shownMembers(current.members), this.path, index, display.tiles),
        display,
      )}
    </section>`;
  }

  #results(names: [FrozenOffer, string][], display: HomeDisplay): TemplateResult {
    const found = searchFor(this.query)(names);
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
      ${
        this.shortcuts === null
          ? nothing
          : html`<div role="status" aria-live="polite" class="status">${this.announcement}</div>`
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-device-home-preview": DeviceHomePreview;
  }
}
