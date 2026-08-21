import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { FloorZone, TableState } from "../api/client.js";

/**
 * The TILL live-floor screen (FP-1, design §4): the venue's tables laid out by zone with their live
 * occupancy, so an operator can see at a glance which tables are free, which carry an open tab and how
 * much, which are waiting on a delivery, and which still have food to take out. Tapping a table asks the
 * app to open (or resume) that table's tab — the screen itself owns NO fiscal path (design H2): a tab is
 * a PRE-FISCAL working order, and `open-table` is the only thing this screen decides. The app turns it
 * into an `openTab` (a free table) or a straight transition (an occupied one) and moves to the
 * table-ordering screen.
 *
 * Zones are shown as TABS (ordered by `displayOrder`), plus a "Sin zona" tab for tables not yet assigned
 * to any zone; the selected tab's tables fill a responsive grid of occupancy-coloured cards. It reads
 * only two props — the venue's {@link FloorZone}s and the live {@link TableState} read-model — and holds
 * no data of its own beyond which tab is showing; the app owns and refreshes both.
 *
 * COPY. Every user-facing label comes from the till's i18n catalogue (`i18n/strings.ts`) via `t()`, like
 * the sibling screens — the `floor.*` keys. `t()` takes no params, so a count-bearing label is
 * `${n} ${t(key)}` (value + suffix word). The shipped default locale is es-ES, so these render in Spanish
 * ("Sala", "Libre", "por servir", "Sin zona"); the English base is the source of truth. Identifiers stay
 * English. Zone names and totals are DATA and pass through verbatim.
 *
 * Lit + `@waitron/ui` `baseStyles` + theme tokens only — no hardcoded chrome colour/spacing, so the
 * screen follows the operator's theme exactly like every sibling till screen (the occupancy accent and
 * the manual-status swatch are the only colours, and the status colour is DATA from the read-model, not
 * chrome). HA-free — the till's own design system.
 */
@customElement("till-floor-screen")
export class TillFloorScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        padding: var(--wt-space-4);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      /* A responsive grid: cards flow to fill the width, wrapping onto new rows on a narrow till. */
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
        gap: var(--wt-space-3);
      }

      .card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-2);
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        /* The occupancy accent lives on the left edge, coloured by state (tokens below). */
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .card.state-free {
        border-left-color: var(--wt-color-success);
      }

      .card.state-open-tab {
        border-left-color: var(--wt-color-primary);
      }

      .card.state-delivery-pending {
        border-left-color: var(--wt-color-danger);
      }

      .card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
      }

      .label {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .capacity {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .occupancy {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .total {
        font-weight: var(--wt-font-weight-bold);
      }

      .lines,
      .occupancy.free,
      .occupancy.delivery {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1) var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .badge.to-serve {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
      }

      /* The manual-status chip: label in the theme's text colour on a neutral chip, with the DATA-driven
         status colour as a border + a small swatch — never as a text background, so contrast is fixed by
         the tokens and the arbitrary status colour cannot fail a11y. */
      .badge.status {
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .dot {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: 50%;
      }
    `,
  ];

  /** The venue's active floor-plan zones (the app loads them from `GET /api/zones`). */
  @property({ attribute: false }) zones: FloorZone[] = [];
  /** The live-floor occupancy read-model, one row per active table (from `GET /api/tables/state`). */
  @property({ attribute: false }) tables: TableState[] = [];

  /**
   * Which zone tab is showing: a zone id, `null` for the "Sin zona" tab, or `undefined` before the
   * operator has picked one — in which case {@link render} falls back to the FIRST tab. Kept as a
   * distinct `undefined` (rather than defaulting to a zone id) so the default tracks the current tab
   * order even before the zones prop has settled.
   */
  @state() private activeZone: string | null | undefined = undefined;

  /** Announce the operator wants this table's tab. The app opens (free) or resumes (occupied) it and
   * moves to the table-ordering screen — this screen never touches a fiscal path (design H2). */
  #openTable(table: TableState): void {
    this.dispatchEvent(
      new CustomEvent("open-table", {
        detail: { tableId: table.id, hasOpenTab: table.hasOpenTab },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Return to the counter (basket-preserving, handled by the app — mirrors the schedule screen). */
  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  /** Select a zone tab (a zone id, or `null` for the "Sin zona" tab). */
  #selectZone(key: string | null): void {
    this.activeZone = key;
  }

  /**
   * Whether a table belongs under the "Sin zona" tab: it has NO zone (`zoneId === null`), OR its zone is
   * not among the currently-active ones. The second case is the reachability fix — `deactivateZone` is a
   * soft `active = false` and never nulls a table's `zoneId`, so a table can point at a zone missing from
   * {@link zones}; without catching it here, that table (open tab and all) would match no tab and vanish.
   */
  #isZoneless(table: TableState, knownZoneIds: Set<string>): boolean {
    return table.zoneId === null || !knownZoneIds.has(table.zoneId);
  }

  /** The tabs to show: the active zones by `displayOrder`, plus a "Sin zona" tab iff some table is
   * zoneless or points at a deactivated zone (see {@link #isZoneless}). */
  #tabs(knownZoneIds: Set<string>): { key: string | null; name: string }[] {
    const zoneTabs = [...this.zones]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((z) => ({ key: z.id as string | null, name: z.name }));
    const hasZoneless = this.tables.some((table) => this.#isZoneless(table, knownZoneIds));
    return hasZoneless ? [...zoneTabs, { key: null, name: t("floor.no_zone") }] : zoneTabs;
  }

  /** The active tab's key: the operator's pick, or the first tab when none has been made. */
  #activeKey(tabs: { key: string | null }[]): string | null | undefined {
    return this.activeZone === undefined ? tabs[0]?.key : this.activeZone;
  }

  override render() {
    const knownZoneIds = new Set(this.zones.map((z) => z.id));
    const tabs = this.#tabs(knownZoneIds);
    const activeKey = this.#activeKey(tabs);
    // The "Sin zona" tab (activeKey === null) gathers the zoneless AND the deactivated-zone tables; a
    // real zone tab shows exactly its own tables.
    const visible = this.tables.filter((table) =>
      activeKey === null ? this.#isZoneless(table, knownZoneIds) : table.zoneId === activeKey,
    );
    return html`
      <section class="screen" aria-label=${t("floor.title")}>
        <header class="head">
          <h1 class="title">${t("floor.title")}</h1>
          <wt-button class="back" variant="secondary" @click=${() => this.#back()}>
            ${t("floor.back")}
          </wt-button>
        </header>
        ${
          tabs.length > 0
            ? html`<nav class="tabs" aria-label=${t("floor.zones")}>
                ${tabs.map((tab) => this.#tab(tab, activeKey))}
              </nav>`
            : nothing
        }
        <div class="grid">${visible.map((table) => this.#card(table))}</div>
      </section>
    `;
  }

  #tab(
    tab: { key: string | null; name: string },
    activeKey: string | null | undefined,
  ): TemplateResult {
    const active = tab.key === activeKey;
    return html`<wt-button
      class="tab"
      data-zone=${tab.key ?? "none"}
      variant=${active ? "primary" : "secondary"}
      @click=${() => this.#selectZone(tab.key)}
    >
      ${tab.name}
    </wt-button>`;
  }

  #card(table: TableState): TemplateResult {
    return html`<button
      class="card state-${table.state}"
      data-table=${table.id}
      @click=${() => this.#openTable(table)}
    >
      <span class="card-head">
        <span class="label">${table.label}</span>
        ${
          table.capacity !== null
            ? html`<span class="capacity">${table.capacity} ${t("floor.capacity")}</span>`
            : nothing
        }
      </span>
      ${this.#occupancy(table)}
      <span class="badges">
        ${
          table.pendingToServe > 0
            ? html`<span class="badge to-serve" data-to-serve
                >${table.pendingToServe} ${t("floor.to_serve")}</span
              >`
            : nothing
        }
        ${
          table.status !== null
            ? html`<span
                class="badge status"
                data-status
                style="border-color: ${table.status.color}"
              >
                <span class="dot" style="background: ${table.status.color}"></span
                >${table.status.label}
              </span>`
            : nothing
        }
      </span>
    </button>`;
  }

  /** The state-specific body of a card. The switch is exhaustive over {@link TableState.state}'s three
   * members (like the counter screen's `#widget`), so a new occupancy state is a compile error here
   * rather than a silently blank card. */
  #occupancy(table: TableState): TemplateResult {
    switch (table.state) {
      case "open-tab":
        return html`<span class="occupancy tab-open">
          <span class="total">${table.tabTotal} €</span>
          <span class="lines">${table.tabLineCount} ${t("floor.line_count")}</span>
        </span>`;
      case "delivery-pending":
        return html`<span class="occupancy delivery"
          >${table.pendingDeliveries} ${t("floor.pending_delivery")}</span
        >`;
      case "free":
        return html`<span class="occupancy free">${t("floor.free")}</span>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-floor-screen": TillFloorScreen;
  }
}
