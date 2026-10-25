import { shortNameKey } from "@waitron/shared";
import { blocksPlace } from "./joined-split-layout.js";

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
  shortName: string | null;
  seats: number | null;
  fixed: boolean;
  placement: Placement | null;
  remove: boolean;
}

export interface LiveTable {
  id: string;
  label: string;
  shortName: string | null;
  /** An open party sits there now. */
  held: boolean;
  /** A module refuses to let it go, so it waits whole as a held table does, but is never seeded. */
  refused: boolean;
  /** Held, or used earlier by a party still open, or an order to it unpaid or with food on its way. */
  tied: boolean;
  /** It has a today's row. */
  hasToday: boolean;
  /** It is in a today's merge holding a waiting table: held, refused, or in a waiting split group. */
  mergedWithHeld: boolean;
  /** It is in a split group, a joined table and the parts split off it today, one of whose members waits or has food on its way. */
  splitWithBusy: boolean;
  /** It needs clearing, so it waits as a held table does, and is seeded as one is. */
  clearing: boolean;
  /** It is in a joined group of the reset, a joined table and its parts, with a waiting member. */
  joinedWithWaiting: boolean;
  /** Its new place is taken by a table that stays, so it keeps its place for now. */
  blocked: boolean;
}

export interface ResetPlan {
  /** `label` null: keep the current name, the target's is still in use. */
  apply: { target: Target; label: string | null }[];
  /** Held tables, or ones needing clearing, with no today's row: today's row from the target, name kept; the target stays pending. */
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
  currentShortKey: string | undefined;
  wantsNew: boolean;
}

export function planReset(input: {
  targets: readonly Target[];
  live: readonly LiveTable[];
  takenElsewhere: ReadonlySet<string>;
  /** Short-name keys of the venue's live tables in other zones. */
  shortNameKeysElsewhere: ReadonlySet<string>;
  /** Targets with no table yet, a joined table to create whose group waits. */
  waitingToCreate?: ReadonlySet<Target>;
}): ResetPlan {
  const live = new Map(input.live.map((table) => [table.id, table]));
  const plan: ResetPlan = { apply: [], seed: [], create: [], remove: [], hide: [], pending: [] };
  const fixedInUse = new Set(input.takenElsewhere);
  // Short-name keys are kept apart from labels, so a label "12" never blocks a short name "12".
  const fixedShortInUse = new Set(input.shortNameKeysElsewhere);
  const holdShort = (name: string | null) => {
    if (name !== null) fixedShortInUse.add(shortNameKey(name));
  };
  const targeted = new Set(input.targets.map((target) => target.tableId));
  for (const table of input.live) {
    if (!targeted.has(table.id)) {
      fixedInUse.add(table.label);
      holdShort(table.shortName);
    }
  }
  const renamings: Renaming[] = [];

  for (const target of input.targets) {
    const table = target.tableId === null ? undefined : live.get(target.tableId);
    if (target.tableId === null && input.waitingToCreate?.has(target)) {
      plan.pending.push(target);
      fixedInUse.add(target.label);
      holdShort(target.shortName);
    } else if (target.tableId !== null && !table) {
      // The table's state is unknown, so nothing is done to it and no other table takes its target name.
      plan.pending.push(target);
      fixedInUse.add(target.label);
      holdShort(target.shortName);
    } else if (
      table &&
      (table.held ||
        table.refused ||
        table.clearing ||
        table.mergedWithHeld ||
        table.splitWithBusy ||
        table.joinedWithWaiting ||
        table.blocked)
    ) {
      plan.pending.push(target);
      if ((table.held || table.clearing) && !table.hasToday) plan.seed.push(target);
      fixedInUse.add(table.label);
      holdShort(table.shortName);
    } else if (target.remove) {
      if (!table) continue;
      // A removal frees its names only once it has succeeded, so they stay taken this pass.
      fixedInUse.add(table.label);
      holdShort(table.shortName);
      if (table.tied) {
        plan.hide.push(table.id);
        plan.pending.push(target);
      } else {
        plan.remove.push(table.id);
      }
    } else {
      renamings.push({
        target,
        current: table?.label,
        currentShortKey:
          table && table.shortName !== null ? shortNameKey(table.shortName) : undefined,
        wantsNew: true,
      });
    }
  }

  // Ends: each pass only moves entries from wanting a new name to keeping theirs or waiting.
  for (let changed = true; changed;) {
    changed = false;
    const inUse = new Set(fixedInUse);
    const shortInUse = new Set(fixedShortInUse);
    for (const entry of renamings) {
      if (entry.wantsNew) continue;
      if (entry.current !== undefined) inUse.add(entry.current);
      if (entry.currentShortKey !== undefined) shortInUse.add(entry.currentShortKey);
    }
    const claimed = new Set<string>();
    const shortClaimed = new Set<string>();
    for (const entry of renamings) {
      if (!entry.wantsNew) continue;
      const { label, shortName } = entry.target;
      const shortKey = shortName === null ? undefined : shortNameKey(shortName);
      if (
        inUse.has(label) ||
        claimed.has(label) ||
        (shortKey !== undefined && (shortInUse.has(shortKey) || shortClaimed.has(shortKey)))
      ) {
        entry.wantsNew = false;
        changed = true;
      } else {
        claimed.add(label);
        if (shortKey !== undefined) shortClaimed.add(shortKey);
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

/** Whether applying `target` would carry a table drawn on today's map somewhere else. */
export function movesTable(
  today: {
    placement: Placement | null;
    takenOff: boolean;
    inMerge: boolean;
    splitOff: boolean;
  } | null,
  target: { placement: Placement | null },
): boolean {
  if (today === null || today.placement === null || today.takenOff) return false;
  if (today.inMerge || today.splitOff || target.placement === null) return true;
  const [from, to] = [today.placement, target.placement];
  return (
    from.x !== to.x ||
    from.y !== to.y ||
    from.width !== to.width ||
    from.height !== to.height ||
    from.shape !== to.shape ||
    from.rotation !== to.rotation
  );
}

/** The moving tables that must keep their place: repeated until a pass blocks nothing new; a
 *  blocked table's current place joins `staying`. Tables moving together never
 *  block each other, nor does a staying table at `own`, its place in the layout being applied. */
export function blockedMoves(input: {
  moving: readonly { tableId: string; from: Placement | null; to: Placement | null }[];
  staying: readonly { tableId: string; place: Placement; own?: Placement | null }[];
}): Set<string> {
  const blocked = new Set<string>();
  const places = input.staying.map(({ place, own }) => ({ place, own: own ?? null }));
  for (let changed = true; changed;) {
    changed = false;
    for (const { tableId, from, to } of input.moving) {
      if (blocked.has(tableId) || to === null) continue;
      if (!places.some(({ place, own }) => blocksPlace(to, place, own))) continue;
      blocked.add(tableId);
      if (from !== null) places.push({ place: from, own: to });
      changed = true;
    }
  }
  return blocked;
}

export function targetsFromMaster(
  master: readonly {
    id: string;
    label: string;
    seats: number | null;
    fixed: boolean;
    placement: Placement | null;
    shortName: string | null;
  }[],
  live: readonly {
    id: string;
    label: string;
    planTableId: string | null;
    shortName: string | null;
  }[],
): Target[] {
  const byId = new Map(master.map((table) => [table.id, table]));
  const followed = new Set<string>();
  const targets: Target[] = [];
  for (const table of live) {
    const source = table.planTableId === null ? undefined : byId.get(table.planTableId);
    if (source) {
      followed.add(source.id);
      const { label, shortName, seats, fixed, placement } = source;
      targets.push({
        tableId: table.id,
        planTableId: source.id,
        label,
        shortName,
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
        shortName: table.shortName,
        seats: null,
        fixed: false,
        placement: null,
        remove: true,
      });
    }
  }
  for (const { id, label, shortName, seats, fixed, placement } of master) {
    if (!followed.has(id))
      targets.push({
        tableId: null,
        planTableId: id,
        label,
        shortName,
        seats,
        fixed,
        placement,
        remove: false,
      });
  }
  return targets;
}
