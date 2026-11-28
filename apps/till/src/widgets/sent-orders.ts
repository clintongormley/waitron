import type { PartyAllergySnapshot } from "@waitron/module";
import { allergyMark, allergyMarkStyles } from "./party-allergy-mark.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, Gestures, preventTouchContextMenu, visuallyHiddenStyles } from "@waitron/ui";
import { scrollAncestors } from "@waitron/ui/src/reorder-table.js";
import { decimal, formatMoney, type BillSetMenuState } from "@waitron/shared";
import type {
  CurrentOrderRow,
  CurrentOrders,
  ReleaseReminder,
  TabLine,
} from "../api/kitchen-api.js";
import { clockTime, currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { type SentSlice, byFiringOrder } from "../state/sent-panel.js";
import { sentPortionsApart, sentRowPortionKey } from "../state/portion-groups.js";
import { type SentRow, type SentSection, sentSections } from "../state/sent-sections.js";
import { sentMenuDishes } from "../state/set-menus.js";
import { setMenuTag, setMenuTagStyles } from "./set-menu-presentation.js";
import { reminderDueAt } from "../state/release-reminder.js";
import { groupName } from "./group-name.js";
import { nutritionIcons, nutritionIconStyles } from "./nutrition-icons.js";
import { nutritionDietLabels } from "../diet-labels.js";
import { sentCompanion, sentRow, sentRowStyles, sentStateWords } from "./sent-row.js";
import {
  OpenSentRow,
  type SentServe,
  sentOpenControls,
  sentOpenStyles,
  sentRowDrawn,
} from "./sent-row-open.js";
import { revealOpenBox, scrollAreaOf } from "./row-text.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-course-heading.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "./fired-ago.js";

export interface SentOrdersSnapshot {
  scope: string;
  billId: string;
  current: CurrentOrders;
}
export interface SentLineInfo {
  lineId: string;
  workingOrderId: string;
  kind: SentSlice["kind"];
  /** Present when the row shows several identical portions: every member, by line number. */
  lineIds?: string[];
  /** Present when the row joins served portions to what is left: the served ones, by line number. */
  servedLineIds?: string[];
}
interface HeldOrder {
  scope: string;
  billId: string;
  revision: number;
  ids: string[];
}
export interface SentReorderDetail {
  expected: HeldOrder;
  heldGroupIds: string[];
}
interface SentModel {
  sections: SentSection[];
  reminder: ReleaseReminder | null;
  courseNames: ReadonlyMap<string, string>;
  /** Each slice the sections list, by line id and kind; the first one listed. */
  slices: ReadonlyMap<string, SentSlice>;
}
const sliceId = (slice: SentSlice) => JSON.stringify([slice.row.lineId, slice.kind]);
const isHeld = (section: SentSection) => section.title.state === "held";

/** The slices a row's information and hold name: what is left of it, or else all of it. */
const infoMembers = (row: SentRow) => (row.left.length > 0 ? row.left : row.slices);
/** The served slices a row joins to what is left of it, which its information names apart. */
const servedBeside = (row: SentRow) =>
  row.left.length > 0 ? row.slices.filter((slice) => slice.kind === "served") : [];
const firedLeft = (rows: readonly SentRow[]) =>
  rows.flatMap((row) => row.left).filter((slice) => slice.kind === "fired");
const servable = (rows: readonly SentRow[]) =>
  firedLeft(rows).filter((slice) => slice.row.released);

@customElement("till-sent-orders")
export class TillSentOrders extends LitElement {
  @property({ attribute: false }) allergy: PartyAllergySnapshot | null = null;
  /** The bill's lines, which say which rows are identical portions; none known groups none. */
  @property({ attribute: false }) lines: readonly TabLine[] = [];
  @property({ attribute: false }) setMenus: BillSetMenuState | null = null;
  #setMenuDishes = new Map<string, { setMenuId: string; price: string }>();

  static override styles = [
    baseStyles,
    nutritionIconStyles,
    setMenuTagStyles,
    allergyMarkStyles,
    sentRowStyles,
    sentOpenStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        min-width: 0;
      }
      [data-sent-panel] {
        padding-block-end: var(--wt-space-3);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .group[data-dragging] {
        outline: var(--wt-focus-ring);
      }
      .section-title[data-group-drag] {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        touch-action: none;
        user-select: none;
      }
      [data-serve-all]:not([disabled]) {
        --wt-action-text: var(--wt-color-primary-text);
      }
      /* A word, not a block: its tap area spills into the heading's own padding (or, on a line of
         its own, the equal gap above it), so the heading stays as tall as its words. Padding equal
         to each spill keeps the word on the mark's line. */
      [data-serve-all] {
        --wt-action-font-size: var(--wt-font-size-md);
        --wt-action-weight: var(--wt-font-weight-bold);
        --wt-action-border-color: transparent;
        --wt-action-padding: var(--wt-space-3) var(--wt-space-2)
          var(--wt-course-heading-padding-bottom);
        margin-block: calc(-1 * var(--wt-space-3))
          calc(-1 * var(--wt-course-heading-padding-bottom));
      }
      .reminder {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
        padding: var(--wt-space-2);
        background: var(--wt-color-surface-sunken);
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property() scope = "";
  @property() billId = "";
  @property({ attribute: false }) snapshot: SentOrdersSnapshot | null = null;
  @property({ attribute: false }) billLabels: ReadonlyMap<string, string> = new Map();
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) now?: number;
  #opening = "";
  readonly #open = new OpenSentRow();
  #pressedModel: SentModel | null = null;
  #pressedNow?: number;
  #gestures?: Gestures;
  #pressed?: {
    row: SentRow;
    scope: string;
    billId: string;
    target: EventTarget;
  };
  #suppressClick = false;
  /** A serve sent from the keyboard on the open row's focused button: focus stays in that row, on
   * a Serve of the same kind where there is one, until the row draws other than as it was pressed,
   * a pointer presses anywhere, or focus moves out of the row. */
  #focusAfterServe?: { opening: string; kind: SentServe["kind"]; drawn: string };
  @state() private dragging: string | null = null;
  #headingPress?: { id: string; target: EventTarget; expected: HeldOrder };
  readonly #startPointer = () => this.#releaseHeading();
  readonly #endFocusHold = () => {
    this.#focusAfterServe = undefined;
  };
  #focusing = false;
  readonly #focusMoved = () => {
    if (!this.#focusing) this.#focusAfterServe = undefined;
  };
  /** Only a move to another element ends the hold; focus dropped to the page is what it mends. */
  readonly #focusLeft = (event: Event) => {
    const to = (event as FocusEvent).relatedTarget;
    if (to instanceof Node && this.renderRoot.querySelector("li[data-open]")?.contains(to) !== true)
      this.#focusAfterServe = undefined;
  };
  #reminderTimer?: ReturnType<typeof setTimeout>;
  #ageTimer?: ReturnType<typeof setTimeout>;
  #built?: { inputs: readonly unknown[]; model: SentModel | null };

  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback(): void {
    this.#opening = "";
    super.connectedCallback();
    this.addEventListener("pointerdown", this.#startPointer, true);
    document.addEventListener("pointerdown", this.#endFocusHold, true);
    // On the shadow root: a move between two of its controls does not reach the host.
    this.renderRoot.addEventListener("focusin", this.#focusMoved);
    this.renderRoot.addEventListener("focusout", this.#focusLeft);
    this.#gestures = new Gestures(this, {
      holdStart: ({ target }) => {
        if (target === this.#pressed?.target) this.#suppressClick = true;
      },
      holdDrag: ({ target }) => {
        if (target === this.#headingPress?.target && !this.busy)
          this.dragging = this.#headingPress.id;
      },
      longPress: ({ target }) => {
        const press = this.#pressed;
        if (
          press &&
          target === press.target &&
          press.scope === this.scope &&
          press.billId === this.billId
        )
          this.#info(press.row);
        this.#releaseHeading();
      },
      pan: ({ dy }) => {
        if (this.#headingPress) this.#scrollHeading(dy);
        this.#suppressClick = true;
        this.#releasePointer();
      },
      holdDrop: ({ x, y }) => {
        this.#dropHeading(x, y);
        this.#releasePointer();
      },
      cancel: () => {
        this.#suppressClick = true;
        this.#releaseHeading();
        this.#releasePointer();
      },
    });
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    this.removeEventListener("pointerdown", this.#startPointer, true);
    document.removeEventListener("pointerdown", this.#endFocusHold, true);
    this.renderRoot.removeEventListener("focusin", this.#focusMoved);
    this.renderRoot.removeEventListener("focusout", this.#focusLeft);
    this.#focusAfterServe = undefined;
    this.#gestures?.disconnect();
    this.#gestures = undefined;
    this.#pressed = undefined;
    this.#pressedModel = null;
    this.#pressedNow = undefined;
    this.#releaseHeading();
    clearTimeout(this.#reminderTimer);
    clearTimeout(this.#ageTimer);
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: ReadonlyMap<PropertyKey, unknown>): void {
    if (changed.has("setMenus")) this.#setMenuDishes = sentMenuDishes(this.setMenus);
    const opening = JSON.stringify([this.scope, this.billId]);
    if (opening !== this.#opening) {
      this.#opening = opening;
      this.#pressedModel = null;
      this.#pressedNow = undefined;
      this.#pressed = undefined;
      this.#releaseHeading();
    }
    this.#open.keep(
      opening,
      (this.#model()?.sections ?? []).flatMap((section) => section.rows),
    );
  }
  protected override updated(): void {
    this.#holdFocus();
    clearTimeout(this.#reminderTimer);
    clearTimeout(this.#ageTimer);
    if (this.now !== undefined) return;
    if (
      this.#model()?.sections.some((section) => section.rows.some((row) => row.state === "ready"))
    )
      this.#ageTimer = setTimeout(() => this.requestUpdate(), 20_000);
    const delay = reminderDueAt(this.#current()?.reminder) - Date.now();
    if (Number.isFinite(delay) && delay > 0)
      this.#reminderTimer = setTimeout(() => this.requestUpdate(), Math.min(delay, 2_147_483_647));
  }
  #current(): CurrentOrders | null {
    return this.snapshot?.scope === this.scope && this.snapshot.billId === this.billId
      ? this.snapshot.current
      : null;
  }
  /** Keyed on the snapshot's fields, not the snapshot itself: the order screen wraps the same
   * read in a new snapshot on every draw. */
  #model(): SentModel | null {
    const inputs = [
      this.snapshot?.current,
      this.snapshot?.scope,
      this.snapshot?.billId,
      this.scope,
      this.billId,
      this.lines,
      this.allergy,
      this.#setMenuDishes,
    ];
    const built = this.#built;
    if (built?.inputs.every((input, index) => input === inputs[index])) return built.model;
    const model = this.#build();
    this.#built = { inputs, model };
    return model;
  }
  #build(): SentModel | null {
    const current = this.#current();
    if (current === null) return null;
    const apart = sentPortionsApart(this.allergy, this.#setMenuDishes);
    const sections = sentSections(current, this.billId, (slice) =>
      sentRowPortionKey(slice, this.lines, apart(slice)),
    );
    const courseNames = new Map<string, string>();
    for (const course of current.retainedCourses)
      if (!courseNames.has(course.id)) courseNames.set(course.id, course.name);
    const slices = new Map<string, SentSlice>();
    for (const section of sections)
      for (const row of section.rows)
        for (const slice of row.slices)
          if (!slices.has(sliceId(slice))) slices.set(sliceId(slice), slice);
    return { sections, reminder: current.reminder, courseNames, slices };
  }
  #dispatch(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #heldOrder(): HeldOrder | undefined {
    const current = this.#current();
    if (current === null) return;
    return {
      scope: this.scope,
      billId: this.billId,
      revision: current.revision,
      ids: current.groups
        .filter((group) => group.state === "held")
        .sort(byFiringOrder)
        .map((group) => group.id),
    };
  }
  #reorder(expected: HeldOrder, groupId: string, to: number): void {
    if (!this.isConnected || this.busy) return;
    const current = this.#heldOrder();
    if (
      current === undefined ||
      current.scope !== expected.scope ||
      current.billId !== expected.billId ||
      current.revision !== expected.revision ||
      current.ids.length !== expected.ids.length ||
      current.ids.some((id, index) => id !== expected.ids[index])
    )
      return;
    const from = expected.ids.indexOf(groupId);
    if (from < 0 || to < 0 || to >= expected.ids.length || from === to) return;
    const heldGroupIds = [...expected.ids];
    heldGroupIds.splice(from, 1);
    heldGroupIds.splice(to, 0, groupId);
    this.#dispatch("reorder-held", { expected, heldGroupIds } satisfies SentReorderDetail);
  }
  #pressHeading(id: string, event: PointerEvent): void {
    const expected = this.#heldOrder();
    const target = event.composedPath()[0];
    this.#pressed = undefined;
    this.#releaseHeading();
    if (expected !== undefined && target !== undefined)
      this.#headingPress = { id, target, expected };
  }
  #scrollHeading(dy: number): void {
    const parents = scrollAncestors(this).slice(1);
    for (const target of [...parents, document.scrollingElement]) {
      if (!(target instanceof HTMLElement)) continue;
      if (
        target !== document.scrollingElement &&
        !/auto|scroll/.test(getComputedStyle(target).overflowY)
      )
        continue;
      const before = target.scrollTop;
      target.scrollTop -= dy;
      if (target.scrollTop !== before) return;
    }
  }
  #releaseHeading(): void {
    this.dragging = null;
    this.#headingPress = undefined;
  }
  #dropHeading(x: number, y: number): void {
    const press = this.#headingPress;
    const hit = this.shadowRoot?.elementFromPoint(x, y);
    const target =
      hit?.closest<HTMLElement>("[data-group-drag]") ??
      hit?.closest("wt-course-heading")?.querySelector<HTMLElement>("[data-group-drag]");
    if (press && this.dragging === press.id && target) {
      const id = target.dataset.groupDrag!;
      const from = press.expected.ids.indexOf(press.id);
      const index = press.expected.ids.indexOf(id);
      const rect = target.getBoundingClientRect();
      const gap = index + (y >= rect.y + rect.height / 2 ? 1 : 0);
      if (index >= 0) this.#reorder(press.expected, press.id, gap - (from < gap ? 1 : 0));
    }
    this.#releaseHeading();
  }
  /** `groupId` names the section a heading's Serve all belongs to (null: the ungrouped one), whose
   * live rows must still hold everything it showed. */
  #serve(displayed: readonly { lineId: string; quantity: string }[], groupId: string | null): void {
    if (!this.isConnected || this.busy || displayed.length === 0) return;
    const sections = (this.#model()?.sections ?? []).filter(
      (section) => (section.group?.id ?? null) === groupId,
    );
    const current = new Map(
      servable(sections.flatMap((section) => section.rows)).map((slice) => [
        slice.row.lineId,
        slice.quantity,
      ]),
    );
    if (displayed.some((item) => current.get(item.lineId) !== item.quantity)) return;
    this.#dispatch("serve-lines", { items: displayed.map((item) => ({ ...item })) });
    this.#releasePointer();
  }
  /** Whether `event` came from the open row's box as it stands, for the bill and party now shown,
   * `row` having been drawn open under `opening`. */
  #fromOpenRow(row: SentRow, opening: string, event: Event): boolean {
    const now = JSON.stringify([this.scope, this.billId]);
    const button = event.currentTarget;
    return (
      opening === now &&
      this.#open.is(now, row.id) &&
      button instanceof Element &&
      this.renderRoot.querySelector("li[data-open]")?.contains(button) === true
    );
  }
  /** Sends `serve` only while every portion of `row` stands in the live list as `drawn`. */
  #serveRow(row: SentRow, serve: SentServe, drawn: string, opening: string, event: Event): void {
    if (!this.isConnected || this.busy || !this.#fromOpenRow(row, opening, event)) return;
    const live = this.#model()
      ?.sections.flatMap((section) => section.rows)
      .find((each) => each.id === row.id);
    if (live === undefined || sentRowDrawn(live, this.lines) !== drawn) return;
    this.#dispatch("serve-lines", { items: serve.items.map((item) => ({ ...item })) });
    const fromKeys = (event as MouseEvent).detail === 0;
    if (fromKeys && (this.renderRoot as ShadowRoot).activeElement === event.currentTarget)
      this.#focusAfterServe = { opening, kind: serve.kind, drawn };
    this.#releasePointer();
  }
  /** While the box's buttons are disabled, focus waits on the row's own button; Chromium would
   * otherwise drop it to the page. */
  #holdFocus(): void {
    const hold = this.#focusAfterServe;
    if (hold === undefined) return;
    const box = this.renderRoot.querySelector("li[data-open]");
    const at = (this.renderRoot as ShadowRoot).activeElement;
    const page = document.activeElement;
    const lost = at === null && (page === null || page === document.body);
    if (box === null || hold.opening !== this.#opening || (!lost && !box.contains(at))) {
      this.#focusAfterServe = undefined;
      return;
    }
    const usable = (selector: string) =>
      [...box.querySelectorAll<HTMLButtonElement>(selector)].filter((button) => !button.disabled);
    const serves = usable("[data-sent-serve]");
    const target =
      serves.find((button) => button.dataset.sentServe === hold.kind) ??
      serves[0] ??
      usable("[data-sent-details]")[0] ??
      box.querySelector<HTMLElement>("[data-sent-row]");
    if (at === null || (at as HTMLButtonElement).disabled || at.matches("[data-sent-row]")) {
      this.#focusing = true;
      target?.focus();
      this.#focusing = false;
    }
    const live = this.#model()
      ?.sections.flatMap((section) => section.rows)
      .find((row) => this.#open.is(this.#opening, row.id));
    if (!this.busy && (live === undefined || sentRowDrawn(live, this.lines) !== hold.drawn))
      this.#focusAfterServe = undefined;
  }
  #info(row: SentRow): void {
    if (!this.isConnected || this.busy) return;
    const members = infoMembers(row);
    const served = servedBeside(row);
    const slices = this.#model()?.slices;
    const found = [...members, ...served].map((member) => slices?.get(sliceId(member)));
    const slice = found[0];
    if (slice && found.every((each) => each !== undefined))
      this.#dispatch("sent-line-info", {
        lineId: slice.row.lineId,
        workingOrderId: slice.row.workingOrderId,
        kind: slice.kind,
        ...(members.length > 1 ? { lineIds: members.map((member) => member.row.lineId) } : {}),
        ...(served.length > 0 ? { servedLineIds: served.map((member) => member.row.lineId) } : {}),
      } satisfies SentLineInfo);
    this.#releasePointer();
  }
  #groupCommand(name: string, groupId: string): void {
    if (!this.isConnected || this.busy) return;
    if (
      !this.#model()?.sections.some((section) => isHeld(section) && section.group?.id === groupId)
    )
      return;
    if (name !== "fire-group" && this.#current()?.reminder?.groupId !== groupId) return;
    this.#dispatch(name, { groupId, ...(name === "snooze-group" ? { minutes: 5 } : {}) });
  }
  #releasePointer(): void {
    this.#pressedModel = null;
    this.#pressedNow = undefined;
    this.requestUpdate();
  }
  #pressLine(row: SentRow, event: PointerEvent): void {
    const slice = row.lead;
    this.#releaseHeading();
    this.#suppressClick = false;
    if (this.busy) return;
    const target = event.composedPath()[0];
    if (target === undefined) return;
    this.#pressed = { row, scope: this.scope, billId: this.billId, target };
    if (slice.kind === "fired") {
      this.#pressedModel = this.#model();
      this.#pressedNow = this.now ?? Date.now();
    }
  }
  #clickRow(row: SentRow, event: MouseEvent): void {
    if (event.detail === 0 || !this.#suppressClick) this.#open.toggle(this.#opening, row);
    this.#releasePointer();
    if (this.#open.is(this.#opening, row.id)) void this.revealOpen();
  }
  /** The opened row's box, once drawn, above the bar at the foot of the area the list scrolls in;
   * the screen sets the clearance on its `opened-row` part, and calls this again once it has
   * measured a new bar. */
  async revealOpen(): Promise<void> {
    await this.updateComplete;
    const box = this.renderRoot.querySelector("li[data-open]");
    if (box === null) return;
    revealOpenBox(box, scrollAreaOf(this));
  }
  #displayNow(): number {
    return this.#heldNow() ?? Date.now();
  }
  /** The time while a press or the page holds it still; otherwise each fired age keeps its own. */
  #heldNow(): number | undefined {
    return this.#pressedNow ?? this.now;
  }
  #money(value: string): string {
    return formatMoney(decimal(value), currentLocale());
  }
  #marks(row: CurrentOrderRow): TemplateResult {
    return html`${nutritionIcons(row.nutrition?.allergens, nutritionDietLabels(undefined, row.nutrition?.dietaryDeclarations))}${setMenuTag(this.#setMenuDishes.get(row.lineId)?.price)}${allergyMark(this.allergy, { kind: "working", id: row.lineId })}`;
  }
  #courseNames(section: SentSection): string {
    const names = this.#model()?.courseNames;
    return section.title.courseIds.map((id) => names?.get(id) ?? t("table.course_none")).join(", ");
  }
  #title(section: SentSection): TemplateResult {
    const names = this.#courseNames(section);
    const { state, firedAt } = section.title;
    return html`${names === "" ? nothing : `${names}\u00a0· `}${sentStateWords(state, firedAt, this.#heldNow())}`;
  }
  #heldActions(section: SentSection, expected: HeldOrder): TemplateResult {
    const group = section.group!;
    const index = expected.ids.indexOf(group.id);
    return html`${
        expected.ids.length < 2
          ? nothing
          : keyed(
              JSON.stringify(expected),
              html`<wt-row-actions
                slot="end"
                data-group-more=${group.id}
                label=${`${t("shell.more")} · ${groupName(group)}`}
                align="end"
              >
                ${
                  index > 0
                    ? html`<wt-button
                        icon="menu-up"
                        data-group-earlier
                        ?disabled=${this.busy}
                        @click=${() => this.#reorder(expected, group.id, index - 1)}
                        >${t("table.group_earlier")}</wt-button
                      >`
                    : nothing
                }
                ${
                  index < expected.ids.length - 1
                    ? html`<wt-button
                        icon="menu-down"
                        data-group-later
                        ?disabled=${this.busy}
                        @click=${() => this.#reorder(expected, group.id, index + 1)}
                        >${t("table.group_later")}</wt-button
                      >`
                    : nothing
                }
              </wt-row-actions>`,
            )
      }
      <wt-button
        slot="end"
        variant="secondary"
        data-group-fire=${group.id}
        ?disabled=${this.busy}
        aria-label=${`${t("table.group_fire")} · ${groupName(group)}`}
        @click=${() => this.#groupCommand("fire-group", group.id)}
        >${t("table.group_fire")}</wt-button
      >`;
  }
  #serveAll(section: SentSection, released: readonly SentSlice[]): TemplateResult {
    const off = this.busy || released.length === 0;
    const groupId = section.group?.id ?? null;
    return html`<wt-button
      slot="end"
      data-serve-all
      variant="ghost"
      ?disabled=${off}
      aria-label=${section.group === null ? nothing : `${t("table.serve_group")} · ${groupName(section.group)}`}
      @click=${() =>
        this.#serve(
          released.map((slice) => ({ lineId: slice.row.lineId, quantity: slice.quantity })),
          groupId,
        )}
      >${t("table.serve_group")}</wt-button
    >`;
  }
  #section(section: SentSection, expected: HeldOrder): TemplateResult {
    const id = section.group?.id ?? "";
    const held = isHeld(section);
    const released = servable(section.rows);
    const now = this.#displayNow();
    const opening = this.#opening;
    return html`<section
      class="group"
      data-sent-section=${id}
      data-held-group=${held ? id : nothing}
      ?data-dragging=${held && this.dragging === id}
    >
      <wt-course-heading level="3" mark=${held ? "" : "sent"} mark-label=${t("table.sent_title")}>
        ${
          held
            ? html`<span
                class="section-title"
                data-section-title
                data-group-drag=${id}
                @contextmenu=${preventTouchContextMenu}
                @pointerdown=${(event: PointerEvent) => this.#pressHeading(id, event)}
                >${this.#title(section)}</span
              >`
            : html`<span class="section-title" data-section-title>${this.#title(section)}</span>`
        }
        ${held ? this.#heldActions(section, expected) : nothing}
        ${!held || released.length > 0 ? this.#serveAll(section, released) : nothing}
      </wt-course-heading>
      <ul
        @pointercancel=${() => this.#releasePointer()}
        @pointerleave=${() => this.#releasePointer()}
      >
        ${repeat(
          section.rows,
          (row) => row.id,
          (row) =>
            sentRow({
              row,
              heading: section.title.state,
              now,
              heldNow: this.#heldNow(),
              price: this.#money(row.amount),
              marks: this.#marks(row.lead.row),
              press: (event) => this.#pressLine(row, event),
              open: (event) => this.#clickRow(row, event),
              opened: this.#open.is(this.#opening, row.id)
                ? this.#openControls(row, opening)
                : nothing,
            }),
        )}
        ${section.companions.map((row) =>
          sentCompanion(
            row,
            this.billLabels.get(row.workingOrderId) ?? t("table.sent_other_bill"),
            this.#marks(row),
          ),
        )}
      </ul>
    </section>`;
  }
  #openControls(row: SentRow, opening: string): TemplateResult {
    const drawn = sentRowDrawn(row, this.lines);
    return sentOpenControls({
      row,
      busy: this.busy,
      serve: (serve, event) => this.#serveRow(row, serve, drawn, opening, event),
      details: (event) => {
        if (this.#fromOpenRow(row, opening, event)) this.#info(row);
      },
    });
  }
  #reminder(model: SentModel): TemplateResult | typeof nothing {
    const reminder = model.reminder;
    const section = model.sections.find(
      (section) => isHeld(section) && section.group?.id === reminder?.groupId,
    );
    if (!section || reminderDueAt(reminder) === Number.POSITIVE_INFINITY) return nothing;
    const due = reminderDueAt(reminder) <= this.#displayNow();
    const group = section.group!;
    const names = this.#courseNames(section);
    return html`<div class="reminder" data-group-reminder=${due ? "due" : "waiting"}>
      <span
        >${[groupName(group), ...(names === "" ? [] : [names])].join(" · ")} ·
        ${due ? `${t("table.reminder_due")} · ${clockTime(reminderDueAt(reminder))}` : t("table.reminder_at").replace("{time}", clockTime(reminderDueAt(reminder)))}</span
      >
      ${
        group.remindAt === null
          ? nothing
          : html`<wt-button
              variant="secondary"
              data-reminder-unsnooze
              aria-label=${`${t("table.reminder_clear_snooze")} · ${groupName(group)}`}
              ?disabled=${this.busy}
              @click=${() => this.#groupCommand("unsnooze-group", group.id)}
              >${t("table.reminder_clear_snooze")}</wt-button
            >`
      }
      ${
        !due
          ? nothing
          : html`<wt-button
                variant="secondary"
                data-reminder-snooze
                ?disabled=${this.busy}
                @click=${() => this.#groupCommand("snooze-group", group.id)}
                >${t("table.reminder_snooze").replace("{n}", "5")}</wt-button
              >
              <wt-button
                variant=${this.busy ? "secondary" : "primary"}
                data-reminder-fire
                ?disabled=${this.busy}
                @click=${() => this.#groupCommand("fire-group", group.id)}
                >${t("table.group_fire")} · ${groupName(group)}</wt-button
              >`
      }
    </div>`;
  }
  protected override render(): TemplateResult | typeof nothing {
    const live = this.#model();
    const model = live === null ? null : (this.#pressedModel ?? live);
    if (!model || model.sections.length === 0) return nothing;
    const expected = this.#heldOrder()!;
    return html`<section data-sent-panel>
      <h2 class="visually-hidden">${t("table.sent_title")}</h2>
      ${this.#reminder(model)}
      ${repeat(
        model.sections,
        (section) => section.group?.id ?? null,
        (section) => this.#section(section, expected),
      )}
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-sent-orders": TillSentOrders;
  }
}
