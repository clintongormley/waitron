import { NEW_TABLE_SIZE, clampToGrid, firstFreeSpot } from "@waitron/ui";
import type { FloorPlan, FloorPlanSave, PlanPlacement } from "../api/client.js";

export interface DraftTable {
  key: string;
  id: string | null;
  liveTableId: string | null;
  label: string;
  seats: number | null;
  fixed: boolean;
  placement: PlanPlacement | null;
}

export interface DraftJoin {
  key: string;
  seats: number;
  tableKeys: string[];
}

export interface FloorPlanDraft {
  tables: DraftTable[];
  joins: DraftJoin[];
}

type TablePatch = Partial<Pick<DraftTable, "label" | "seats" | "fixed" | "placement">>;

const MIN_JOIN_TABLES = 2;

function keyOf(table: { id: string | null; liveTableId: string | null }): string {
  return table.id ?? `live:${table.liveTableId}`;
}

export function draftFromPlan(plan: FloorPlan): FloorPlanDraft {
  return {
    tables: plan.tables.map((t) => ({
      key: keyOf(t),
      id: t.id,
      liveTableId: t.liveTableId,
      label: t.label,
      seats: t.seats,
      fixed: t.fixed,
      placement: t.placement === null ? null : { ...t.placement },
    })),
    joins: plan.joins.map((j) => ({ key: j.id, seats: j.seats, tableKeys: [...j.tableIds] })),
  };
}

export function saveFromDraft(revision: number, draft: FloorPlanDraft): FloorPlanSave {
  return {
    revision,
    tables: draft.tables.map((t) => ({
      ...(t.id !== null
        ? { id: t.id }
        : t.liveTableId !== null
          ? { liveTableId: t.liveTableId }
          : {}),
      key: t.key,
      label: t.label,
      seats: t.seats,
      fixed: t.fixed,
      placement: t.placement,
    })),
    joins: draft.joins.map((j) => ({ seats: j.seats, tableKeys: [...j.tableKeys] })),
  };
}

/** After a save: each key the answer names becomes that master id, as key and id (decision 4). */
export function rekeyDraft(
  draft: FloorPlanDraft,
  ids: Readonly<Record<string, string>>,
): FloorPlanDraft {
  const rekey = (key: string): string => (Object.hasOwn(ids, key) ? ids[key]! : key);
  return {
    tables: draft.tables.map((t) =>
      Object.hasOwn(ids, t.key) ? { ...t, key: ids[t.key]!, id: ids[t.key]! } : t,
    ),
    joins: draft.joins.map((j) => ({ ...j, tableKeys: j.tableKeys.map(rekey) })),
  };
}

function sameTable(a: DraftTable, b: DraftTable): boolean {
  if (
    a.id !== b.id ||
    a.liveTableId !== b.liveTableId ||
    a.label !== b.label ||
    a.seats !== b.seats ||
    a.fixed !== b.fixed
  ) {
    return false;
  }
  const p = a.placement;
  const q = b.placement;
  if (p === null || q === null) return p === q;
  return (
    p.x === q.x &&
    p.y === q.y &&
    p.width === q.width &&
    p.height === q.height &&
    p.shape === q.shape &&
    p.rotation === q.rotation
  );
}

function joinSignatures(joins: readonly DraftJoin[]): string[] {
  return joins.map((j) => JSON.stringify([j.seats, [...j.tableKeys].sort()])).sort();
}

/** Same tables by key with the same values, and the same joins as sets of members with their seats. */
export function sameDraft(a: FloorPlanDraft, b: FloorPlanDraft): boolean {
  if (a.tables.length !== b.tables.length || a.joins.length !== b.joins.length) return false;
  const byKey = new Map(b.tables.map((t) => [t.key, t]));
  for (const t of a.tables) {
    const other = byKey.get(t.key);
    if (other === undefined || !sameTable(t, other)) return false;
  }
  const left = joinSignatures(a.joins);
  const right = joinSignatures(b.joins);
  return left.every((s, i) => s === right[i]);
}

export function checkDraft(
  draft: FloorPlanDraft,
): { key: string; problem: "label_missing" | "label_repeated" } | null {
  const seen = new Set<string>();
  for (const t of draft.tables) {
    const label = t.label.trim();
    if (label === "") return { key: t.key, problem: "label_missing" };
    if (seen.has(label)) return { key: t.key, problem: "label_repeated" };
    seen.add(label);
  }
  return null;
}

export function isAdoptable(table: DraftTable): boolean {
  return table.id === null && table.liveTableId !== null;
}

function mapTable(
  draft: FloorPlanDraft,
  key: string,
  change: (table: DraftTable) => DraftTable,
): FloorPlanDraft {
  if (!draft.tables.some((t) => t.key === key)) return draft;
  return { ...draft, tables: draft.tables.map((t) => (t.key === key ? change(t) : t)) };
}

export function patchTable(draft: FloorPlanDraft, key: string, patch: TablePatch): FloorPlanDraft {
  const copied =
    patch.placement === undefined || patch.placement === null
      ? patch
      : { ...patch, placement: { ...patch.placement } };
  return mapTable(draft, key, (t) => ({ ...t, ...copied }));
}

export function moveTable(
  draft: FloorPlanDraft,
  key: string,
  x: number,
  y: number,
): FloorPlanDraft {
  return mapTable(draft, key, (t) =>
    t.placement === null ? t : { ...t, placement: { ...t.placement, x, y } },
  );
}

export function rotateTable(draft: FloorPlanDraft, key: string, rotation: number): FloorPlanDraft {
  return mapTable(draft, key, (t) =>
    t.placement === null ? t : { ...t, placement: { ...t.placement, rotation } },
  );
}

export function placeTable(draft: FloorPlanDraft, key: string): FloorPlanDraft {
  if (draft.tables.find((t) => t.key === key)?.placement != null) return draft;
  const placed = draft.tables.flatMap((t) =>
    t.placement === null || t.key === key ? [] : [t.placement],
  );
  const spot = firstFreeSpot(placed);
  return patchTable(draft, key, {
    placement: {
      x: clampToGrid(spot.x),
      y: clampToGrid(spot.y),
      width: NEW_TABLE_SIZE,
      height: NEW_TABLE_SIZE,
      shape: "rect",
      rotation: 0,
    },
  });
}

export function deleteTable(draft: FloorPlanDraft, key: string): FloorPlanDraft {
  const target = draft.tables.find((t) => t.key === key);
  if (target === undefined || isAdoptable(target)) return draft;
  return {
    tables: draft.tables.filter((t) => t.key !== key),
    joins: draft.joins.flatMap((j) => {
      const tableKeys = j.tableKeys.filter((k) => k !== key);
      return tableKeys.length < MIN_JOIN_TABLES ? [] : [{ ...j, tableKeys }];
    }),
  };
}

/** Puts a table back, as given, after the others, with each of `joins` through it whose other
 *  tables the draft still holds. A join through the table cannot already be in the draft. */
export function restoreTable(
  draft: FloorPlanDraft,
  table: DraftTable,
  joins: readonly DraftJoin[] = [],
): FloorPlanDraft {
  if (draft.tables.some((t) => t.key === table.key)) return draft;
  const placement = table.placement === null ? null : { ...table.placement };
  const tables = [...draft.tables, { ...table, placement }];
  const present = new Set(tables.map((t) => t.key));
  const back = joins.filter(
    (j) => j.tableKeys.includes(table.key) && j.tableKeys.every((k) => present.has(k)),
  );
  return {
    tables,
    joins: [...draft.joins, ...back.map((j) => ({ ...j, tableKeys: [...j.tableKeys] }))],
  };
}

export function addTables(
  draft: FloorPlanDraft,
  tables: { label: string; seats: number | null; fixed: boolean }[],
  nextKey: () => string,
): FloorPlanDraft {
  return {
    ...draft,
    tables: [
      ...draft.tables,
      ...tables.map((t) => ({
        key: nextKey(),
        id: null,
        liveTableId: null,
        label: t.label,
        seats: t.seats,
        fixed: t.fixed,
        placement: null,
      })),
    ],
  };
}

export function addJoin(
  draft: FloorPlanDraft,
  tableKeys: string[],
  seats: number,
  key: string,
): FloorPlanDraft {
  return { ...draft, joins: [...draft.joins, { key, seats, tableKeys: [...tableKeys] }] };
}

export function removeJoin(draft: FloorPlanDraft, joinKey: string): FloorPlanDraft {
  if (!draft.joins.some((j) => j.key === joinKey)) return draft;
  return { ...draft, joins: draft.joins.filter((j) => j.key !== joinKey) };
}
