import { isVenueThemeAnswer, type VenueThemeAnswer } from "@waitron/ui-core/theme";

export { isVenueThemeAnswer, type VenueThemeAnswer };

export const VENUE_THEME_STORAGE_KEY = "waitron-venue-theme";
export const VENUE_THEME_TIME_LIMIT_MS = 5_000;

export interface VenueThemeOptions {
  /** Defaults to the global `fetch`, read when each request is sent. */
  readonly fetchImpl?: typeof fetch;
  readonly timeLimitMs?: number;
}

const sheet = new CSSStyleSheet();
let started = false;
let appliedHash: string | null = null;
let inFlight: AbortController | null = null;

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

function adopt(root: HTMLElement): void {
  const doc = root.getRootNode() as Document | ShadowRoot;
  const target = "adoptedStyleSheets" in doc ? doc : document;
  if (!target.adoptedStyleSheets.includes(sheet)) {
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  }
}

async function fetchAnswer(fetchImpl: typeof fetch | undefined, timeLimitMs: number) {
  const controller = new AbortController();
  inFlight = controller;
  const timer = setTimeout(() => controller.abort(), timeLimitMs);
  try {
    const response = await (fetchImpl ?? fetch)("/api/theme", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (controller.signal.aborted || !response.ok) return;
    const answer: unknown = await response.json();
    if (controller.signal.aborted) return;
    applyVenueTheme(answer);
  } catch {
    // A failed request, a cancelled one, or a body that is not JSON leaves the sheet as it is.
  } finally {
    clearTimeout(timer);
  }
}

export function startVenueTheme(root: HTMLElement, options: VenueThemeOptions = {}): void {
  adopt(root);
  started = true;
  const stored = readStored();
  sheet.replaceSync(stored?.css ?? "");
  appliedHash = stored?.hash ?? null;
  inFlight?.abort();
  void fetchAnswer(options.fetchImpl, options.timeLimitMs ?? VENUE_THEME_TIME_LIMIT_MS);
}

export function applyVenueTheme(answer: unknown): void {
  if (!started || !isVenueThemeAnswer(answer) || answer.hash === appliedHash) return;
  sheet.replaceSync(answer.css);
  appliedHash = answer.hash;
  try {
    window.localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
  } catch {
    // The copy stored before stays, and the next start paints it until an answer arrives.
  }
}
