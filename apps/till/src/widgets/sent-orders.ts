import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, Gestures } from "@waitron/ui";
import { scrollAncestors } from "@waitron/ui/src/reorder-table.js";
import { addDecimal, decimal, formatMoney } from "@waitron/shared";
import type { CurrentOrderRow, CurrentOrders } from "../api/client.js";
import { clockTime, currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { sentPanel, type SentPanel, type SentSlice } from "../state/sent-panel.js";
import { reminderDueAt } from "../state/release-reminder.js";
import { trimQuantity } from "./dish-format.js";
import { groupName } from "./group-name.js";
import { nutritionDietLabels, nutritionIcons, nutritionIconStyles } from "./nutrition-icons.js";
import "@waitron/ui/src/components/wt-button.js";
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

@customElement("till-sent-orders")
export class TillSentOrders extends LitElement {
  static override styles = [
    baseStyles,
    nutritionIconStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        min-width: 0;
      }
      .panel {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow: hidden;
      }
      .attention {
        border-color: var(--wt-color-warning);
      }
      .attention:not(.expanded) {
        animation: attention 3s ease-in-out infinite;
      }
      @keyframes attention {
        50% {
          outline: 1px solid var(--wt-color-warning);
          outline-offset: 1px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .attention:not(.expanded) {
          animation: none;
        }
      }
      button {
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-3);
        background: var(--wt-color-surface);
        border: 0;
        text-align: start;
      }
      .summary {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }
      .content {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2);
      }
      .heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
      }
      h2,
      h3,
      h4,
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h2,
      h3,
      h4 {
        font-size: var(--wt-font-size-md);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        border-bottom: 1px solid var(--wt-color-border);
      }
      .dish {
        display: flex;
        flex: 1;
        min-width: 0;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
      }
      button.dish {
        width: 100%;
        background: transparent;
        border: 0;
        text-align: start;
      }
      button:focus-visible {
        outline: 2px solid var(--wt-color-focus);
        outline-offset: -2px;
      }
      button:disabled {
        cursor: default;
      }
      .what {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .extra,
      .note,
      .status,
      .bill {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .amount {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .companion {
        background: var(--wt-color-surface-sunken);
        color: var(--wt-color-text);
      }
      .companion .bill {
        color: inherit;
      }
      .group {
        padding-block: var(--wt-space-2);
      }
      .group[data-dragging] {
        outline: var(--wt-focus-ring);
      }
      .group-title {
        flex: 1;
        display: flex;
        align-items: center;
        min-width: 0;
        min-height: var(--wt-tap-min);
        touch-action: none;
        user-select: none;
      }
      .reminder {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
        padding: var(--wt-space-2);
        background: var(--wt-color-surface-sunken);
      }
      .mark {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];
  @property() scope = "";
  @property() billId = "";
  @property({ attribute: false }) snapshot: SentOrdersSnapshot | null = null;
  @property({ attribute: false }) billLabels: ReadonlyMap<string, string> = new Map();
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) now?: number;
  @state() private expanded = false;
  @state() private servedOpen = false;
  @state() private heldOpen = false;
  #opening = "";
  #read = false;
  #pressedModel: SentPanel | null = null;
  #pressedNow?: number;
  #gestures?: Gestures;
  #pressed?: { slice: SentSlice; scope: string; billId: string; target: EventTarget };
  #suppressClick = false;
  @state() private dragging: string | null = null;
  #headingPress?: { id: string; target: EventTarget; expected: HeldOrder };
  readonly #startPointer = () => this.#releaseHeading();
  #reminderTimer?: ReturnType<typeof setTimeout>;
  #ageTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback(): void {
    this.#opening = "";
    super.connectedCallback();
    this.addEventListener("pointerdown", this.#startPointer, true);
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
          this.#info(press.slice.row.lineId, press.slice.kind);
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
  protected override willUpdate(): void {
    const opening = JSON.stringify([this.scope, this.billId]);
    if (opening !== this.#opening) {
      this.#opening = opening;
      this.#read = false;
      this.expanded = this.servedOpen = this.heldOpen = false;
      this.#pressedModel = null;
      this.#pressedNow = undefined;
      this.#pressed = undefined;
      this.#releaseHeading();
    }
    const model = this.#model();
    if (model !== null && !this.#read) {
      this.#read = true;
      this.expanded = model.attention;
    }
  }
  protected override updated(): void {
    clearTimeout(this.#reminderTimer);
    clearTimeout(this.#ageTimer);
    if (this.now !== undefined) return;
    if (this.expanded && (this.#model()?.fired.length ?? 0) > 0)
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
  #model(): SentPanel | null {
    const current = this.#current();
    return current === null ? null : sentPanel(current, this.billId, this.now ?? Date.now());
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
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
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
    const target = this.shadowRoot
      ?.elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-group-drag]");
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
  #serve(displayed: readonly { lineId: string; quantity: string }[]): void {
    if (!this.isConnected || this.busy || displayed.length === 0) return;
    const fired = this.#model()?.fired ?? [];
    const current = new Map(fired.map((slice) => [slice.row.lineId, slice.quantity]));
    if (displayed.some((item) => current.get(item.lineId) !== item.quantity)) return;
    this.#dispatch("serve-lines", { items: displayed.map((item) => ({ ...item })) });
    this.#releasePointer();
  }
  #info(lineId: string, kind: SentSlice["kind"]): void {
    if (!this.isConnected || this.busy) return;
    const model = this.#model();
    const slice =
      model &&
      [...model.served, ...model.fired, ...model.held.flatMap((g) => g.rows)].find(
        (slice) => slice.row.lineId === lineId && slice.kind === kind,
      );
    if (slice)
      this.#dispatch("sent-line-info", {
        lineId,
        workingOrderId: slice.row.workingOrderId,
        kind,
      } satisfies SentLineInfo);
    this.#releasePointer();
  }
  #groupCommand(name: string, groupId: string): void {
    if (!this.isConnected || this.busy) return;
    if (!this.#model()?.held.some(({ group }) => group.id === groupId)) return;
    if (name !== "fire-group" && this.#current()?.reminder?.groupId !== groupId) return;
    this.#dispatch(name, { groupId, ...(name === "snooze-group" ? { minutes: 5 } : {}) });
  }
  #releasePointer(): void {
    this.#pressedModel = null;
    this.#pressedNow = undefined;
    this.requestUpdate();
  }
  #pressLine(slice: SentSlice, event: PointerEvent): void {
    this.#releaseHeading();
    const target = event.composedPath()[0];
    if (target === undefined) return;
    this.#pressed = { slice, scope: this.scope, billId: this.billId, target };
    if (slice.kind === "fired") {
      this.#pressedModel = this.#model();
      this.#pressedNow = this.now ?? Date.now();
    }
    this.#suppressClick = false;
  }
  #clickServe(slice: SentSlice, event: MouseEvent): void {
    if (event.detail === 0 || !this.#suppressClick)
      this.#serve([{ lineId: slice.row.lineId, quantity: slice.quantity }]);
    this.#releasePointer();
  }
  #displayNow(): number {
    return this.#pressedNow ?? this.now ?? Date.now();
  }
  #money(value: string): string {
    return formatMoney(decimal(value), currentLocale());
  }
  #what(row: CurrentOrderRow, quantity: string): TemplateResult {
    return html`<span class="what"
      >${row.name}${nutritionIcons(row.nutrition?.allergens, nutritionDietLabels(undefined, row.nutrition?.dietaryDeclarations))}
      ×${quantity}
      ${row.extras.map((extra) => html`<span class="extra">${extra.name} ×${extra.quantity}</span>`)}
      ${row.note === null ? nothing : html`<span class="note">${t("line.note.label")}: ${row.note}</span>`}
    </span>`;
  }
  #status(slice: SentSlice): TemplateResult | string {
    if (slice.kind === "cancelled_charged") return t("table.cancelled_charged");
    if (slice.kind === "served") return t("table.row_served");
    if (slice.kind === "held") return t("table.group_held");
    if (slice.row.readyAt !== null) {
      const minutes = Math.max(
        0,
        Math.floor((this.#displayNow() - Date.parse(slice.row.readyAt)) / 60_000),
      );
      return t("table.row_ready_ago").replace("{n}", String(minutes));
    }
    return slice.row.firedAt === null
      ? t("table.group_fired")
      : html`<till-fired-ago
          .firedAt=${slice.row.firedAt}
          .now=${this.#displayNow()}
        ></till-fired-ago>`;
  }
  #line(slice: SentSlice): TemplateResult {
    const fired = slice.kind === "fired";
    const contents = html`${this.#what(slice.row, slice.quantity)}<span class="status"
        >${this.#status(slice)}</span
      ><span class="amount">${this.#money(slice.amount)}</span>`;
    return html`<li
      data-fired-line=${fired ? slice.row.lineId : nothing}
      data-served-line=${slice.kind === "served" || slice.kind === "cancelled_charged" ? slice.row.lineId : nothing}
      data-held-line=${slice.kind === "held" ? slice.row.lineId : nothing}
    >
      ${
        fired
          ? html`<button
              type="button"
              class="dish"
              data-serve-line=${slice.row.lineId}
              ?disabled=${this.busy}
              aria-description=${t("table.serve")}
              @pointerdown=${(event: PointerEvent) => this.#pressLine(slice, event)}
              @click=${(event: MouseEvent) => this.#clickServe(slice, event)}
            >
              ${contents}
            </button>`
          : html`<div
              class="dish"
              @pointerdown=${(event: PointerEvent) => this.#pressLine(slice, event)}
            >
              ${contents}
            </div>`
      }
      <wt-button
        variant="ghost"
        data-sent-info=${slice.row.lineId}
        aria-label=${`${t("table.sent_info")} · ${slice.row.name}`}
        ?disabled=${this.busy}
        @click=${() => this.#info(slice.row.lineId, slice.kind)}
        >ⓘ</wt-button
      >
    </li>`;
  }
  #courseName(id: string | null): string {
    return (
      this.#current()?.retainedCourses.find((course) => course.id === id)?.name ??
      t("table.course_none")
    );
  }
  #courseOrder(id: string | null): number {
    return this.#current()?.retainedCourses.find((course) => course.id === id)?.displayOrder ?? -1;
  }
  #heldTitle(entry: SentPanel["held"][number]): string {
    const ids = [...new Set(entry.group.rows.map((row) => row.courseId))]
      .filter((id) => id !== null)
      .sort((a, b) => this.#courseOrder(a) - this.#courseOrder(b));
    return [
      groupName(entry.group),
      ...(ids.length === 0 ? [] : [ids.map((id) => this.#courseName(id)).join(", ")]),
    ].join(" · ");
  }
  #heldCounts(model: SentPanel): string {
    const counts = new Map<string | null, string>();
    for (const { rows } of model.held)
      for (const slice of rows) {
        const id = slice.row.courseId;
        counts.set(
          id,
          trimQuantity(addDecimal(decimal(counts.get(id) ?? "0"), decimal(slice.quantity))),
        );
      }
    return [...counts]
      .sort(([a], [b]) => this.#courseOrder(a) - this.#courseOrder(b))
      .map(([id, quantity]) => `${this.#courseName(id)} (${quantity})`)
      .join(" · ");
  }
  #heldGroup(entry: SentPanel["held"][number]): TemplateResult {
    const expected = this.#heldOrder()!;
    const index = expected.ids.indexOf(entry.group.id);
    return html`<section
      class="group"
      data-held-group=${entry.group.id}
      ?data-dragging=${this.dragging === entry.group.id}
    >
      <div class="heading">
        <h4
          class="group-title"
          data-group-drag=${entry.group.id}
          @pointerdown=${(event: PointerEvent) => this.#pressHeading(entry.group.id, event)}
          .textContent=${this.#heldTitle(entry)}
        ></h4>
        ${
          expected.ids.length < 2
            ? nothing
            : keyed(
                JSON.stringify(expected),
                html`<wt-row-actions
                  data-group-more=${entry.group.id}
                  label=${`${t("shell.more")} · ${groupName(entry.group)}`}
                  align="end"
                >
                  ${
                    index > 0
                      ? html`<wt-button
                          data-group-earlier
                          variant="secondary"
                          ?disabled=${this.busy}
                          @click=${() => this.#reorder(expected, entry.group.id, index - 1)}
                          >${t("table.group_earlier")}</wt-button
                        >`
                      : nothing
                  }
                  ${
                    index < expected.ids.length - 1
                      ? html`<wt-button
                          data-group-later
                          variant="secondary"
                          ?disabled=${this.busy}
                          @click=${() => this.#reorder(expected, entry.group.id, index + 1)}
                          >${t("table.group_later")}</wt-button
                        >`
                      : nothing
                  }
                </wt-row-actions>`,
              )
        }
        <wt-button
          variant=${this.busy ? "secondary" : "primary"}
          data-group-fire=${entry.group.id}
          ?disabled=${this.busy}
          aria-label=${`${t("table.group_fire")} · ${groupName(entry.group)}`}
          @click=${() => this.#groupCommand("fire-group", entry.group.id)}
          >${t("table.group_fire")}</wt-button
        >
      </div>
      <ul>
        ${entry.rows.map((slice) => this.#line(slice))}
        ${entry.companions.map(
          (row) =>
            html`<li class="companion" data-companion=${row.lineId}>
              <div class="dish">
                ${this.#what(row, row.quantity)}<span class="bill"
                  >${this.billLabels.get(row.workingOrderId) ?? t("table.sent_other_bill")}</span
                >
              </div>
            </li>`,
        )}
      </ul>
    </section>`;
  }
  #reminder(model: SentPanel): TemplateResult | typeof nothing {
    const reminder = model.reminder;
    const entry = model.held.find(({ group }) => group.id === reminder?.groupId);
    if (!entry || reminderDueAt(reminder) === Number.POSITIVE_INFINITY) return nothing;
    const due = reminderDueAt(reminder) <= this.#displayNow();
    const group = entry.group;
    return html`<div class="reminder" data-group-reminder=${due ? "due" : "waiting"}>
      <span
        >${this.#heldTitle(entry)} ·
        ${due ? `${t("table.reminder_due")} · ${clockTime(reminderDueAt(reminder))}` : t("table.reminder_at").replace("{time}", clockTime(reminderDueAt(reminder)))}</span
      >
      ${
        group.remindAt === null
          ? nothing
          : html`<wt-button
              variant="secondary"
              data-reminder-unsnooze
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
    if (!model || model.served.length + model.fired.length + model.held.length === 0)
      return nothing;
    const counts = model.counts;
    const summary = t("table.sent_counts")
      .replace("{ready}", counts.ready)
      .replace("{firing}", counts.firing)
      .replace("{held}", counts.held)
      .replace("{served}", counts.served);
    const fired = model.fired;
    return html`<section
      class="panel${model.attention ? " attention" : ""}${this.expanded ? " expanded" : ""}"
      data-sent-panel
    >
      <h2>
        <button
          type="button"
          class="toggle"
          data-sent-toggle
          aria-expanded=${String(this.expanded)}
          aria-controls="sent-content"
          @click=${() => {
            this.expanded = !this.expanded;
          }}
        >
          <span
            >${t("table.sent_title")}${model.attention ? html` <span class="mark" data-sent-attention>!</span>` : nothing}</span
          >
          <span class="summary">${summary}</span
          ><span aria-hidden="true">${this.expanded ? "▾" : "▸"}</span>
        </button>
      </h2>
      ${this.#reminder(model)}
      ${
        !this.expanded
          ? nothing
          : html`<div class="content" id="sent-content">
              <section>
                <button
                  type="button"
                  class="toggle"
                  data-served-toggle
                  aria-expanded=${String(this.servedOpen)}
                  @click=${() => {
                    this.servedOpen = !this.servedOpen;
                  }}
                >
                  ${t("table.served_title")} · ${counts.served} ·
                  ${this.#money(model.subtotals.served)}
                </button>
                ${
                  !this.servedOpen
                    ? nothing
                    : html`<ul>
                        ${model.served.map((slice) => this.#line(slice))}
                      </ul>`
                }
              </section>
              <section>
                <div class="heading">
                  <h3>${t("table.group_fired")}</h3>
                  <wt-button
                    data-serve-all
                    variant=${this.busy || model.fired.length === 0 ? "secondary" : "primary"}
                    ?disabled=${this.busy || model.fired.length === 0}
                    @click=${() => this.#serve(model.fired.map((slice) => ({ lineId: slice.row.lineId, quantity: slice.quantity })))}
                    >${t("table.serve_group")}</wt-button
                  >
                </div>
                <ul
                  @pointercancel=${() => this.#releasePointer()}
                  @pointerleave=${() => this.#releasePointer()}
                >
                  ${repeat(
                    fired,
                    (slice) => slice.row.lineId,
                    (slice) => this.#line(slice),
                  )}
                </ul>
              </section>
              <section>
                <button
                  type="button"
                  class="toggle"
                  data-held-toggle
                  aria-expanded=${String(this.heldOpen)}
                  @click=${() => {
                    this.heldOpen = !this.heldOpen;
                  }}
                >
                  ${t("table.group_held")} · ${this.#heldCounts(model)}
                </button>
                ${!this.heldOpen ? nothing : model.held.map((entry) => this.#heldGroup(entry))}
              </section>
            </div>`
      }
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-sent-orders": TillSentOrders;
  }
}
