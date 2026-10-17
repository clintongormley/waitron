import type { CalendarColour } from "../hours-types.js";
import {
  byStart,
  seasonLastDay,
  seasonOnSorted,
  type Season,
  type SeasonChange,
  type SeasonEntry,
} from "../season-rules.js";
import { firstUnusedCalendarColour } from "./calendar-colours.js";

/** One row of the Seasons window: `key` is the season's id, or `new-<n>` for a row not yet saved. */
export interface SeasonRow {
  key: string;
  id?: string;
  name: string;
  /** Unpadded, as the Day combobox holds it. */
  day: string;
  /** `MM`. */
  month: string;
  colour: CalendarColour;
}

export interface SeasonDraft {
  rows: readonly SeasonRow[];
  /** Ids of stored seasons the person has binned. */
  deleted: readonly string[];
  /** The number the next new row's key takes; it only grows, so a key is never reused. */
  next: number;
}

type RowError = "required" | "taken";
export type SeasonRowErrors = Partial<Record<"name" | "startsOn", RowError>>;

/** 29 February is never a start, so February always offers 28 days. */
export const daysIn = (month: string): number =>
  month === "02" ? 28 : new Date(Date.UTC(2001, Number(month), 0)).getUTCDate();

const rowOf = (season: Season): SeasonRow => ({
  key: season.id,
  id: season.id,
  name: season.name,
  day: String(Number(season.startsOn.slice(3))),
  month: season.startsOn.slice(0, 2),
  colour: season.colour,
});

const startOf = (row: SeasonRow): string | null =>
  row.day && row.month ? `${row.month}-${row.day.padStart(2, "0")}` : null;

/** The seasons as rows: the season in force on 1 January first, then the rest by start. */
export function draftOf(seasons: readonly Season[]): SeasonDraft {
  const sorted = byStart(seasons);
  const first = seasonOnSorted(sorted, "2001-01-01");
  const at = first ? sorted.indexOf(first) : 0;
  return { rows: [...sorted.slice(at), ...sorted.slice(0, at)].map(rowOf), deleted: [], next: 1 };
}

const sameRow = (a: SeasonRow, b: SeasonRow): boolean =>
  a.id === b.id &&
  a.name.trim() === b.name.trim() &&
  a.day === b.day &&
  a.month === b.month &&
  a.colour === b.colour;

/** Whether two drafts hold the same rows, matched by key and names trimmed, and bin the same seasons. */
export function sameDraft(a: SeasonDraft, b: SeasonDraft): boolean {
  if (a.rows.length !== b.rows.length || a.deleted.length !== b.deleted.length) return false;
  const others = new Map(b.rows.map((row) => [row.key, row]));
  return (
    a.rows.every((row) => {
      const other = others.get(row.key);
      return other !== undefined && sameRow(row, other);
    }) && a.deleted.every((id) => b.deleted.includes(id))
  );
}

/** The draft with a blank new row at the end, in the first colour no row has. */
export function addRow(draft: SeasonDraft): SeasonDraft {
  const row: SeasonRow = {
    key: `new-${draft.next}`,
    name: "",
    day: "",
    month: "",
    colour: firstUnusedCalendarColour(draft.rows),
  };
  return { ...draft, rows: [...draft.rows, row], next: draft.next + 1 };
}

/** The draft without the row; a stored season still in `stored` is binned to be deleted. */
export function removeRow(draft: SeasonDraft, key: string, stored: readonly Season[]): SeasonDraft {
  const removed = draft.rows.find((row) => row.key === key);
  const rows = draft.rows.filter((row) => row.key !== key);
  const id = removed?.id;
  const deleted =
    id !== undefined && stored.some((season) => season.id === id)
      ? [...draft.deleted, id]
      : draft.deleted;
  return { ...draft, rows, deleted };
}

/** The `MM-DD` the row's season runs until among the rows with a whole start, or null. */
export function runsUntil(rows: readonly SeasonRow[], key: string): string | null {
  const row = rows.find((candidate) => candidate.key === key);
  const start = row ? startOf(row) : null;
  if (start === null) return null;
  const starts = rows.flatMap((candidate) => {
    const startsOn = startOf(candidate);
    return startsOn === null ? [] : [{ startsOn }];
  });
  return seasonLastDay(starts, start);
}

/** Each row's field errors, by key; a row with none has no entry. */
export function rowErrors(rows: readonly SeasonRow[]): Map<string, SeasonRowErrors> {
  const count = (values: (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const nameOf = (row: SeasonRow) => row.name.trim() || null;
  const names = count(rows.map(nameOf));
  const starts = count(rows.map(startOf));
  const errors = new Map<string, SeasonRowErrors>();
  for (const row of rows) {
    const found: SeasonRowErrors = {};
    const name = nameOf(row);
    const start = startOf(row);
    if (name === null) found.name = "required";
    else if (names.get(name)! > 1) found.name = "taken";
    if (start === null) found.startsOn = "required";
    else if (starts.get(start)! > 1) found.startsOn = "taken";
    if (found.name || found.startsOn) errors.set(row.key, found);
  }
  return errors;
}

const entryOf = (row: SeasonRow): SeasonEntry => ({
  ...(row.id === undefined ? {} : { id: row.id }),
  name: row.name.trim(),
  startsOn: startOf(row) ?? "",
  colour: row.colour,
});

/**
 * The one change that turns `baseline` into `draft`: new rows, stored rows that differ from their
 * baseline row once trimmed and padded, and the binned seasons. `keys[i]` is the row of `save[i]`.
 */
export function seasonChange(
  draft: SeasonDraft,
  baseline: SeasonDraft,
): { change: SeasonChange; keys: string[] } {
  const before = new Map(baseline.rows.map((row) => [row.key, entryOf(row)]));
  const save: SeasonEntry[] = [];
  const keys: string[] = [];
  for (const row of draft.rows) {
    const entry = entryOf(row);
    const was = before.get(row.key);
    if (
      row.id === undefined ||
      was === undefined ||
      was.name !== entry.name ||
      was.startsOn !== entry.startsOn ||
      was.colour !== entry.colour
    ) {
      save.push(entry);
      keys.push(row.key);
    }
  }
  return { change: { save, delete: [...draft.deleted] }, keys };
}

const sameStart = (a: SeasonRow, b: SeasonRow) => a.day === b.day && a.month === b.month;

/**
 * Fold a newer season list into an open draft. A clean draft becomes the new list. In a dirty one,
 * each stored row keeps the fields the person changed (name, start, colour) and takes the rest from
 * the new list; a season new to the list is appended; a season gone from it is dropped when
 * untouched and kept, its key in `gone`, when touched; new rows are left alone. The baseline
 * becomes the new list.
 */
export function mergeSeasonDraft(
  draft: SeasonDraft,
  baseline: SeasonDraft,
  latest: readonly Season[],
): { draft: SeasonDraft; baseline: SeasonDraft; gone: string[] } {
  const fresh = draftOf(latest);
  if (sameDraft(draft, baseline))
    return { draft: { ...fresh, next: draft.next }, baseline: fresh, gone: [] };

  const was = new Map(baseline.rows.map((row) => [row.key, row]));
  const now = new Map(fresh.rows.map((row) => [row.key, row]));
  const rows: SeasonRow[] = [];
  for (const row of draft.rows) {
    if (row.id === undefined) {
      rows.push(row);
      continue;
    }
    const before = was.get(row.key);
    const after = now.get(row.key);
    if (after === undefined) {
      // A row with no baseline row is one already kept as gone by an earlier merge.
      if (before === undefined || !sameRow(row, before)) rows.push(row);
      continue;
    }
    const base = before ?? after;
    rows.push({
      ...after,
      name: row.name.trim() === base.name.trim() ? after.name : row.name,
      ...(sameStart(row, base) ? {} : { day: row.day, month: row.month }),
      colour: row.colour === base.colour ? after.colour : row.colour,
    });
  }
  const deleted = draft.deleted.filter((id) => now.has(id));
  const placed = new Set([...rows.map((row) => row.key), ...deleted]);
  const added = fresh.rows.filter((row) => !placed.has(row.key));
  const kept = new Set(rows.map((row) => row.key));
  const merged: SeasonDraft = { rows: [...rows, ...added], deleted, next: draft.next };
  const nextBaseline: SeasonDraft = {
    rows: [
      ...rows.flatMap((row) => now.get(row.key) ?? []),
      ...fresh.rows.filter((row) => !kept.has(row.key)),
    ],
    deleted: [],
    next: fresh.next,
  };
  return { draft: merged, baseline: nextBaseline, gone: goneKeys(merged, nextBaseline) };
}

/** The stored rows in the draft whose season the baseline no longer holds. */
export function goneKeys(draft: SeasonDraft, baseline: SeasonDraft): string[] {
  const held = new Set(baseline.rows.map((row) => row.key));
  return draft.rows.flatMap((row) => (row.id !== undefined && !held.has(row.key) ? [row.key] : []));
}
