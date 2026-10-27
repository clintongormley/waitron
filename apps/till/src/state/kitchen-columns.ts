export type ColumnKey =
  "overview" | "held" | "toFire" | "inProgress" | "ready" | "waiting" | "preparing";

export interface ColumnScope {
  venueId: string;
  deviceId: string;
  screen: "pass" | "pass_monitor" | "station";
  stationId?: string;
}

export interface ColumnState {
  order: ColumnKey[];
  hidden: ColumnKey[];
  collapsed: ColumnKey[];
}

export const STATION_COLUMNS: ColumnState = {
  order: ["waiting", "preparing", "ready"],
  hidden: [],
  collapsed: [],
};

const VERSION = 1;

/** No key without a venue and a device, so layouts never share storage across absent identity. */
function keyOf({ venueId, deviceId, screen, stationId }: ColumnScope): string | null {
  if (venueId === "" || deviceId === "") return null;
  return `waitron.kitchenColumns.v1.${JSON.stringify([venueId, deviceId, screen, stationId ?? ""])}`;
}

function copy(state: ColumnState): ColumnState {
  return { order: [...state.order], hidden: [...state.hidden], collapsed: [...state.collapsed] };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function registeredOnce(values: string[], registered: ColumnKey[]): ColumnKey[] {
  const kept: ColumnKey[] = [];
  for (const value of values) {
    const key = registered.find((candidate) => candidate === value);
    if (key !== undefined && !kept.includes(key)) kept.push(key);
  }
  return kept;
}

function sanitise(raw: string, defaults: ColumnState): ColumnState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, order, hidden, collapsed } = parsed as Record<string, unknown>;
  if (version !== VERSION) return null;
  if (!isStringArray(order) || !isStringArray(hidden) || !isStringArray(collapsed)) return null;

  const registered = defaults.order;
  const state: ColumnState = {
    order: registeredOnce(order, registered),
    hidden: registeredOnce(hidden, registered),
    collapsed: registeredOnce(collapsed, registered),
  };
  registered.forEach((key, index) => {
    if (state.order.includes(key)) return;
    const before = registered
      .slice(0, index)
      .reverse()
      .find((earlier) => state.order.includes(earlier));
    state.order.splice(before === undefined ? 0 : state.order.indexOf(before) + 1, 0, key);
    if (defaults.hidden.includes(key)) state.hidden.push(key);
    if (defaults.collapsed.includes(key)) state.collapsed.push(key);
  });
  return state;
}

export function readColumnState(
  storage: Pick<Storage, "getItem">,
  scope: ColumnScope,
  defaults: ColumnState,
): ColumnState {
  const key = keyOf(scope);
  if (key === null) return copy(defaults);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return copy(defaults);
  }
  if (raw === null) return copy(defaults);
  return sanitise(raw, defaults) ?? copy(defaults);
}

export function saveColumnState(
  storage: Pick<Storage, "setItem">,
  scope: ColumnScope,
  state: ColumnState,
): void {
  const key = keyOf(scope);
  if (key === null) return;
  const { order, hidden, collapsed } = state;
  try {
    storage.setItem(key, JSON.stringify({ version: VERSION, order, hidden, collapsed }));
  } catch {
    // A full or refused store saves nothing; the caller still holds the state it passed in.
  }
}

export function moveColumn(
  state: ColumnState,
  key: ColumnKey,
  direction: "up" | "down",
): ColumnState {
  const next = copy(state);
  const from = next.order.indexOf(key);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= next.order.length) return next;
  next.order[from] = next.order[to]!;
  next.order[to] = key;
  return next;
}

export function toggleColumnCollapsed(state: ColumnState, key: ColumnKey): ColumnState {
  const next = copy(state);
  next.collapsed = state.collapsed.includes(key)
    ? state.collapsed.filter((collapsed) => collapsed !== key)
    : [...state.collapsed, key];
  return next;
}

export function setColumnVisible(
  state: ColumnState,
  key: ColumnKey,
  visible: boolean,
): ColumnState {
  const next = copy(state);
  const without = state.hidden.filter((hidden) => hidden !== key);
  next.hidden = visible ? without : [...without, key];
  return next;
}
