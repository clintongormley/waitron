import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { fieldLabelState, fieldStyles } from "@waitron/ui-core/field-styles";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
import "./wt-icon.js";

export interface ColourChoice {
  /** What `value` matches and `wt-change` carries, e.g. "red". */
  value: string;
  /** The colour's name, in the screen's language. */
  label: string;
  /** A CSS colour for its square: a `var(--wt-color-…)` read, so a theme repaints it. */
  fill: string;
  /** The names of the other things that use this colour, in the order to show them. */
  usedBy?: readonly string[];
}

/** A form field showing the chosen colour, which opens a panel of colour tiles. */
@customElement("wt-colour-chooser")
export class WtColourChooser extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }

      /* The trigger under it takes the click: the label names the trigger through aria-labelledby,
         not through for. */
      .field-label {
        pointer-events: none;
      }

      .trigger {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        text-align: start;
        cursor: pointer;
      }

      .value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
      }

      .chevron {
        flex: none;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
      }

      .swatch {
        flex: none;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--swatch-fill);
      }

      [popover] {
        position: fixed;
        margin: 0;
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }

      [role="radiogroup"] {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--wt-space-2);
      }

      .tile {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-width: 0;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      .tile[aria-checked="true"] {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-primary);
        outline-offset: calc(-1 * var(--wt-field-line-width-active));
        font-weight: var(--wt-font-weight-bold);
      }

      .tile-text {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-width: 0;
      }

      .names {
        display: grid;
        min-width: 0;
      }

      .colour-name,
      .used-by {
        overflow-wrap: anywhere;
      }

      .used-by {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }
    `,
  ];

  @property() name = "";
  @property() label = "";
  /** Controlled: the field shows the choice whose value this is, or none. */
  @property() value = "";
  @property({ attribute: false }) choices: readonly ColourChoice[] = [];
  @property({ type: Boolean }) required = false;
  @property({ type: Boolean }) disabled = false;
  @property() error = "";
  /** A used colour's accessible name; `names` are its `usedBy`, joined with ", ". */
  @property({ attribute: false }) usedByLabel: (colour: string, names: string) => string = (
    colour,
    names,
  ) => `${colour}, ${names}`;

  @state() private expanded = false;
  @query("button.trigger") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement | null;

  private readonly labelId = uniqueId("wt-colour-chooser-label");
  private readonly triggerId = uniqueId("wt-colour-chooser-trigger");
  private readonly panelId = uniqueId("wt-colour-chooser-panel");
  private readonly errorId = uniqueId("wt-colour-chooser-error");

  /** Opens the panel. Does nothing while disabled, before the first render, while the host is off
   * the page (where a popover cannot open), or while it is already open. */
  show(): void {
    const popup = this.popup;
    if (this.disabled || !popup || !this.isConnected || popup.matches(":popover-open")) return;
    popup.showPopover();
    this.positionPopup();
    this.tabStop()?.focus();
  }

  hide(): void {
    if (this.popup?.matches(":popover-open")) this.popup.hidePopover();
  }

  override disconnectedCallback(): void {
    this.expanded = false;
    super.disconnectedCallback();
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("disabled") && this.disabled) this.hide();
  }

  private get chosen(): ColourChoice | undefined {
    return this.choices.find((choice) => choice.value === this.value);
  }

  private tabStop(): HTMLButtonElement | null {
    return this.popup!.querySelector<HTMLButtonElement>('[role="radio"][tabindex="0"]');
  }

  /** Below the trigger and as wide as it; Task 1b of A753 replaces this placement. */
  private positionPopup(): void {
    const anchor = this.trigger.getBoundingClientRect();
    const popup = this.popup!;
    popup.style.width = `${anchor.width}px`;
    popup.style.left = `${anchor.left}px`;
    popup.style.top = `${anchor.bottom}px`;
  }

  private onTriggerClick(event: MouseEvent): void {
    // Prevented so the popovertarget's own toggle does not undo the one made here.
    event.preventDefault();
    if (this.popup!.matches(":popover-open")) this.hide();
    else this.show();
  }

  private onToggle(event: ToggleEvent): void {
    this.expanded = event.newState === "open";
  }

  private onTileClick(choice: ColourChoice, event: MouseEvent): void {
    if (choice.value !== this.value) dispatchWtChange(this, event, { value: choice.value });
    this.hide();
    this.trigger.focus();
  }

  private renderSwatch(fill: string) {
    return html`<span
      class="swatch"
      part="swatch"
      style=${styleMap({ "--swatch-fill": fill })}
    ></span>`;
  }

  private renderTile(choice: ColourChoice, tabStop: boolean) {
    const usedBy = choice.usedBy ?? [];
    const checked = choice.value === this.value;
    return html`<button
      type="button"
      class="tile"
      role="radio"
      aria-checked=${checked ? "true" : "false"}
      tabindex=${tabStop ? "0" : "-1"}
      data-value=${choice.value}
      aria-label=${usedBy.length ? this.usedByLabel(choice.label, usedBy.join(", ")) : choice.label}
      @click=${(event: MouseEvent) => this.onTileClick(choice, event)}
    >
      <span class="tile-text" aria-hidden="true">
        ${this.renderSwatch(choice.fill)}
        <span class="names">
          <span class="colour-name">${choice.label}</span>
          ${usedBy.length ? html`<span class="used-by">${usedBy.join(", ")}</span>` : nothing}
        </span>
      </span>
    </button>`;
  }

  override render() {
    const chosen = this.chosen;
    const hasError = this.error !== "";
    const stopIndex = Math.max(0, chosen ? this.choices.indexOf(chosen) : 0);
    return html`
      <div
        class="field"
        part="field"
        data-label=${fieldLabelState({ value: chosen?.label ?? "", hint: "", placeholder: "" })}
        ?data-invalid=${hasError}
        ?data-disabled=${this.disabled}
      >
        <label class="field-label" id=${this.labelId}
          ><span class="field-label-text">${this.label}</span>${
            this.required
              ? html`<span class="required" data-required aria-hidden="true">*</span>`
              : nothing
          }</label
        >
        <button
          type="button"
          id=${this.triggerId}
          name=${this.name || nothing}
          class="field-control trigger"
          aria-expanded=${this.expanded ? "true" : "false"}
          aria-controls=${this.panelId}
          aria-labelledby=${`${this.labelId} ${this.triggerId}`}
          aria-invalid=${hasError ? "true" : nothing}
          aria-describedby=${hasError ? this.errorId : nothing}
          popovertarget=${this.panelId}
          ?disabled=${this.disabled}
          @click=${this.onTriggerClick}
        >
          ${chosen ? this.renderSwatch(chosen.fill) : nothing}
          <span class="value">${chosen?.label ?? ""}</span>
          <wt-icon class="chevron" name="chevron-down"></wt-icon>
        </button>
      </div>
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
      <div id=${this.panelId} popover part="panel" @toggle=${this.onToggle}>
        <div
          role="radiogroup"
          aria-labelledby=${this.labelId}
          aria-required=${this.required ? "true" : "false"}
        >
          ${this.choices.map((choice, index) => this.renderTile(choice, index === stopIndex))}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-colour-chooser": WtColourChooser;
  }
}
