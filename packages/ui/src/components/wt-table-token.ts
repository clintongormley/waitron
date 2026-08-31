import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import type { FloorTable } from "../floor.js";
// `TimingBand` is a plain data shape from the GENERIC `@waitron/shared` package (not a server
// package) — same rationale as `floor.ts`'s identical import.
import type { TimingBand } from "@waitron/shared";

/**
 * The optional locale-dependent suffix words the token renders next to its DATA. Copy travels as props
 * (the `@waitron/ui` convention — see wt-switch's `label`), never as hardcoded locale strings, so a
 * consumer app threads its own i18n through: `covers` follows the cover count ("plazas"/"covers"),
 * `toServe` follows the pending-to-serve count ("por servir"/"to serve"). Absent ⇒ just the number.
 * `forgotten` is the accessible name for the order-timing FORGOTTEN marker (KDS order-timing alerts,
 * design §7.3) — absent ⇒ the marker renders `aria-hidden` (decorative, colour/shape only), exactly
 * like `covers`/`toServe`'s "absent ⇒ bare" convention. This package carries no inline copy of its
 * own, so an app that wants the marker to have a name (rather than being purely visual) supplies one.
 */
export interface TableTokenLabels {
  covers?: string;
  toServe?: string;
  /** The PREFIX word for the reserved chip (the localised "Reserved"), rendered before the "HH:MM" time
   *  ("Reserved 20:30"), unlike the count-suffix labels above. Absent ⇒ just the time. */
  reserved?: string;
  /** The accessible name for the forgotten marker (KDS order-timing alerts, design §7.3) — the localised
   *  "Forgotten". Absent ⇒ the CSS-only marker stays `aria-hidden`. */
  forgotten?: string;
}

/**
 * The shared occupancy TOKEN: FP-1's live-floor card visual, extracted verbatim so the till's list card
 * (FP-2 Task 6) and the floor map (`<wt-floor-canvas>`) render the SAME markup, class names and
 * state-accent colours and can never drift apart. Purely presentational — it owns no interaction; the
 * consumer wraps it in whatever tappable/draggable element it needs and reads the placement itself.
 *
 * State accent (a coloured left edge) is DATA-driven from {@link FloorTable.state}, using the exact FP-1
 * tokens: `free → --wt-color-success`, `open-tab → --wt-color-primary`, `delivery-pending →
 * --wt-color-danger`. The manual status badge's arbitrary colour rides on an inline style (never chrome
 * CSS), exactly as FP-1's card, so an unreviewed status colour can never fail the no-hardcoded-chrome
 * guard.
 */
@customElement("wt-table-token")
export class WtTableToken extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      /* Mirrors till-floor-screen's .card body: the occupancy accent is the left edge, coloured by
         state via the tokens below — identical to FP-1 so the map token and the list card match. */
      .card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        text-align: left;
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

      /* Order-timing accent (KDS order-timing alerts, design §7.3) — the SAME age- and flash class
         scheme and reduced-motion gating till-floor-screen's LIST card, till-station-queue's rail
         card and till-expo-screen's order card all use, so a table reads the same escalation on
         whichever floor view a manager happens to be looking at. Laid down as an INSET BOX-SHADOW
         rather than another border colour, deliberately: .card's left edge already carries the
         OCCUPANCY accent (.state-* above), and a box-shadow is a wholly separate CSS property, so the
         two accents can never fight over ownership of the same edge — both render, always, side by
         side. timingBand undefined/'fresh' gets no override. The ring width reuses --wt-space-1 — the
         SAME token .state-*'s border-left already uses, so the two accents read as one thickness. */
      .card.age-warm {
        box-shadow: inset 0 0 0 var(--wt-space-1) var(--wt-color-primary);
      }

      .card.age-overdue,
      .card.age-forgotten {
        box-shadow: inset 0 0 0 var(--wt-space-1) var(--wt-color-danger);
      }

      /* The FORGOTTEN flash: a repeating fade of the inset accent, never a colour/motion change
         behind text — .flash is applied only when the OS/browser has NOT asked for reduced motion
         (#prefersReducedMotion), so an assistive-motion setting renders the steady danger-toned
         box-shadow above with no @keyframes at all. The @media guard is a second, CSS-only line of
         defence for the same preference (belt-and-suspenders, house a11y rule) — mirrors
         till-floor-screen's/till-station-queue's/till-expo-screen's identical treatment. */
      .card.age-forgotten.flash {
        animation: age-forgotten-flash 1s ease-in-out infinite;
      }

      @keyframes age-forgotten-flash {
        50% {
          box-shadow: inset 0 0 0 var(--wt-space-1) transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .card.age-forgotten.flash {
          animation: none;
        }
      }

      /* The forgotten MARKER (design §7.3) — a non-colour tell shown UNCONDITIONALLY for a forgotten
         table (not just under reduced motion, exactly like till-floor-screen's .badge.forgotten text
         chip: it never animates itself, so an operator who cannot distinguish the accent's colour or
         perceive its flash still sees the escalation). A small CSS-only TRIANGLE — never text, since
         this package carries no inline copy and a spatial token has no room for a text chip like the
         list card's — and deliberately a DIFFERENT silhouette from the round .dot/.badge.status
         swatch, so it cannot be mistaken for a manual-status marker. Positioned over the card's
         corner via the position: relative on .card above; every dimension is token-driven, never a
         literal length (this package's no-hardcoded-chrome guard bans it). */
      .forgotten-marker {
        position: absolute;
        top: calc(var(--wt-space-1) * -1);
        right: calc(var(--wt-space-1) * -1);
        width: 0;
        height: 0;
        border-left: var(--wt-space-2) solid transparent;
        border-right: var(--wt-space-2) solid transparent;
        border-bottom: var(--wt-space-3) solid var(--wt-color-danger);
      }

      /* The stored table SHAPE renders distinctly through the corner radius — a round table reads as a
         circular/stadium token, a square one as sharp corners, a rect one as the default rounded rect —
         so the shape control is a live visual, not a dead enum. Token-driven (never a literal px/%) so
         a deployment can retheme the radii. The base card rule above sets the rect default; these
         shape classes override it. */
      .card.shape-round {
        border-radius: var(--wt-radius-full);
      }

      .card.shape-square {
        border-radius: var(--wt-radius-sm);
      }

      .card.shape-rect {
        border-radius: var(--wt-radius-md);
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

      /* "Reserved HH:MM" (Bookings-1 §4) — the table's imminent booking. Distinguished from the service
         hints by a PRIMARY border on a neutral chip (theme text on a neutral fill, so the token-fixed
         contrast holds and no arbitrary colour is involved): distinct from the ready chip's success
         border and the status chip's neutral border. It is an independent signal — it sits beside the
         one service hint and the manual status, never in their place. */
      .badge.reserved {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-primary);
      }

      /* The manual-status chip: text in the theme colour on a neutral chip, with the DATA-driven status
         colour as a border + a small swatch — never as a text background, so contrast stays token-fixed
         and the arbitrary colour cannot fail a11y. Verbatim from FP-1's .badge.status. */
      .badge.status {
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .dot {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
      }
    `,
  ];

  /** The table this token renders. */
  @property({ attribute: false }) table!: FloorTable;

  /** Optional localisable suffix words (see {@link TableTokenLabels}). */
  @property({ attribute: false }) labels: TableTokenLabels = {};

  /**
   * Whether to render the FORGOTTEN band's flash as a steady accent instead (house a11y rule — never
   * colour/motion as the only signal, and the flash must honour prefers-reduced-motion). `undefined`
   * (the default) checks the live media query on every render; a test injects `true`/`false` for a
   * deterministic assertion — the same injectable-override shape till-floor-screen/
   * till-station-queue/till-expo-screen already use (KDS order-timing alerts, design §7.3).
   *
   * NO TickingClock here — this token is a pure presentational leaf fed by whatever `.table` the
   * consumer (`till-floor-screen`, via `wt-floor-canvas`) supplies on ITS OWN refresh cadence; the
   * same controller ruling `till-floor-screen.ts` documents applies unchanged.
   */
  @property({ attribute: false }) reducedMotion?: boolean;

  /** Whether the flash animation should be suppressed in favour of a steady accent — the live
   *  prefers-reduced-motion media query unless {@link reducedMotion} is injected. Mirrors
   *  till-floor-screen/till-station-queue/till-expo-screen. */
  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** The order-timing accent class for the table's timingBand (KDS order-timing alerts, design
   *  §7.3): undefined/'fresh' renders nothing (the occupancy accent is untouched); 'warm'/'overdue'
   *  get the steady age-* class; 'forgotten' additionally gets 'flash' unless motion is reduced.
   *  Space-prefixed (or empty) so it interpolates directly after the shape class. Mirrors
   *  till-floor-screen's identical #timingAccentClass. */
  #timingAccentClass(band: TimingBand | undefined): string {
    if (band === undefined || band === "fresh") return "";
    const flash = band === "forgotten" && !this.#prefersReducedMotion();
    return ` age-${band}${flash ? " flash" : ""}`;
  }

  /** The forgotten marker (design §7.3) — a non-colour tell rendered UNCONDITIONALLY whenever
   *  timingBand is 'forgotten' (never gated on reducedMotion itself, exactly like
   *  till-floor-screen's .badge.forgotten text chip). Its accessible name is OPTIONAL and
   *  consumer-supplied ({@link TableTokenLabels.forgotten}) — present, the marker carries
   *  role="img"/aria-label; absent, it is aria-hidden (purely decorative, colour/shape only), the
   *  same "absent ⇒ bare" convention covers/toServe already use. */
  #forgottenMarker(t: FloorTable): TemplateResult | typeof nothing {
    if (t.timingBand !== "forgotten") return nothing;
    const label = this.labels.forgotten;
    return label
      ? html`<span class="forgotten-marker" data-forgotten role="img" aria-label=${label}></span>`
      : html`<span class="forgotten-marker" data-forgotten aria-hidden="true"></span>`;
  }

  override render(): TemplateResult | typeof nothing {
    const t = this.table;
    // Nothing to draw until a table is assigned (a bare element mounted before its `.table` prop set).
    if (t == null) return nothing;
    // The stored shape drives a distinct corner radius (see the `.shape-*` rules). An unplaced tray
    // token carries no shape (`null`) and falls back to `rect` — the default rounded rect it drew
    // before, so the tray is visually unchanged.
    return html`
      <div
        class="card state-${t.state} shape-${t.shape ?? "rect"}${this.#timingAccentClass(
          t.timingBand,
        )}"
      >
        ${this.#forgottenMarker(t)}
        <span class="card-head">
          <span class="label">${t.label}</span>
          ${
            t.capacity != null
              ? html`<span class="capacity"
                  >${t.capacity}${this.labels.covers ? ` ${this.labels.covers}` : nothing}</span
                >`
              : nothing
          }
        </span>
        ${this.#occupancy(t)}
        <span class="badges">
          ${
            t.pendingToServe > 0
              ? html`<span class="badge to-serve" data-to-serve
                  >${t.pendingToServe}${this.labels.toServe ? ` ${this.labels.toServe}` : nothing}</span
                >`
              : nothing
          }
          ${
            t.reservedTime != null
              ? html`<span class="badge reserved" data-reserved
                  >${this.labels.reserved ? html`${this.labels.reserved} ` : nothing}${t.reservedTime}</span
                >`
              : nothing
          }
          ${
            t.status != null
              ? html`<span class="badge status" data-status style="border-color: ${t.status.color}">
                  <span class="dot" style="background: ${t.status.color}"></span>${t.status.label}
                </span>`
              : nothing
          }
        </span>
      </div>
    `;
  }

  /** The state-specific occupancy body — only the open tab's running total is DATA the token can show
   * without a locale word; the free / delivery lines are the consumer's to add via its own copy. */
  #occupancy(t: FloorTable): TemplateResult | typeof nothing {
    if (t.state === "open-tab" && t.tabTotal != null) {
      return html`<span class="occupancy tab-open"
        ><span class="total">${t.tabTotal} €</span></span
      >`;
    }
    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-table-token": WtTableToken;
  }
}
