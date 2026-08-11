import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import type { DashboardApi, LayoutDef, WidgetInstance, WidgetType } from "../api/client.js";
import { selectStyles } from "../select-styles.js";

/** The two regions a widget can sit in on the counter screen (mirrors layouts' `Region`). */
type Region = "main" | "aside";

/**
 * The six widget types in a fixed order — the picker lists the not-yet-placed ones in this order, and it
 * is the order `DEFAULT_LAYOUT` (= `LAYOUT_A`) uses. A LOCAL, bundle-decoupled mirror of
 * `@waitron/layouts`' `WIDGET_TYPES`: deliberately NOT imported (the `api/client.ts` bundle rule), and
 * the server's `validateLayout` stays the authority.
 */
const WIDGET_TYPES: readonly WidgetType[] = [
  "product-grid",
  "basket",
  "total",
  "tender-pay",
  "held-orders",
  "prep-queue",
];

/**
 * The region a freshly-added widget lands in — its NATURAL region, taken from `DEFAULT_LAYOUT`: the
 * product grid fills `main`, every other widget stacks in `aside`. This is the documented default-region
 * choice (design §9 / plan Task 11): the picker has no region control; a widget is added to the region
 * it occupies in the default layout, which the owner can then reorder within.
 */
const NATURAL_REGION: Record<WidgetType, Region> = {
  "product-grid": "main",
  basket: "aside",
  total: "aside",
  "tender-pay": "aside",
  "held-orders": "aside",
  "prep-queue": "aside",
};

/**
 * A LOCAL, bundle-decoupled mirror of `@waitron/layouts`' `WIDGET_CONFIG` (design §5/§9): the config
 * fields each widget exposes in the editor. Slice 1 wires exactly one — `product-grid.columns` (an
 * integer in 1..12); every other widget has an EMPTY schema and its sub-form shows "Sin ajustes". NOT
 * imported from `@waitron/layouts` (the `api/client.ts` rule); the server's `WIDGET_CONFIG` stays the
 * validation source of truth and rejects, fail-closed, anything this mirror lets through (D8).
 */
const WIDGET_CONFIG_FIELDS: Record<WidgetType, readonly "columns"[]> = {
  "product-grid": ["columns"],
  basket: [],
  total: [],
  "tender-pay": [],
  "held-orders": [],
  "prep-queue": [],
};

const COLUMNS_MIN = 1;
const COLUMNS_MAX = 12;

/**
 * Parse a `product-grid.columns` field value: an empty or non-numeric string drops the key (config back
 * to `{}`, which the server accepts — `columns` is optional); anything else is rounded and clamped to
 * [1, 12], the UI bound. The server's `intInRange(1, 12)` validator is the authority; this only keeps the
 * field from ever emitting an out-of-range value.
 */
function parseColumns(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, n));
}

/**
 * The management dashboard's LAYOUT SCREEN: authors a till `LayoutDef` (design §9, D1 — a list-based,
 * button-reordered editor, no drag-and-drop). On connect it loads `api.getLayout()` and splits the
 * definition into its two region columns (`main`, `aside`); each is an ordered list of widget rows on
 * `wt-card`s. Per row: ↑ / ↓ reorder WITHIN the region (disabled at the ends), Eliminar removes it, and
 * Editar toggles a config sub-form (product-grid's columns field; every other widget shows "Sin
 * ajustes"). An "Añadir widget" picker lists only the widget types NOT yet placed — duplicates are
 * rejected server-side (D5) — and appends the chosen one to its natural region.
 *
 * GUARDAR composes the rows back into a `LayoutDef` — main rows then aside rows, each in its displayed
 * order (so a round-trip of the default layout is byte-identical to `DEFAULT_LAYOUT`/`LAYOUT_A`) — and
 * calls `api.putLayout`. The compose normalises each row's `region` from the column it lives in, so the
 * field can never disagree with its column. `putLayout` is a full-replace idempotent PUT (design §7), so
 * there is no single-flight guard: a double-fire re-sends the same definition, not a second distinct
 * write.
 *
 * ERROR HANDLING mirrors `catalogue-screen.ts`/`staff-screen.ts`: `#load` and `#save` are each fully
 * `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` — the raw thrown `{ code }`,
 * falling back to `server.internal` — rendered in a `role="alert"` banner, never an unhandled promise
 * rejection (the `#boot` defect class). The raw code stays in `errorKey`; `codeMessage`
 * (`../i18n/codes.js`) maps it to localised copy at the render edge, and the widget row names come
 * from `t("widget.<type>")`, so the banner and rows show localised copy, never the raw code or key.
 */
@customElement("dashboard-layout-screen")
export class LayoutScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .regions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
      }
      .region {
        flex: 1;
        min-width: 16rem;
      }
      .region-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      .name {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
      }
      .controls {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .config {
        margin-top: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }
      .no-config {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .add {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-6);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
      }
      .save {
        margin-top: var(--wt-space-6);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The two region columns, each an ordered list of the widgets it holds. Split from the loaded
  // definition on connect; recomposed (main then aside) on Guardar.
  @state() private main: WidgetInstance[] = [];
  @state() private aside: WidgetInstance[] = [];
  // Which row's config sub-form is expanded (keyed by widget type, unique per layout — D5), or null.
  @state() private expanded: WidgetType | null = null;
  // The picker's current choice; reconciled against the still-available types in `#effectiveChoice`.
  @state() private addChoice: WidgetType | "" = "";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /**
   * Load the authored layout (or the server's defaults) and split its definition into the two region
   * columns. Each instance is cloned with a fresh `config` object so the editor's edits never mutate a
   * shared reference. A rejection becomes the `errorKey` banner rather than an unhandled rejection.
   */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const { definition } = await this.api.getLayout();
      this.main = definition.filter((w) => w.region === "main").map(cloneInstance);
      this.aside = definition.filter((w) => w.region === "aside").map(cloneInstance);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #rowsFor(region: Region): WidgetInstance[] {
    return region === "main" ? this.main : this.aside;
  }

  #setRows(region: Region, rows: WidgetInstance[]): void {
    if (region === "main") this.main = rows;
    else this.aside = rows;
  }

  /** Swap row `index` with its neighbour `delta` away (−1 up, +1 down) WITHIN its region. A move off
   * either end is a no-op — those buttons render disabled, this is the belt-and-braces guard. */
  #move(region: Region, index: number, delta: number): void {
    const rows = [...this.#rowsFor(region)];
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target]!, rows[index]!];
    this.#setRows(region, rows);
  }

  #remove(region: Region, index: number): void {
    this.#setRows(
      region,
      this.#rowsFor(region).filter((_, i) => i !== index),
    );
  }

  #toggleEdit(type: WidgetType): void {
    this.expanded = this.expanded === type ? null : type;
  }

  /** The set of widget types placed in either region — the picker's exclude list. */
  #placed(): Set<WidgetType> {
    return new Set([...this.main, ...this.aside].map((w) => w.type));
  }

  /** The widget types not yet placed, in canonical order — the picker's option list. */
  #available(): WidgetType[] {
    const placed = this.#placed();
    return WIDGET_TYPES.filter((type) => !placed.has(type));
  }

  /** The picker's effective selection: the current `addChoice` if still available, else the first
   * available type (so a never-touched picker still adds a sensible widget). */
  #effectiveChoice(available: WidgetType[]): WidgetType | "" {
    if (this.addChoice !== "" && available.includes(this.addChoice)) return this.addChoice;
    return available[0] ?? "";
  }

  #onAddChange(event: Event): void {
    event.stopPropagation();
    this.addChoice = (event.target as HTMLSelectElement).value as WidgetType;
  }

  /** Append the picked widget to its natural region with an empty config bag. */
  #add(): void {
    const type = this.#effectiveChoice(this.#available());
    if (type === "") return;
    const region = NATURAL_REGION[type];
    const instance: WidgetInstance = { type, region, config: {} };
    this.#setRows(region, [...this.#rowsFor(region), instance]);
    this.addChoice = "";
  }

  /** Update the `product-grid` instance's `columns` config wherever it sits. `stopPropagation` keeps
   * the composed `wt-change` inside this screen (the house field-handler pattern). */
  #onColumnsChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const columns = parseColumns(event.detail.value);
    const apply = (rows: WidgetInstance[]): WidgetInstance[] =>
      rows.map((w) => {
        if (w.type !== "product-grid") return w;
        const config = { ...w.config };
        if (columns === undefined) delete config.columns;
        else config.columns = columns;
        return { ...w, config };
      });
    this.main = apply(this.main);
    this.aside = apply(this.aside);
  }

  /**
   * Compose the rows back into a `LayoutDef` — main then aside, each in displayed order — and persist.
   * Each row's `region` is normalised from the column it lives in, so it can never disagree. A rejection
   * becomes the `errorKey` banner (the raw `layout.invalid` code the server throws, or a fallback), left
   * for the operator to read and retry; never an unhandled rejection (called via `void`).
   */
  async #save(): Promise<void> {
    this.errorKey = null;
    const definition: LayoutDef = [
      ...this.main.map((w) => ({ ...w, region: "main" as const })),
      ...this.aside.map((w) => ({ ...w, region: "aside" as const })),
    ];
    try {
      await this.api.putLayout(definition);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #renderConfig(instance: WidgetInstance): TemplateResult {
    if (WIDGET_CONFIG_FIELDS[instance.type].length === 0) {
      return html`<p class="no-config">${t("layout.no_config")}</p>`;
    }
    // Slice 1's only config field: product-grid.columns.
    const current = instance.config.columns;
    const value = typeof current === "number" ? String(current) : "";
    return html`<div class="config">
      <wt-input
        type="number"
        label=${t("layout.columns")}
        data-test="columns"
        .value=${value}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onColumnsChange(e)}
      ></wt-input>
    </div>`;
  }

  #renderRow(region: Region, rows: WidgetInstance[], instance: WidgetInstance, index: number) {
    const name = t(`widget.${instance.type}` as StringKey);
    return html`<li data-test="row-${instance.type}">
      <wt-card>
        <div class="row">
          <span class="name">${name}</span>
          <div class="controls">
            <wt-button
              size="sm"
              aria-label=${`${t("action.move_up")} ${name}`}
              data-test="up-${instance.type}"
              ?disabled=${index === 0}
              @click=${() => this.#move(region, index, -1)}
              >↑</wt-button
            >
            <wt-button
              size="sm"
              aria-label=${`${t("action.move_down")} ${name}`}
              data-test="down-${instance.type}"
              ?disabled=${index === rows.length - 1}
              @click=${() => this.#move(region, index, 1)}
              >↓</wt-button
            >
            <wt-button
              size="sm"
              data-test="edit-${instance.type}"
              @click=${() => this.#toggleEdit(instance.type)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              size="sm"
              variant="danger"
              data-test="remove-${instance.type}"
              @click=${() => this.#remove(region, index)}
              >${t("action.remove")}</wt-button
            >
          </div>
        </div>
        ${this.expanded === instance.type ? this.#renderConfig(instance) : nothing}
      </wt-card>
    </li>`;
  }

  #renderRegion(region: Region, title: string): TemplateResult {
    const rows = this.#rowsFor(region);
    return html`<section class="region" data-test="region-${region}">
      <h2 class="region-title">${title}</h2>
      ${
        rows.length === 0
          ? html`<p class="empty">${t("layout.no_widgets")}</p>`
          : html`<ol>
              ${rows.map((w, i) => this.#renderRow(region, rows, w, i))}
            </ol>`
      }
    </section>`;
  }

  override render(): TemplateResult {
    const available = this.#available();
    const choice = this.#effectiveChoice(available);
    return html`
      <h1 class="title">${t("layout.title")}</h1>
      <div class="regions">
        ${this.#renderRegion("main", t("layout.region_main"))}
        ${this.#renderRegion("aside", t("layout.region_aside"))}
      </div>

      ${
        available.length > 0
          ? html`<section class="add">
              <label class="picker"
                >${t("layout.widget_picker")}
                <select data-test="add-type" @change=${(e: Event) => this.#onAddChange(e)}>
                  ${available.map(
                    (type) =>
                      html`<option value=${type} .selected=${type === choice}>
                        ${t(`widget.${type}` as StringKey)}
                      </option>`,
                  )}
                </select>
              </label>
              <wt-button variant="secondary" data-test="add-widget" @click=${() => this.#add()}
                >${t("layout.add_widget")}</wt-button
              >
            </section>`
          : nothing
      }

      <div class="save">
        <wt-button variant="primary" data-test="save" @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </div>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

/** Clone a widget instance with a fresh `config` object so editor edits never mutate a shared bag. */
function cloneInstance(w: WidgetInstance): WidgetInstance {
  return { type: w.type, region: w.region, config: { ...w.config } };
}

/** The thrown `{ code }`, falling back to `server.internal` when a rejection names none. */
function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? "server.internal";
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-layout-screen": LayoutScreen;
  }
}
