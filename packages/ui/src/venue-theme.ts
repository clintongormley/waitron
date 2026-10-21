import { isVenueThemeAnswer, type VenueThemeAnswer } from "@waitron/ui-core/theme";

export const VENUE_THEME_STORAGE_KEY = "waitron-venue-theme";
export const VENUE_THEME_TIME_LIMIT_MS = 5_000;

export interface VenueThemeOptions {
  /** Defaults to the global `fetch`, read when each request is sent. */
  readonly fetchImpl?: typeof fetch;
  readonly timeLimitMs?: number;
}

export interface VenueThemeReading {
  readonly answer: unknown;
  readonly sentAt: number;
}

let sheet: CSSStyleSheet | null = null;
let appliedHash: string | null = null;
let inFlight: AbortController | null = null;
let fetchOptions: VenueThemeOptions = {};
let wantedHash: string | null = null;
// Reads and applications share one count, so an answer applies only if nothing was applied after
// its read was sent.
let clock = 0;
let appliedAt = 0;
let startupReading: Promise<VenueThemeReading | null> | null = null;

function readStored(): VenueThemeAnswer | null {
  try {
    const text = window.localStorage.getItem(VENUE_THEME_STORAGE_KEY);
    if (text === null) return null;
    const stored: unknown = JSON.parse(text);
    return isVenueThemeAnswer(stored) ? stored : null;
  } catch {
    return null;
  }
}

function adopt(root: HTMLElement, sheet: CSSStyleSheet): void {
  const doc = root.getRootNode() as Document | ShadowRoot;
  const target = "adoptedStyleSheets" in doc ? doc : document;
  if (!target.adoptedStyleSheets.includes(sheet)) {
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  }
}

async function fetchAnswer(): Promise<VenueThemeReading | null> {
  const controller = new AbortController();
  inFlight = controller;
  const sentAt = ++clock;
  const timer = setTimeout(
    () => controller.abort(),
    fetchOptions.timeLimitMs ?? VENUE_THEME_TIME_LIMIT_MS,
  );
  try {
    const response = await (fetchOptions.fetchImpl ?? fetch)("/api/theme", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (controller.signal.aborted || !response.ok) return null;
    const answer: unknown = await response.json();
    if (controller.signal.aborted || !isVenueThemeAnswer(answer)) return null;
    applyVenueTheme(answer, sentAt);
    return { answer, sentAt };
  } catch {
    // A failed request, a cancelled one, or a body that is not JSON leaves the sheet as it is.
    return null;
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) settle();
  }
}

function settle(): void {
  inFlight = null;
  const wanted = wantedHash;
  wantedHash = null;
  if (wanted !== null && wanted !== appliedHash) void fetchAnswer();
}

export function startVenueTheme(root: HTMLElement, options: VenueThemeOptions = {}): void {
  sheet ??= new CSSStyleSheet();
  adopt(root, sheet);
  const stored = readStored();
  sheet.replaceSync(stored?.css ?? "");
  appliedHash = stored?.hash ?? null;
  fetchOptions = options;
  wantedHash = null;
  inFlight?.abort();
  startupReading = fetchAnswer();
}

/** Numbers `read` when it is sent, for `applyVenueTheme`. The first call after a start takes the
 * start-up fetch's answer instead, when that fetch got one. */
export async function readVenueTheme(read: () => Promise<unknown>): Promise<VenueThemeReading> {
  const startup = startupReading;
  startupReading = null;
  const reused = startup === null ? null : await startup;
  if (reused !== null) return reused;
  const sentAt = ++clock;
  return { answer: await read(), sentAt };
}

export function followVenueTheme(hash: string): void {
  if (sheet === null) return;
  if (inFlight !== null) {
    wantedHash = hash;
    return;
  }
  if (hash !== appliedHash) void fetchAnswer();
}

/** Applies `answer` unless something was applied after it was sent; with no `sentAt`, it counts as
 * sent now. */
export function applyVenueTheme(answer: unknown, sentAt: number = clock): void {
  if (sheet === null || !isVenueThemeAnswer(answer) || appliedAt > sentAt) return;
  appliedAt = ++clock;
  if (answer.hash === appliedHash) return;
  sheet.replaceSync(answer.css);
  appliedHash = answer.hash;
  try {
    window.localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
  } catch {
    // The copy stored before stays, and the next start paints it until an answer arrives.
  }
}
