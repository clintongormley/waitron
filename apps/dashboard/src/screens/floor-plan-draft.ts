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
  return {
    tables: draft.tables.map((t) =>
      Object.hasOwn(ids, t.key) ? { ...t, key: ids[t.key]!, id: ids[t.key]! } : t,
    ),
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

export function deleteTable(draft: FloorPlanDraft, key: string): FloorPlanDraft {
  if (!draft.tables.some((t) => t.key === key)) return draft;
  return { ...draft, tables: draft.tables.filter((t) => t.key !== key) };
}

/** Puts a table back, as given, after the others. */
export function restoreTable(draft: FloorPlanDraft, table: DraftTable): FloorPlanDraft {
  if (draft.tables.some((t) => t.key === table.key)) return draft;
  const placement = table.placement === null ? null : { ...table.placement };
  return { ...draft, tables: [...draft.tables, { ...table, placement }] };
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
