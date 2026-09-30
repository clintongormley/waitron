/**
 * One thing on a table that wants attention (service spec §1). Several coexist on one table. The
 * party's bills and their dishes' kitchen state are read over its FAMILY — the party and every party
 * merged into it — while its drafts, held groups and bill request are its own. Every table the party
 * sits at carries its signals; `needs_clearing` is the table's own.
 */
export type TableSignal =
  /** An open party with no line on any bill of its family that is not abandoned, and no open draft. */
  | { kind: "take_order" }
  /** The owners of the party's open drafts holding a line, oldest first; "" for one no longer known. */
  | { kind: "unsent_draft"; ownerNames: string[] }
  /** Dishes the kitchen has made ready and nobody has served yet, counted in units per station. */
  | { kind: "ready"; byStation: ReadyAtStation[] }
  /** The worst waiting band over fired dishes still to serve, each against its own station. */
  | { kind: "long_wait"; band: "warm" | "overdue" | "forgotten" }
  /** The held group waiting to be released, once it has a due time, which may still be ahead. */
  | { kind: "release_due"; groupId: string; dueAt: string }
  /** A held group holding a line whose product cannot be sold now, and those lines' staff names. */
  | { kind: "held_unavailable"; groupId: string; lineNames: string[] }
  | { kind: "bill_requested"; requestedAt: string }
  | { kind: "needs_clearing"; since: string };

export interface ReadyAtStation {
  stationId: string;
  stationName: string;
  count: number;
}

/** The signals a bill with no party can carry: the counter's tab list shows them. */
export type KitchenSignal = Extract<TableSignal, { kind: "ready" | "long_wait" }>;
