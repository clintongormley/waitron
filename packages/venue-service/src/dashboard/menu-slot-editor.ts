import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import type { HourPeriod } from "../hours-types.js";
import type { MenuPeriod, MenuSlot } from "../menu-timetable-types.js";
import {
  cellChecks,
  weekChecks,
  type CellComposer,
  type CellDraft,
  type CellMode,
} from "./hours-cell-editor.js";
import "./hours-cell-editor.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

/** One row of a day's slots while it is edited; `id` is the row's, never stored. */
export interface SlotRow extends MenuSlot {
  id: string;
}
/**
 * `all_day` is a day with no slots, which offers the all-day menu all day; `inherit`, offered only
 * on a special date, follows the normal week.
 */
export interface SlotDraft {
  mode: Exclude<CellMode, "closed">;
  slots: SlotRow[];
}

export const slotDraftOf = (slots: readonly MenuSlot[] | null): SlotDraft =>
  slots === null
    ? { mode: "inherit", slots: [] }
    : {
        mode: slots.length === 0 ? "all_day" : "periods",
        slots: slots.map((slot) => ({ ...slot, id: crypto.randomUUID() })),
      };

/** The slots a draft saves; a day in `all_day` saves none. */
export const wireSlots = (draft: SlotDraft): MenuSlot[] =>
  draft.mode === "periods"
    ? draft.slots.map(({ periodId, startsAt, endsAt }) => ({ periodId, startsAt, endsAt }))
    : [];

const cellOf = (draft: SlotDraft): CellDraft => ({
  mode: draft.mode,
  periods: draft.slots.map((slot) => ({
    id: slot.id,
    opensAt: slot.startsAt,
    closesAt: slot.endsAt,
  })),
});

/** The Hours checks' sentences, in a timetable's words. */
const SAID: [Parameters<typeof t>[0], Parameters<typeof t>[0]][] = [
  ["hours.same_time", "menu.same_time"],
  ["hours.period_overlap", "menu.slot_overlap"],
];
const reworded = (message: string) => SAID.find(([hours]) => t(hours) === message)?.[1] ?? null;

/** A day's own faults, keyed as the slot editor names its fields under `prefix`. */
export function slotChecks(prefix: string, draft: SlotDraft): Record<string, string> {
  const errors = Object.fromEntries(
    Object.entries(cellChecks(prefix, cellOf(draft))).map(([field, message]) => {
      const key = reworded(message);
      return [field, key === null ? message : t(key)];
    }),
  );
  if (draft.mode === "periods")
    draft.slots.forEach((slot, index) => {
      if (slot.periodId === "")
        errors[`${prefix}.periods.${index}.periodId`] = t("menu.period_required");
    });
  return errors;
}

const dayName = (weekday: number) =>
  t(`hours.day_in_sentence.${weekday}` as Parameters<typeof t>[0]);

/** Where the week's day `only` runs past midnight into a neighbour's slots, or they into it. */
export function weekSlotChecks(
  week: readonly SlotDraft[],
  prefix: string,
  only: number,
): Record<string, string> {
  // To Hours a day open all day overlaps any neighbour; a menu day with no slots overlaps none.
  const slotsOnly = week.map((draft) =>
    draft.mode === "periods" ? cellOf(draft) : { mode: "periods" as const, periods: [] },
  );
  const errors = weekChecks(slotsOnly, () => prefix, only);
  const message = errors[`${prefix}.mode`];
  if (message === undefined) return {};
  const next = format("hours.overlap_next_day", { day: dayName((only + 1) % 7) });
  return {
    [`${prefix}.mode`]:
      message === next
        ? format("menu.overlap_next_day", { day: dayName((only + 1) % 7) })
        : format("menu.overlap_previous_day", { day: dayName((only + 6) % 7) }),
  };
}

/** One day's menu slots, each naming one of the department's periods, drawn by the Hours cell editor. */
@customElement("menu-slot-editor")
export class MenuSlotEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property() label = "";
  /** Names every field: `${fieldPrefix}.mode` and `${fieldPrefix}.periods.N.periodId`. */
  @property({ attribute: "field-prefix" }) fieldPrefix = "";
  @property({ attribute: false }) modes: SlotDraft["mode"][] = ["all_day", "periods"];
  @property({ attribute: false }) draft: SlotDraft = { mode: "all_day", slots: [] };
  /** The department's named periods, each with its menu's name. */
  @property({ attribute: false }) periods: (MenuPeriod & { menuName: string })[] = [];
  @property({ attribute: false }) errors: Record<string, string> = {};
  @property({ type: Boolean, reflect: true }) disabled = false;

  #change(draft: SlotDraft): void {
    this.dispatchEvent(
      new CustomEvent("menu-slot-change", { detail: { draft }, bubbles: true, composed: true }),
    );
  }

  #cellChanged(event: CustomEvent<{ cell: CellDraft }>): void {
    event.stopPropagation();
    const { cell } = event.detail;
    this.#change({
      mode: cell.mode as SlotDraft["mode"],
      slots: cell.periods.map((period) => ({
        id: period.id,
        periodId: this.draft.slots.find((slot) => slot.id === period.id)?.periodId ?? "",
        startsAt: period.opensAt,
        endsAt: period.closesAt,
      })),
    });
  }

  #periodField = (row: HourPeriod, index: number) => {
    const slot = this.draft.slots.find((entry) => entry.id === row.id);
    return html`<wt-combobox
      name=${`${this.fieldPrefix}.periods.${index}.periodId`}
      label=${t("menu.slot_period")}
      required
      search="never"
      .options=${this.periods.map((period) => ({
        value: period.id,
        label: `${period.name} (${period.menuName})`,
      }))}
      .value=${slot?.periodId ?? ""}
      error=${this.errors[`${this.fieldPrefix}.periods.${index}.periodId`] ?? ""}
      ?disabled=${this.disabled}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#change({
          ...this.draft,
          slots: this.draft.slots.map((entry) =>
            entry.id === row.id ? { ...entry, periodId: event.detail.value } : entry,
          ),
        });
      }}
    ></wt-combobox>`;
  };

  readonly #composer: CellComposer = {
    words: {
      get mode() {
        return t("menu.mode");
      },
      get modes() {
        return {
          inherit: t("menu.normal_week"),
          all_day: t("menu.mode.all_day"),
          periods: t("menu.mode.periods"),
        };
      },
      get opens() {
        return t("menu.starts");
      },
      get closes() {
        return t("menu.ends");
      },
      get add() {
        return t("menu.add_slot");
      },
      get remove() {
        return t("menu.remove_slot");
      },
    },
    periodField: (period, index) => this.#periodField(period, index),
  };

  override render() {
    return html`<hours-cell-editor
      label=${this.label}
      field-prefix=${this.fieldPrefix}
      .modes=${this.modes}
      .cell=${cellOf(this.draft)}
      .errors=${this.errors}
      .composer=${this.#composer}
      ?disabled=${this.disabled}
      @hours-cell-change=${this.#cellChanged}
    ></hours-cell-editor>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "menu-slot-editor": MenuSlotEditor;
  }
  interface HTMLElementEventMap {
    "menu-slot-change": CustomEvent<{ draft: SlotDraft }>;
  }
}
