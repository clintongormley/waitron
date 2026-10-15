// Browser-safe: the staffing grid edits a day's blocks through these, never in place.
import { blockSpan, minuteOfServiceDay, type StaffingBlock } from "./slots.js";

const STEP_MINUTES = 15;
const DAY_MINUTES = 1440;

const copyBlocks = (day: readonly StaffingBlock[]) => day.map((b) => ({ ...b }));

function clockAt(minute: number, cutover: string): string {
  const total =
    (Number(cutover.slice(0, 2)) * 60 + Number(cutover.slice(3, 5)) + minute) % DAY_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** A block saved before a changeover change can cross the new changeover; it ends there, as
 *  `slotsForDay` reads it. */
function span(block: StaffingBlock, cutover: string): { start: number; end: number } {
  const s = blockSpan(block, cutover);
  return s.end > s.start ? s : { start: s.start, end: DAY_MINUTES };
}

export function addBlock(day: readonly StaffingBlock[], block: StaffingBlock): StaffingBlock[] {
  return [...copyBlocks(day), { ...block }];
}

/** Moves one edge to `time`, held inside the business day and at least one quarter hour from the
 *  other edge. An end at the changeover is the day's end. */
export function resizeBlock(
  day: readonly StaffingBlock[],
  index: number,
  edge: "start" | "end",
  time: string,
  cutover: string,
): StaffingBlock[] {
  const blocks = copyBlocks(day);
  const target = blocks[index];
  if (target === undefined) return blocks;
  const { start, end } = span(target, cutover);
  const minute = minuteOfServiceDay(time, cutover);
  const [from, to] =
    edge === "start"
      ? [Math.min(minute, end - STEP_MINUTES), end]
      : [start, Math.max(minute || DAY_MINUTES, start + STEP_MINUTES)];
  target.startsAt = clockAt(from, cutover);
  target.endsAt = clockAt(to, cutover);
  return blocks;
}

export function changeBlock(
  day: readonly StaffingBlock[],
  index: number,
  change: Partial<Pick<StaffingBlock, "staffRoleId" | "headcount">>,
): StaffingBlock[] {
  return day.map((b, at) => (at === index ? { ...b, ...change } : { ...b }));
}

export function deleteBlock(day: readonly StaffingBlock[], index: number): StaffingBlock[] {
  return copyBlocks(day.filter((_, at) => at !== index));
}

/** A null day follows the season, and is copied as null; a day `days` lacks is copied as []. */
export function copyDay<K>(
  days: ReadonlyMap<K, readonly StaffingBlock[] | null>,
  from: K,
  to: readonly K[],
): Map<K, StaffingBlock[] | null> {
  const copy = (day: readonly StaffingBlock[] | null) => (day === null ? null : copyBlocks(day));
  const copied = new Map([...days].map(([key, day]) => [key, copy(day)]));
  const source = days.get(from) ?? (days.has(from) ? null : []);
  for (const key of to) copied.set(key, copy(source));
  return copied;
}

/** Side-by-side layout: each block's lane and the lane count of its overlap group. Lanes fill by
 *  start, the longer of two that start together first; blocks that only touch do not overlap. */
export function laneLayout(
  day: readonly StaffingBlock[],
  cutover: string,
): { lane: number; lanes: number }[] {
  const order = day
    .map((block, index) => ({ index, ...span(block, cutover) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index);
  const layout: { lane: number; lanes: number }[] = day.map(() => ({ lane: 0, lanes: 1 }));
  let group: { index: number; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const { index, lane } of group) layout[index] = { lane, lanes: laneEnds.length };
    group = [];
    laneEnds = [];
  };
  for (const item of order) {
    if (item.start >= groupEnd) close();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    group.push({ index: item.index, lane });
    groupEnd = Math.max(groupEnd, item.end);
  }
  close();
  return layout;
}
