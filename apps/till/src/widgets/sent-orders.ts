import type { PartyAllergySnapshot } from "@waitron/module";
import { allergyGuestId, allergyMark, allergyMarkStyles } from "./party-allergy-mark.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  formatDecimalInput,
  Gestures,
  preventTouchContextMenu,
  visuallyHiddenStyles,
} from "@waitron/ui";
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
import type { SentSlice } from "../state/sent-panel.js";
import { sentRowPortionKey } from "../state/portion-groups.js";
import { type SentRow, type SentSection, sentSections } from "../state/sent-sections.js";
import { sentMenuDishes } from "../state/set-menus.js";
import { setMenuTag, setMenuTagStyles } from "./set-menu-presentation.js";
import { reminderDueAt } from "../state/release-reminder.js";
import { trimQuantity } from "./dish-format.js";
import { groupName } from "./group-name.js";
import { nutritionIcons, nutritionIconStyles } from "./nutrition-icons.js";
import { nutritionDietLabels } from "../diet-labels.js";
import { sentCompanion, sentRow, sentRowStyles } from "./sent-row.js";
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
}

/** The slices a row's information and hold name: what is left of it, or else all of it. */
const infoMembers = (row: SentRow) => (row.left.length > 0 ? row.left : row.slices);
/** The served slices a row joins to what is left of it, which its information names apart. */
const servedBeside = (row: SentRow) =>
  row.left.length > 0 ? row.slices.filter((slice) => slice.kind === "served") : [];
const firedLeft = (rows: readonly SentRow[]) =>
  rows.flatMap((row) => row.left).filter((slice) => slice.kind === "fired");

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
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        min-width: 0;
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
  }
  protected override updated(): void {
    clearTimeout(this.#reminderTimer);
    clearTimeout(this.#ageTimer);
    if (this.now !== undefined) return;
    if (this.#model()?.sections.some((section) => firedLeft(section.rows).length > 0))
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
  #model(): SentModel | null {
    const current = this.#current();
    if (current === null) return null;
    const sections = sentSections(current, this.billId, this.now ?? Date.now(), (slice) =>
      sentRowPortionKey(slice, this.lines, [
        allergyGuestId(this.allergy, { kind: "working", id: slice.row.lineId }),
        this.#setMenuDishes.get(slice.row.lineId)?.setMenuId,
      ]),
    );
    return { sections, reminder: current.reminder };
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
  #serve(displayed: readonly { lineId: string; quantity: string }[]): void {
    if (!this.isConnected || this.busy || displayed.length === 0) return;
    const current = new Map(
      firedLeft(this.#model()?.sections.flatMap((section) => section.rows) ?? [])
        .filter((slice) => slice.row.released)
        .map((slice) => [slice.row.lineId, slice.quantity]),
    );
    if (displayed.some((item) => current.get(item.lineId) !== item.quantity)) return;
    this.#dispatch("serve-lines", { items: displayed.map((item) => ({ ...item })) });
    this.#releasePointer();
  }
  #info(row: SentRow): void {
    if (!this.isConnected || this.busy) return;
    const members = infoMembers(row);
    const served = servedBeside(row);
    const slices = this.#model()?.sections.flatMap((section) =>
      section.rows.flatMap((row) => row.slices),
    );
    const found = [...members, ...served].map((member) =>
      slices?.find((slice) => slice.row.lineId === member.row.lineId && slice.kind === member.kind),
    );
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
    if (!this.#model()?.sections.some(({ held, group }) => held && group?.id === groupId)) return;
    if (name !== "fire-group" && this.#current()?.reminder?.groupId !== groupId) return;
    this.#dispatch(name, { groupId, ...(name === "snooze-group" ? { minutes: 5 } : {}) });
  }
  #releasePointer(): void {
    this.#pressedModel = null;
    this.#pressedNow = undefined;
    this.requestUpdate();
  }
  #pressLine(row: SentRow, event: PointerEvent): void {
    const members = infoMembers(row);
    const slice = members[0]!;
    this.#releaseHeading();
    if (this.busy || (slice.kind === "fired" && !slice.row.released)) return;
    const target = event.composedPath()[0];
    if (target === undefined) return;
    this.#pressed = { row, scope: this.scope, billId: this.billId, target };
    if (slice.kind === "fired") {
      this.#pressedModel = this.#model();
      this.#pressedNow = this.now ?? Date.now();
    }
    this.#suppressClick = false;
  }
  #clickServe(row: SentRow, event: MouseEvent): void {
    if (event.detail === 0 || !this.#suppressClick)
      this.#serve(
        firedLeft([row]).map((slice) => ({ lineId: slice.row.lineId, quantity: slice.quantity })),
      );
    this.#releasePointer();
  }
  #displayNow(): number {
    return this.#pressedNow ?? this.now ?? Date.now();
  }
  #money(value: string): string {
    return formatMoney(decimal(value), currentLocale());
  }
  #quantity = (value: string): string => formatDecimalInput(trimQuantity(value), currentLocale());
  #marks(row: CurrentOrderRow): TemplateResult {
    return html`${nutritionIcons(row.nutrition?.allergens, nutritionDietLabels(undefined, row.nutrition?.dietaryDeclarations))}${setMenuTag(this.#setMenuDishes.get(row.lineId)?.price)}${allergyMark(this.allergy, { kind: "working", id: row.lineId })}`;
  }
  #courseNames(section: SentSection): string {
    const courses = this.#current()?.retainedCourses ?? [];
    return section.title.courseIds
      .map((id) => courses.find((course) => course.id === id)?.name ?? t("table.course_none"))
      .join(", ");
  }
  #title(section: SentSection): TemplateResult {
    const names = this.#courseNames(section);
    const { state, firedAt } = section.title;
    const word =
      state === "held"
        ? t("table.group_held")
        : state === "at_the_pass"
          ? t("table.at_the_pass")
          : firedAt === null
            ? t("table.group_fired")
            : html`<till-fired-ago
                .firedAt=${firedAt}
                .now=${this.#displayNow()}
              ></till-fired-ago>`;
    return html`${names === "" ? nothing : `${names} · `}${word}`;
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
        variant=${this.busy ? "secondary" : "primary"}
        data-group-fire=${group.id}
        ?disabled=${this.busy}
        aria-label=${`${t("table.group_fire")} · ${groupName(group)}`}
        @click=${() => this.#groupCommand("fire-group", group.id)}
        >${t("table.group_fire")}</wt-button
      >`;
  }
  #serveAll(section: SentSection): TemplateResult {
    const released = firedLeft(section.rows).filter((slice) => slice.row.released);
    const off = this.busy || released.length === 0;
    return html`<wt-button
      slot="end"
      data-serve-all
      variant=${off ? "secondary" : "primary"}
      ?disabled=${off}
      @click=${() => this.#serve(released.map((slice) => ({ lineId: slice.row.lineId, quantity: slice.quantity })))}
      >${t("table.serve_group")}</wt-button
    >`;
  }
  #section(section: SentSection, expected: HeldOrder): TemplateResult {
    const id = section.group?.id ?? "";
    const held = section.held;
    const now = this.#displayNow();
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
        ${held ? this.#heldActions(section, expected) : this.#serveAll(section)}
      </wt-course-heading>
      <ul
        @pointercancel=${() => this.#releasePointer()}
        @pointerleave=${() => this.#releasePointer()}
      >
        ${repeat(
          section.rows,
          (row) => `${row.slices[0]!.kind === "cancelled_charged"}:${row.slices[0]!.row.lineId}`,
          (row) =>
            sentRow({
              row,
              heading: section.title.state,
              now,
              quantity: this.#quantity,
              price: this.#money(row.amount),
              marks: this.#marks(infoMembers(row)[0]!.row),
              busy: this.busy,
              press: (event) => this.#pressLine(row, event),
              serve: (event) => this.#clickServe(row, event),
              info: () => this.#info(row),
            }),
        )}
        ${section.companions.map((row) =>
          sentCompanion(
            row,
            this.billLabels.get(row.workingOrderId) ?? t("table.sent_other_bill"),
            this.#quantity,
            this.#marks(row),
          ),
        )}
      </ul>
    </section>`;
  }
  #reminder(model: SentModel): TemplateResult | typeof nothing {
    const reminder = model.reminder;
    const section = model.sections.find(
      ({ held, group }) => held && group?.id === reminder?.groupId,
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
      ${this.#reminder(model)} ${model.sections.map((section) => this.#section(section, expected))}
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-sent-orders": TillSentOrders;
  }
}
