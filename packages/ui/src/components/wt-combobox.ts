import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { fieldLabelState, fieldStyles } from "@waitron/ui-core/field-styles";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
import "./wt-icon.js";

export interface ComboboxOption {
  value: string;
  label: string;
  /** A registered wt-icon name, drawn before the label. */
  icon?: string;
  /** Consecutive options with the same group render under one heading. */
  group?: string;
  /** A row that sends `wt-combobox-action` and never becomes the value. */
  action?: true;
  /** Draws the row's label and icon in `--wt-color-primary-text`, so a row that makes or opens
   * something, rather than choosing a value, does not read as one more item of the list. */
  primary?: true;
  /** A second, muted line under the label in the open list, and the row's accessible description.
   * The closed field shows the label alone. */
  description?: string;
  /** Shown, matched by the search and reachable by the arrows, but never chosen or run. */
  disabled?: boolean;
}

/** With `search="auto"`, the search box shows only when there are more options than this. */
export const SEARCH_THRESHOLD = 7;

/**
 * The icons wt-combobox draws, which its consuming app registers. `check` is adapted from Google's
 * Material Symbols icon set, Copyright Google, licensed under the Apache License, Version 2.0
 * (https://www.apache.org/licenses/LICENSE-2.0), published at https://fonts.google.com/icons.
 */
export const DROPDOWN_ICONS: Record<string, string> = {
  "chevron-down": "M4.9 5.7L8 8.8L11.1 5.7L12 6.7L8 10.7L4 6.7Z",
  check: "M6.37 12L2.57 8.2L3.52 7.25L6.37 10.1L12.48 3.98L13.43 4.93Z",
};

const TYPE_AHEAD_RESET_MS = 500;

const NAVIGATION_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"] as const;
type NavigationKey = (typeof NAVIGATION_KEYS)[number];

function isNavigationKey(key: string): key is NavigationKey {
  return (NAVIGATION_KEYS as readonly string[]).includes(key);
}

function isPrintable(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

@customElement("wt-combobox")
export class WtCombobox extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }

      /* As wide as its text, not the box, so the trigger under the rest of the box takes the
         pointer; and stopped short of the chevron. */
      .field-label {
        inset-inline-end: auto;
        max-width: calc(100% - 2 * var(--wt-space-3) - var(--wt-font-size-md) - var(--wt-space-2));
      }

      .trigger {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        text-align: start;
        cursor: pointer;
      }

      :host([stable-width]) .trigger {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      :host([stable-width]) .value,
      :host([stable-width]) .width-option {
        grid-row: 1;
        grid-column: 1;
      }

      .width-option {
        height: 0;
        overflow: hidden;
        visibility: hidden;
        text-wrap: nowrap;
      }

      /* nowrap comes from text-wrap here because no-hardcoded-chrome.test.ts's keyword-colour scan
         rejects the older shorthand, whose property name begins with a colour keyword. */
      .value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
      }

      .value.placeholder {
        color: var(--wt-color-text-muted);
        font-style: italic;
      }

      .chevron {
        flex: none;
      }

      [popover] {
        position: fixed;
        margin: 0;
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }

      /* The panel is as wide as its content, and a text input's own default width would count. */
      .search-area {
        contain: inline-size;
        padding: var(--wt-space-2);
        box-shadow: var(--wt-shadow-1);
      }

      /* Its own primary border is the focus marking; a ring outside it would draw a second line. */
      .search:focus-visible {
        outline: none;
      }

      .search {
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: var(--wt-field-line-width) solid var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      .list,
      .group-rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .list {
        padding: var(--wt-space-1);
        scroll-padding-block: var(--wt-space-1);
        max-height: min(60vh, calc(var(--wt-dropdown-row-height) * 6));
        overflow-y: auto;
      }

      .list:focus-visible {
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      .group-heading {
        padding: var(--wt-space-2) var(--wt-space-3) var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-dropdown-row-height);
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        cursor: pointer;
      }

      .option-label,
      .option-text {
        flex: 1;
        min-width: 0;
      }

      .option-text {
        display: flex;
        flex-direction: column;
      }

      /* Contained so a description wraps inside the width the labels and the trigger give the
         panel instead of widening it. */
      .option-description {
        contain: inline-size;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .option[aria-selected="true"] .option-label {
        font-weight: var(--wt-font-weight-bold);
      }

      .option[aria-disabled="true"] {
        color: var(--wt-color-text-muted);
        cursor: not-allowed;
      }

      .icon,
      .tick {
        flex: none;
      }

      /* --wt-color-bg, not --wt-color-surface-raised: raised equals the panel's own surface in the
         light theme, so it would be invisible. Hover adds background; .active adds an outline — the
         two compose. */
      .option:not([aria-disabled="true"]):hover {
        background: var(--wt-color-bg);
      }

      .option.active {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      /* The icon names its own colour, so it is painted here too rather than inheriting. */
      .option.primary,
      .option.primary .icon {
        color: var(--wt-color-primary-text);
      }

      /* A picture of the row's own aria-selected, never a control: an interactive checkbox inside
         role="option" is an axe nested-interactive violation, which aria-hidden does not neutralise. */
      .check {
        flex: none;
        width: var(--wt-font-size-md);
        height: var(--wt-font-size-md);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
      }

      .check.checked {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-primary);
      }

      .check.checked::after {
        content: "";
        display: block;
        width: 30%;
        height: 55%;
        margin: 8% auto;
        border-inline-end: 1px solid var(--wt-color-on-primary);
        border-block-end: 1px solid var(--wt-color-on-primary);
        transform: rotate(45deg);
      }

      .empty {
        padding: var(--wt-space-2) var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }

      .add {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property() label = "";
  /** The trigger's DOM `id` and `name`, exactly as `wt-input` uses theirs, so a named field gets a
      stable semantic id instead of a generated one. It is NOT a native form association — no
      primitive in this design system has one (design-system.md → Forms). */
  @property() name = "";
  // The host's aria-label names the field only when `label` is empty; with `hide-label` and a
  // `label`, the `label` names it.
  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;
  @property() error = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ attribute: false }) options: ComboboxOption[] = [];
  @property() noResultsLabel = "No results";
  @property() searchPlaceholder = "Search";
  @property({ type: Boolean, reflect: true }) multiple = false;
  @property() value = "";
  /** Treat an offered empty-string option as a selection, while its value remains empty. */
  @property({ type: Boolean, attribute: "show-empty-option" }) showEmptyOption = false;
  /** Reserve each option label's width when every possible trigger text is an offered label. */
  @property({ type: Boolean, reflect: true, attribute: "stable-width" }) stableWidth = false;
  @property({ attribute: false }) values: string[] = [];
  @property() placeholder = "";
  @property({ attribute: false }) countLabel: (count: number) => string = (count) =>
    `${count} selected`;
  @property({ type: Boolean, reflect: true, attribute: "allow-add" }) allowAdd = false;
  @property({ attribute: false }) addLabel: (text: string) => string = (text) => `Add '${text}'`;
  /** Whether the open list has a search box: always, only above `SEARCH_THRESHOLD` options, or
   * never. `allow-add` shows it whatever this says, because the new option is typed into it. */
  @property() search: "always" | "auto" | "never" = "always";
  /** Shown as the placeholder unless one is given, and kept as the trigger's description because a
   * placeholder disappears once something is chosen. */
  @property() hint = "";
  /** Names the trigger by `label` without drawing it, and makes the field compact. */
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;

  @state() private expanded = false;
  @state() private searchText = "";
  @state() private activeIndex = -1;

  @query(".trigger") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;
  @query(".search") private searchInput!: HTMLInputElement | null;
  @query(".list") private listbox!: HTMLElement;

  // An unnamed combobox has no semantic id to give its trigger, so the label's `for` points at a
  // generated one instead.
  private readonly generatedTriggerId = uniqueId("wt-combobox-trigger");
  private readonly labelId = uniqueId("wt-combobox-label");
  private readonly listboxId = uniqueId("wt-combobox-listbox");
  private readonly errorId = uniqueId("wt-combobox-error");
  private readonly hintId = uniqueId("wt-combobox-hint");

  private get hasSearchBox(): boolean {
    if (this.allowAdd || this.search === "always") return true;
    return this.search === "auto" && this.options.length > SEARCH_THRESHOLD;
  }

  private get filteredOptions(): ComboboxOption[] {
    return this.filter(this.options);
  }

  private filter(options: ComboboxOption[]): ComboboxOption[] {
    const query = this.searchText.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }

  private get trimmedSearch(): string {
    return this.searchText.trim();
  }

  /** The add row offers only what no existing option already is, matched on the whole label. */
  private get showAddRow(): boolean {
    if (!this.allowAdd || !this.trimmedSearch) return false;
    const query = this.trimmedSearch.toLowerCase();
    return !this.options.some((option) => option.label.toLowerCase() === query);
  }

  /** Keyboard navigation counts the add row as the last row, after the filtered options. */
  private get rowCount(): number {
    return this.filteredOptions.length + (this.showAddRow ? 1 : 0);
  }

  private get firstRowIndex(): number {
    return this.rowCount > 0 ? 0 : -1;
  }

  private isSelected(option: ComboboxOption): boolean {
    if (option.action) return false;
    return this.multiple ? this.values.includes(option.value) : this.value === option.value;
  }

  private indexOfChosen(options: ComboboxOption[]): number {
    return options.findIndex((option) => this.isSelected(option));
  }

  /** The closed-state trigger text: the chosen label, or a count once more than one is chosen. */
  private get selectedText(): string {
    if (this.multiple) {
      if (this.values.length === 0) return "";
      if (this.values.length === 1) {
        return this.options.find((o) => !o.action && o.value === this.values[0])?.label ?? "";
      }
      return this.countLabel(this.values.length);
    }
    if (this.value === "" && !this.showEmptyOption) return "";
    return this.options.find((o) => !o.action && o.value === this.value)?.label ?? "";
  }

  // Refused while disabled because closing the panel on disable is not enough: a keystroke pressed
  // just after it closes can still reach its search box.
  private commitSelection(optionValue: string, sourceEvent: Event): void {
    if (this.disabled) return;
    if (this.multiple) {
      this.values = this.values.includes(optionValue)
        ? this.values.filter((v) => v !== optionValue)
        : [...this.values, optionValue];
      dispatchWtChange(this, sourceEvent, { values: this.values });
    } else {
      this.value = optionValue;
      dispatchWtChange(this, sourceEvent, { value: this.value });
      this.closeAndReturnFocus();
    }
  }

  /** Announces the typed text; creating the option is the consumer's, never this component's. */
  // Guarded for the same reason as commitSelection.
  private addNew(sourceEvent: Event): void {
    if (this.disabled) return;
    sourceEvent.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-combobox-add", {
        detail: { text: this.trimmedSearch },
        bubbles: true,
        composed: true,
      }),
    );
    if (!this.multiple) this.closeAndReturnFocus();
  }

  /** An action row is a command, not a choice: it announces itself and leaves the value alone. */
  // Guarded for the same reason as commitSelection.
  private runAction(optionValue: string, sourceEvent: Event): void {
    if (this.disabled) return;
    sourceEvent.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-combobox-action", {
        detail: { value: optionValue },
        bubbles: true,
        composed: true,
      }),
    );
    this.closeAndReturnFocus();
  }

  private activateOption(option: ComboboxOption, sourceEvent: Event): void {
    if (option.disabled) return;
    if (option.action) this.runAction(option.value, sourceEvent);
    else this.commitSelection(option.value, sourceEvent);
  }

  private closeAndReturnFocus(): void {
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
    this.trigger.focus();
  }

  private onSearchInput(event: Event): void {
    this.searchText = (event.target as HTMLInputElement).value;
    this.activeIndex = this.firstRowIndex;
  }

  /** The list scrolls, so a moved active row has to be brought back into view once Lit has drawn it. */
  private async scrollActiveIntoView(): Promise<void> {
    await this.updateComplete;
    this.scrollRowIntoView(this.activeIndex);
  }

  private scrollRowIntoView(index: number): void {
    if (index < 0) return;
    this.shadowRoot
      ?.getElementById(`${this.listboxId}-${index}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  /** The arrows wrap at both ends; ArrowUp with no row active goes to the last row. An index left
   * past the end of the rows counts as the last row. */
  private async moveActive(key: NavigationKey): Promise<void> {
    const count = this.rowCount;
    const current = Math.min(this.activeIndex, count - 1);
    switch (key) {
      case "ArrowDown":
        this.activeIndex = count === 0 ? -1 : (current + 1) % count;
        break;
      case "ArrowUp":
        this.activeIndex = current <= 0 ? count - 1 : current - 1;
        break;
      case "Home":
        this.activeIndex = count > 0 ? 0 : -1;
        break;
      case "End":
        this.activeIndex = count - 1;
        break;
    }
    await this.scrollActiveIntoView();
  }

  private activateActive(sourceEvent: Event): void {
    const options = this.filteredOptions;
    const option = options[this.activeIndex];
    if (option) this.activateOption(option, sourceEvent);
    else if (this.activeIndex === options.length && this.showAddRow) this.addNew(sourceEvent);
  }

  private async onSearchKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === "Enter") {
      // Whether or not a row is active, so a form's submit-on-Enter never sees it.
      event.preventDefault();
      this.activateActive(event);
      return;
    }
    if (isNavigationKey(event.key)) {
      event.preventDefault();
      await this.moveActive(event.key);
    }
  }

  /** The list's own keys, used when the panel has no search box and the list holds focus. */
  private async onListKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.activateActive(event);
      return;
    }
    if (isNavigationKey(event.key)) {
      event.preventDefault();
      await this.moveActive(event.key);
      return;
    }
    if (isPrintable(event)) {
      event.preventDefault();
      const index = this.typeAhead(event.key, this.filteredOptions, this.activeIndex);
      if (index >= 0) {
        this.activeIndex = index;
        await this.scrollActiveIntoView();
      }
    }
  }

  private typed = "";
  private typedReset: ReturnType<typeof setTimeout> | undefined;

  /** The index of the option the typed text picks: the next one after `from` when the text is one
   * repeated letter, so pressing it again steps on, otherwise the first from `from` on. Action rows
   * are never picked, nor disabled ones with `skipDisabled`, which the closed trigger sets because
   * there the pick is chosen at once. -1 when nothing matches. */
  private typeAhead(
    key: string,
    options: ComboboxOption[],
    from: number,
    skipDisabled = false,
  ): number {
    clearTimeout(this.typedReset);
    this.typedReset = setTimeout(() => (this.typed = ""), TYPE_AHEAD_RESET_MS);
    this.typed += key.toLowerCase();
    const repeated = [...this.typed].every((letter) => letter === this.typed[0]);
    const text = repeated ? this.typed[0]! : this.typed;
    const start = repeated ? from + 1 : Math.max(from, 0);
    for (let step = 0; step < options.length; step += 1) {
      const index = (start + step) % options.length;
      const option = options[index]!;
      if (option.action || (skipDisabled && option.disabled)) continue;
      if (option.label.toLowerCase().startsWith(text)) return index;
    }
    return -1;
  }

  /** The chosen row, else the first. */
  private get chosenIndex(): number {
    const chosen = this.indexOfChosen(this.filteredOptions);
    return chosen >= 0 ? chosen : this.firstRowIndex;
  }

  /** The panel's control that takes the keys: the search box, or the list when there is none. */
  private focusPanelControl(): void {
    (this.searchInput ?? this.listbox).focus();
  }

  private onTriggerKeydown(event: KeyboardEvent): void {
    const open = this.popup.matches(":popover-open");
    if (open && isNavigationKey(event.key)) {
      // Focus can be back on the trigger while the list is open (onPanelFocusout allows it); the
      // panel's control is where the rest of the keys are handled.
      event.preventDefault();
      this.focusPanelControl();
      void this.moveActive(event.key);
      return;
    }
    if (this.disabled || open) {
      this.onKeydown(event);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      // Prevented, or Space also types into the search box this opens.
      event.preventDefault();
      void this.openList("chosen", "");
      return;
    }
    if (!isPrintable(event)) return;
    if (this.hasSearchBox) {
      // Prevented, or the character would also be typed into the search box once it has focus.
      event.preventDefault();
      void this.openList("first", event.key);
      return;
    }
    if (this.multiple) return;
    event.preventDefault();
    // All options, not the filtered ones: the search text left from the last opening is not shown.
    const options = this.options;
    const current = this.indexOfChosen(options);
    const index = this.typeAhead(event.key, options, current, true);
    if (index >= 0 && index !== current) this.commitSelection(options[index]!.value, event);
  }

  /** `active` is which row starts active: none (a click), the chosen one, or the first. */
  private async openList(active: "none" | "chosen" | "first", text: string): Promise<void> {
    this.searchText = text;
    // A click makes no row active, so a reopened panel neither announces a stale row through
    // aria-activedescendant nor makes the first arrow press skip the first option.
    if (active === "none") this.activeIndex = -1;
    else if (active === "chosen") this.activeIndex = this.chosenIndex;
    else this.activeIndex = this.firstRowIndex;
    // Opening synchronously makes its dimensions available before the first paint.
    this.popup.showPopover();
    this.focusPanelControl();
    // The search text changes the rows, so measure the re-rendered list. The await resolves on a
    // microtask, still ahead of the frame this paints.
    await this.updateComplete;
    this.positionPopup();
    // A click shows the chosen row, as a select does, without making it active.
    if (active === "none") this.scrollRowIntoView(this.indexOfChosen(this.filteredOptions));
    else await this.scrollActiveIntoView();
  }

  private async onTriggerClick(event: MouseEvent): Promise<void> {
    event.preventDefault();
    if (this.disabled) return;
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
    } else {
      await this.openList("none", "");
    }
  }

  private positionPopup(): void {
    const anchor = this.trigger.getBoundingClientRect();
    // The width is applied before the panel is measured: it changes how the labels wrap, and so the
    // height the vertical clamp below depends on. An explicit max-content, because the popover's
    // default fit-content would measure against the left written by the previous opening.
    this.popup.style.width = "max-content";
    this.popup.style.minWidth = `${anchor.width}px`;
    this.popup.style.maxWidth = `${innerWidth - 16}px`;
    const popup = this.popup.getBoundingClientRect();
    // Left-aligned with the trigger, pulled left only far enough to keep the panel inside the
    // viewport's 8px right gutter.
    const maxLeft = Math.max(0, innerWidth - popup.width - 8);
    this.popup.style.left = `${Math.max(0, Math.min(anchor.left, maxLeft))}px`;
    this.popup.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
  }

  /** Set while a render runs with focus in the panel. A render can swap the panel's control
   * (`search="auto"` crossing the threshold), and the focus lost with the old one must neither close
   * the list nor stay on a list that no longer handles keys. */
  private keepingPanelFocus = false;

  override willUpdate(changed: PropertyValues<this>): void {
    this.keepingPanelFocus = Boolean(this.popup?.contains(this.shadowRoot!.activeElement));
    if (changed.has("options") && this.activeIndex >= 0) {
      // The active row follows its option by value, and the add row stays active while it is shown;
      // failing that, the chosen row, else the first.
      const previous = this.filter(changed.get("options") as ComboboxOption[])[this.activeIndex];
      const kept = previous
        ? this.filteredOptions.findIndex((option) => option.value === previous.value)
        : this.showAddRow
          ? this.filteredOptions.length
          : -1;
      this.activeIndex = kept >= 0 ? kept : this.chosenIndex;
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (this.keepingPanelFocus) {
      this.keepingPanelFocus = false;
      this.focusPanelControl();
    }
    // Disabling only stops the trigger, so a panel already open stays on screen and usable. Closing
    // it here takes the whole interaction away at once; commitSelection and addNew refuse
    // separately, for the reason stated at commitSelection.
    if (changed.has("disabled") && this.disabled && this.popup?.matches(":popover-open")) {
      this.popup.hidePopover();
    }
  }

  /** Focus taken on mousedown floats a resting label out from under the pointer, so the mouseup
   * lands on the trigger and the browser sends no click at all. The click on the label opens the
   * list, and that moves focus. */
  private onLabelMousedown(event: MouseEvent): void {
    event.preventDefault();
  }

  /** The pointer whose press on the label began while the list was open. One left by a press that
   * never became a click matches nothing later: a real click on the label follows its own press,
   * which replaces it, and a scripted click's pointerId is -1. */
  private labelPressOnOpenList: number | null = null;

  private onLabelPointerdown(event: PointerEvent): void {
    this.labelPressOnOpenList = this.popup.matches(":popover-open") ? event.pointerId : null;
  }

  /** A press on the label while the list is open closes it (the popover's own light dismiss);
   * forwarding the click to the trigger would open it again straight away. The click is matched to
   * its press by pointerId because a touch tap's click can arrive a task after its release. The
   * dismissal leaves focus on the hidden search box or list, which the browser then drops to the
   * page, so focus goes back to the trigger, as a select keeps it. */
  private onLabelClick(event: PointerEvent): void {
    if (event.pointerId !== this.labelPressOnOpenList) return;
    event.preventDefault();
    this.trigger.focus();
  }

  private onToggle(event: ToggleEvent): void {
    this.expanded = event.newState === "open";
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !this.popup.matches(":popover-open")) return;
    if (event.key === "Tab") {
      // Not prevented: with the list closed and focus back on the trigger, the browser's own Tab
      // moves on from there.
      this.closeAndReturnFocus();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.closeAndReturnFocus();
  }

  /** Focus that leaves both the panel and the trigger closes the list, as it would a select. */
  private onPanelFocusout(event: FocusEvent): void {
    if (this.keepingPanelFocus) return;
    const next = event.relatedTarget as Node | null;
    if (next !== null && (this.popup.contains(next) || next === this.trigger)) return;
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
  }

  /** A described option is named by its label alone, so the description is read once, as the
   * description, rather than run into the name. */
  private renderOptionText(option: ComboboxOption, rowId: string) {
    if (!option.description) {
      return html`<span class="option-label">${option.label}</span>`;
    }
    return html`<span class="option-text"
      ><span class="option-label" id=${`${rowId}-label`}>${option.label}</span
      ><span class="option-description" id=${`${rowId}-description`}
        >${option.description}</span
      ></span
    >`;
  }

  private renderOption(option: ComboboxOption, index: number) {
    const selected = this.isSelected(option);
    const rowId = `${this.listboxId}-${index}`;
    const described = Boolean(option.description);
    return html`
      <li
        id=${rowId}
        class=${classMap({ option: true, active: index === this.activeIndex, primary: Boolean(option.primary) })}
        role="option"
        aria-selected=${selected}
        aria-disabled=${option.disabled ? "true" : nothing}
        aria-labelledby=${described ? `${rowId}-label` : nothing}
        aria-describedby=${described ? `${rowId}-description` : nothing}
        @click=${(event: MouseEvent) => {
          this.activeIndex = index;
          this.activateOption(option, event);
        }}
      >
        ${
          this.multiple && !option.action
            ? html`<span class=${selected ? "check checked" : "check"} aria-hidden="true"></span>`
            : nothing
        }
        ${
          option.icon
            ? html`<wt-icon class="icon" name=${option.icon} aria-hidden="true"></wt-icon>`
            : nothing
        }
        ${this.renderOptionText(option, rowId)}
        ${
          selected && !this.multiple
            ? html`<wt-icon class="tick" name="check" aria-hidden="true"></wt-icon>`
            : nothing
        }
      </li>
    `;
  }

  /** Consecutive options sharing a `group` go inside one `role="group"` named by its heading. Row
   * ids and `activeIndex` count options only, so a heading is never a row. */
  private renderRows() {
    const options = this.filteredOptions;
    const rows = [];
    let index = 0;
    while (index < options.length) {
      const group = options[index]!.group;
      if (!group) {
        rows.push(this.renderOption(options[index]!, index));
        index += 1;
        continue;
      }
      const first = index;
      while (index < options.length && options[index]!.group === group) index += 1;
      const headingId = `${this.listboxId}-group-${first}`;
      rows.push(html`
        <li role="presentation">
          <div role="group" aria-labelledby=${headingId}>
            <div id=${headingId} class="group-heading">${group}</div>
            <ul class="group-rows" role="none">
              ${options.slice(first, index).map((option, offset) => this.renderOption(option, first + offset))}
            </ul>
          </div>
        </li>
      `);
    }
    return rows;
  }

  override render() {
    const triggerId = this.name || this.generatedTriggerId;
    const hasError = this.error !== "";
    const hasHint = this.hint !== "";
    const invalid = this.invalid || hasError;
    const describedBy = [...(hasHint ? [this.hintId] : []), ...(hasError ? [this.errorId] : [])];
    const showLabel = this.label !== "" && !this.hideLabel;
    const selectedText = this.selectedText;
    const shownText = selectedText || this.placeholder || this.hint;
    const triggerName = this.hideLabel && this.label ? this.label : !this.label && this.ariaLabel;
    return html`
      <div class="row">
        <div
          class="field"
          part="field"
          data-label=${fieldLabelState({
            value: selectedText,
            hint: this.hint,
            placeholder: this.placeholder,
          })}
          ?data-invalid=${invalid}
          ?data-disabled=${this.disabled}
          ?data-compact=${!showLabel}
          ?data-open=${this.expanded}
        >
          ${
            showLabel
              ? html`<label
                  class="field-label"
                  id=${this.labelId}
                  for=${triggerId}
                  @pointerdown=${this.onLabelPointerdown}
                  @mousedown=${this.onLabelMousedown}
                  @click=${this.onLabelClick}
                  ><span class="field-label-text">${this.label}</span>${
                    this.required
                      ? html`<span class="required" data-required aria-hidden="true">*</span>`
                      : nothing
                  }</label
                >`
              : nothing
          }
          <button
            type="button"
            id=${triggerId}
            name=${this.name || nothing}
            class="field-control trigger"
            aria-haspopup="listbox"
            aria-expanded=${this.expanded}
            aria-labelledby=${showLabel ? this.labelId : nothing}
            aria-label=${triggerName || nothing}
            aria-invalid=${invalid}
            aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
            popovertarget="panel"
            ?disabled=${this.disabled}
            @click=${this.onTriggerClick}
            @keydown=${this.onTriggerKeydown}
          >
            <span class=${selectedText ? "value" : "value placeholder"}>${shownText}</span>
            ${
              this.stableWidth
                ? this.options
                    .filter((option) => !option.action)
                    .map(
                      (option) =>
                        html`<span class="width-option" aria-hidden="true">${option.label}</span>`,
                    )
                : nothing
            }
            <wt-icon class="chevron" name="chevron-down"></wt-icon>
          </button>
        </div>
        <slot name="help"></slot>
      </div>
      <div
        id="panel"
        popover
        @toggle=${this.onToggle}
        @keydown=${this.onKeydown}
        @focusout=${this.onPanelFocusout}
      >
        ${
          this.hasSearchBox
            ? html`<div class="search-area">
                <input
                  class="search"
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-required=${this.required}
                  placeholder=${this.searchPlaceholder}
                  aria-label=${this.label || this.ariaLabel || this.searchPlaceholder}
                  aria-controls=${this.listboxId}
                  aria-activedescendant=${
                    this.activeIndex >= 0 ? `${this.listboxId}-${this.activeIndex}` : nothing
                  }
                  .value=${this.searchText}
                  @input=${this.onSearchInput}
                  @keydown=${this.onSearchKeydown}
                />
              </div>`
            : nothing
        }
        <ul
          id=${this.listboxId}
          class="list"
          role="listbox"
          aria-label=${this.label || this.ariaLabel || nothing}
          aria-multiselectable=${this.multiple}
          tabindex=${this.hasSearchBox ? nothing : "-1"}
          aria-activedescendant=${
            !this.hasSearchBox && this.activeIndex >= 0
              ? `${this.listboxId}-${this.activeIndex}`
              : nothing
          }
          @keydown=${this.hasSearchBox ? nothing : this.onListKeydown}
        >
          ${this.renderRows()}
          ${
            this.showAddRow
              ? html`
                  <li
                    id=${`${this.listboxId}-${this.filteredOptions.length}`}
                    class=${
                      this.filteredOptions.length === this.activeIndex
                        ? "option add active"
                        : "option add"
                    }
                    role="option"
                    aria-selected="false"
                    @click=${(event: MouseEvent) => {
                      this.activeIndex = this.filteredOptions.length;
                      this.addNew(event);
                    }}
                  >
                    ${this.addLabel(this.trimmedSearch)}
                  </li>
                `
              : nothing
          }
        </ul>
        ${
          // Outside the listbox, not a row inside it: a role="presentation" child is not one of the
          // children role="listbox" requires, which axe reports as aria-required-children.
          this.filteredOptions.length === 0 && !this.showAddRow
            ? html`<div class="empty">${this.noResultsLabel}</div>`
            : nothing
        }
      </div>
      ${hasHint ? html`<p id=${this.hintId} class="hint" data-hint>${this.hint}</p>` : nothing}
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-combobox": WtCombobox;
  }
}
