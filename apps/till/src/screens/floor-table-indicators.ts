import type { FloorPulse, FloorRing } from "@waitron/ui";
import type { TableState } from "../api/floor-api.js";
import type { StringKey } from "../i18n/strings.js";
import type { MapKind } from "../state/floor-look.js";
import { shownUnder } from "../state/floor-today.js";
import { reminderDueAt } from "../state/release-reminder.js";
import { byPrecedence, lateBand, type TableStateKind } from "../state/table-precedence.js";
import { chipState, heldChip, signalChips } from "../widgets/signal-chips.js";

/** The words of a table that needs clearing or moving. */
export const WAITING = {
  clear: {
    state: "floor.needs_clearing",
    title: "floor.clear_title",
    titleNamed: "floor.clear_title_named",
    body: "floor.clear_body",
    action: "floor.mark_cleared",
  },
  move: {
    state: "floor.needs_moving",
    title: "floor.move_title",
    titleNamed: "floor.move_title_named",
    body: "floor.move_body",
    action: "floor.mark_moved",
  },
} as const satisfies Record<string, Record<string, StringKey>>;

export type Waiting = keyof typeof WAITING;

export function needsClearing(table: TableState): boolean {
  return table.condition === "needs_clearing";
}

/** The party's name when it says more than the name the table is shown under: a name staff gave,
 * or a joined party's tables. */
export function shownPartyName(table: TableState): string | undefined {
  const name = table.party?.displayName;
  return name === undefined || name === shownUnder(table) ? undefined : name;
}

export const PULSE_OF: Partial<Record<MapKind, FloorPulse>> = {
  forgotten: "forgotten",
  overdue: "overdue",
  fire: "fire",
};

export const RING_OF: Partial<Record<TableStateKind, FloorRing>> = {
  forgotten: "forgotten",
  overdue: "overdue",
  fire: "fire",
  waiting: "waiting",
};

/** The table's own Forgotten badge already says a forgotten wait. */
export function tableChips(table: TableState, now: number) {
  const chips = signalChips(table.signals, {
    forgottenShown: lateBand(table) === "forgotten",
    now,
  });
  const held = heldChip(table.signals, reminderDueAt(table.party?.reminder), now);
  return byPrecedence(held === null ? chips : [...chips, held], (chip) =>
    chipState(chip, table.signals),
  );
}
