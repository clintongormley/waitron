import { createLabelComparator } from "@waitron/shared";
import { NEW_TABLE_SIZE, clampToGrid, firstFreeSpot } from "@waitron/ui";
import type { FloorPlan, FloorPlanSave, PlanPlacement } from "../api/client.js";
import { t } from "../i18n/t.js";

/** The most seats a table may hold. */
export const MAX_SEATS = 999;

export interface DraftTable {
  key: string;
  id: string | null;
  liveTableId: string | null;
  label: string;
  seats: number | null;
  fixed: boolean;
  placement: PlanPlacement | null;
  /** A joined table's part keys, possibly too few; null for a table that is not a joined table. */
  parts: readonly string[] | null;
}

export interface FloorPlanDraft {
  tables: DraftTable[];
}

/** A panel or dialog's new draft for the page; changes sharing a `mergeKey` make one undo step. */
export interface FloorPlanChange {
  draft: FloorPlanDraft;
  mergeKey?: string;
}

export function sendChange(host: EventTarget, draft: FloorPlanDraft, mergeKey?: string): void {
  host.dispatchEvent(
    new CustomEvent<FloorPlanChange>("floor-plan-change", {
      detail: mergeKey === undefined ? { draft } : { draft, mergeKey },
      bubbles: true,
      composed: true,
    }),
  );
}

export function tableName(table: Pick<DraftTable, "label"> | undefined): string {
  return table?.label.trim() || t("floor_plan_editor.unnamed");
}

type TablePatch = Partial<Pick<DraftTable, "label" | "seats" | "fixed" | "placement">>;

export function draftFromPlan(plan: FloorPlan): FloorPlanDraft {
  return {
    tables: plan.tables.map((t) => ({
      key: t.id,
      id: t.id,
      liveTableId: t.liveTableId,
      label: t.label,
      seats: t.seats,
      fixed: t.fixed,
      placement: t.placement === null ? null : { ...t.placement },
      parts: t.partIds.length === 0 ? null : [...t.partIds],
    })),
  };
}

export function saveFromDraft(revision: number, draft: FloorPlanDraft): FloorPlanSave {
  return {
    revision,
    tables: draft.tables.map((t) => ({
      ...(t.id !== null ? { id: t.id } : {}),
      key: t.key,
      label: t.label,
      seats: t.seats,
      fixed: t.fixed,
      placement: t.placement,
      partKeys: t.parts === null ? [] : [...t.parts],
    })),
  };
}

export function rekeyWith(ids: Readonly<Record<string, string>>): (key: string) => string {
  return (key) => (Object.hasOwn(ids, key) ? ids[key]! : key);
}

/** After a save: each key the answer names becomes that master id, as key and id. */
export function rekeyDraft(
  draft: FloorPlanDraft,
  ids: Readonly<Record<string, string>>,
): FloorPlanDraft {
  const rekey = rekeyWith(ids);
  return {
    tables: draft.tables.map((t) => {
      const parts = t.parts === null ? null : t.parts.map(rekey);
      return Object.hasOwn(ids, t.key)
        ? { ...t, key: ids[t.key]!, id: ids[t.key]!, parts }
        : { ...t, parts };
    }),
  };
}

/** Each table keyed as in `from` takes its live table from there; the same draft when none moves. */
export function withLiveTables(draft: FloorPlanDraft, from: FloorPlanDraft): FloorPlanDraft {
  const live = new Map(from.tables.map((t) => [t.key, t.liveTableId]));
  let moved = false;
  const tables = draft.tables.map((t) => {
    const liveTableId = live.get(t.key);
    if (liveTableId == null || liveTableId === t.liveTableId) return t;
    moved = true;
    return { ...t, liveTableId };
  });
  return moved ? { ...draft, tables } : draft;
}

function sameParts(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((key) => set.has(key));
}

function sameTable(a: DraftTable, b: DraftTable): boolean {
  if (
    a.id !== b.id ||
    a.liveTableId !== b.liveTableId ||
    a.label !== b.label ||
    a.seats !== b.seats ||
    a.fixed !== b.fixed ||
    !sameParts(a.parts, b.parts)
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

/** Same tables by key with the same values. */
export function sameDraft(a: FloorPlanDraft, b: FloorPlanDraft): boolean {
  if (a.tables.length !== b.tables.length) return false;
  const byKey = new Map(b.tables.map((t) => [t.key, t]));
  for (const t of a.tables) {
    const other = byKey.get(t.key);
    if (other === undefined || !sameTable(t, other)) return false;
  }
  return true;
}

export type DraftProblem = "label_missing" | "label_repeated" | "parts_too_few";

export function checkDraft(draft: FloorPlanDraft): { key: string; problem: DraftProblem } | null {
  const seen = new Set<string>();
  for (const t of draft.tables) {
    const label = t.label.trim();
    if (label === "") return { key: t.key, problem: "label_missing" };
    if (seen.has(label)) return { key: t.key, problem: "label_repeated" };
    seen.add(label);
    if (t.parts !== null && t.parts.length < 2) return { key: t.key, problem: "parts_too_few" };
  }
  return null;
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

export function changePlacement(
  draft: FloorPlanDraft,
  key: string,
  change: Partial<PlanPlacement>,
): FloorPlanDraft {
  return mapTable(draft, key, (t) =>
    t.placement === null ? t : { ...t, placement: { ...t.placement, ...change } },
  );
}

/** Puts a spare table at `at` as given, overlaps included, or else at the first free spot; with
 *  none it returns `draft` itself, which the tables list reads as no room. */
export function placeTable(draft: FloorPlanDraft, key: string, at?: PlanPlacement): FloorPlanDraft {
  if (draft.tables.find((t) => t.key === key)?.placement != null) return draft;
  if (at !== undefined) return patchTable(draft, key, { placement: at });
  const placed = draft.tables.flatMap((t) =>
    t.placement === null || t.key === key ? [] : [t.placement],
  );
  const spot = firstFreeSpot(placed);
  if (spot === null) return draft;
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

export function joinedTableOf(draft: FloorPlanDraft, key: string): DraftTable | undefined {
  return draft.tables.find((t) => t.parts?.includes(key) === true);
}

/** Deleting a part takes it out of its joined table; a joined table's own delete frees its parts. */
export function deleteTable(draft: FloorPlanDraft, key: string): FloorPlanDraft {
  if (!draft.tables.some((t) => t.key === key)) return draft;
  return {
    ...draft,
    tables: draft.tables.flatMap((t) => {
      if (t.key === key) return [];
      if (t.parts?.includes(key) !== true) return [t];
      return [{ ...t, parts: t.parts.filter((part) => part !== key) }];
    }),
  };
}

/** Puts a table back, as given, after the others. A part re-joins the joined table that held it
 *  in `opened` when that table is in the draft and no other joined table holds the part; a joined
 *  table keeps only the parts `freeTables` would still offer it. */
export function restoreTable(
  draft: FloorPlanDraft,
  table: DraftTable,
  opened: FloorPlanDraft,
): FloorPlanDraft {
  if (draft.tables.some((t) => t.key === table.key)) return draft;
  const placement = table.placement === null ? null : { ...table.placement };
  const free = new Set(freeTables(draft).map((t) => t.key));
  const parts = table.parts === null ? null : table.parts.filter((part) => free.has(part));
  const heldBy = joinedTableOf(opened, table.key)?.key;
  const rejoins = heldBy !== undefined && joinedTableOf(draft, table.key) === undefined;
  const tables = draft.tables.map((t) =>
    rejoins && t.key === heldBy && t.parts !== null ? { ...t, parts: [...t.parts, table.key] } : t,
  );
  return { ...draft, tables: [...tables, { ...table, placement, parts }] };
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
        parts: null,
      })),
    ],
  };
}

export function addJoinedTable(
  draft: FloorPlanDraft,
  table: { label: string; seats: number | null; parts: readonly string[] },
  nextKey: () => string,
): FloorPlanDraft {
  return {
    ...draft,
    tables: [
      ...draft.tables,
      {
        key: nextKey(),
        id: null,
        liveTableId: null,
        label: table.label,
        seats: table.seats,
        fixed: false,
        placement: null,
        parts: [...table.parts],
      },
    ],
  };
}

export function setParts(
  draft: FloorPlanDraft,
  key: string,
  parts: readonly string[],
): FloorPlanDraft {
  return mapTable(draft, key, (t) => ({ ...t, parts: [...parts] }));
}

/** Tables a joined table may be made of: off the plan, not joined tables, and in no joined table
 *  but `joinedKey`. */
export function freeTables(draft: FloorPlanDraft, joinedKey?: string): DraftTable[] {
  const compare = createLabelComparator();
  return draft.tables
    .filter((t) => {
      if (t.placement !== null || t.parts !== null) return false;
      const heldBy = joinedTableOf(draft, t.key);
      return heldBy === undefined || heldBy.key === joinedKey;
    })
    .sort((a, b) => compare(tableName(a), tableName(b)));
}

const NUMBERED = /^(.*\S)\s+(\d+)$/;

/** "Counter 3, 4, 5" when every name is one prefix and a number, else the names joined. */
export function madeOfText(names: readonly string[]): string {
  const numbered: { name: string; prefix: string; number: string }[] = [];
  for (const name of names) {
    const match = NUMBERED.exec(name);
    if (match === null) return names.join(", ");
    numbered.push({ name, prefix: match[1]!, number: match[2]! });
  }
  numbered.sort((a, b) => Number(a.number) - Number(b.number));
  const prefix = numbered[0]?.prefix;
  if (prefix === undefined) return "";
  if (numbered.some((n) => n.prefix !== prefix)) return numbered.map((n) => n.name).join(", ");
  return `${prefix} ${numbered.map((n) => n.number).join(", ")}`;
}
