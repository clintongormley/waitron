export type PlanShape = "rect" | "round";

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: PlanShape;
  rotation: number;
}

/** What a reset copies for one table: the master's values, or that the table goes. */
export interface Target {
  tableId: string | null;
  /** The master table copied; null for a removal. */
  planTableId: string | null;
  label: string;
  seats: number | null;
  fixed: boolean;
  placement: Placement | null;
  remove: boolean;
}

export interface LiveTable {
  id: string;
  label: string;
  /** An open party sits there now. */
  held: boolean;
  /** Held, or used earlier by a party still open, or an order to it unpaid or with food on its way. */
  tied: boolean;
  /** It has a today's row. */
  hasToday: boolean;
  /** It is in a today's merge with a held table. */
  mergedWithHeld: boolean;
}

export interface ResetPlan {
  /** `label` null: keep the current name, the target's is still in use. */
  apply: { target: Target; label: string | null }[];
  /** Held tables with no today's row: today's row from the target, name kept; the target stays pending. */
  seed: Target[];
  /** Tables to create, whose names are free. */
  create: Target[];
  /** To remove for good. */
  remove: string[];
  /** To take off today's plan: tied, removed once free. */
  hide: string[];
  /** Still to do at a later catch-up. */
  pending: Target[];
}

interface Renaming {
  target: Target;
  current: string | undefined;
  wantsNew: boolean;
}

export function planReset(input: {
  targets: readonly Target[];
  /** Every live table of the zone, inactive ones included. */
  live: readonly LiveTable[];
  takenElsewhere: ReadonlySet<string>;
}): ResetPlan {
  const live = new Map(input.live.map((table) => [table.id, table]));
  const plan: ResetPlan = { apply: [], seed: [], create: [], remove: [], hide: [], pending: [] };
  const fixedInUse = new Set(input.takenElsewhere);
  const targeted = new Set(input.targets.map((target) => target.tableId));
  for (const table of input.live) {
    if (!targeted.has(table.id)) fixedInUse.add(table.label);
  }
  const renamings: Renaming[] = [];

  for (const target of input.targets) {
    const table = target.tableId === null ? undefined : live.get(target.tableId);
    if (target.tableId !== null && !table) {
      // The table's state is unknown, so nothing is done to it and no other table takes its target name.
      plan.pending.push(target);
      fixedInUse.add(target.label);
    } else if (table && (table.held || table.mergedWithHeld)) {
      plan.pending.push(target);
      if (table.held && !table.hasToday) plan.seed.push(target);
      fixedInUse.add(table.label);
    } else if (target.remove) {
      if (!table) continue;
      // A removal frees its name only once it has succeeded, so the name stays taken this pass.
      fixedInUse.add(table.label);
      if (table.tied) {
        plan.hide.push(table.id);
        plan.pending.push(target);
      } else {
        plan.remove.push(table.id);
      }
    } else {
      renamings.push({ target, current: table?.label, wantsNew: true });
    }
  }

  // Ends: each pass only moves entries from wanting a new name to keeping theirs or waiting.
  for (let changed = true; changed;) {
    changed = false;
    const inUse = new Set(fixedInUse);
    for (const entry of renamings) {
      if (!entry.wantsNew && entry.current !== undefined) inUse.add(entry.current);
    }
    const claimed = new Set<string>();
    for (const entry of renamings) {
      if (!entry.wantsNew) continue;
      if (inUse.has(entry.target.label) || claimed.has(entry.target.label)) {
        entry.wantsNew = false;
        changed = true;
      } else {
        claimed.add(entry.target.label);
      }
    }
  }

  for (const { target, wantsNew } of renamings) {
    if (target.tableId !== null) plan.apply.push({ target, label: wantsNew ? target.label : null });
    if (target.tableId === null && wantsNew) plan.create.push(target);
    if (!wantsNew) plan.pending.push(target);
  }
  return plan;
}

export function targetsFromMaster(
  master: readonly {
    id: string;
    label: string;
    seats: number | null;
    fixed: boolean;
    placement: Placement | null;
  }[],
  live: readonly { id: string; label: string; planTableId: string | null; planned: boolean }[],
): Target[] {
  const byId = new Map(master.map((table) => [table.id, table]));
  const followed = new Set<string>();
  const targets: Target[] = [];
  for (const table of live) {
    if (!table.planned) continue;
    const source = table.planTableId === null ? undefined : byId.get(table.planTableId);
    if (source) {
      followed.add(source.id);
      const { label, seats, fixed, placement } = source;
      targets.push({
        tableId: table.id,
        planTableId: source.id,
        label,
        seats,
        fixed,
        placement,
        remove: false,
      });
    } else {
      targets.push({
        tableId: table.id,
        planTableId: null,
        label: table.label,
        seats: null,
        fixed: false,
        placement: null,
        remove: true,
      });
    }
  }
  for (const { id, label, seats, fixed, placement } of master) {
    if (!followed.has(id))
      targets.push({
        tableId: null,
        planTableId: id,
        label,
        seats,
        fixed,
        placement,
        remove: false,
      });
  }
  return targets;
}
