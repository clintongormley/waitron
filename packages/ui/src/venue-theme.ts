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
let fetchOptions: VenueThemeOptions = {};
let wantedHash: string | null = null;
// Fetches and applications share one count, so an answer applies only if nothing was applied
// after its fetch was sent.
let clock = 0;
let appliedAt = 0;

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

async function fetchAnswer(): Promise<void> {
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
    if (controller.signal.aborted || !response.ok) return;
    const answer: unknown = await response.json();
    if (controller.signal.aborted || appliedAt > sentAt) return;
    applyVenueTheme(answer);
  } catch {
    // A failed request, a cancelled one, or a body that is not JSON leaves the sheet as it is.
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) settle();
  }
}

// The wanted hash is cleared when its follow-up is sent, so a failing server is asked again only
// on the next followVenueTheme call, never from this settle.
function settle(): void {
  inFlight = null;
  const wanted = wantedHash;
  wantedHash = null;
  if (wanted !== null && wanted !== appliedHash) void fetchAnswer();
}

export function startVenueTheme(root: HTMLElement, options: VenueThemeOptions = {}): void {
  adopt(root);
  started = true;
  const stored = readStored();
  sheet.replaceSync(stored?.css ?? "");
  appliedHash = stored?.hash ?? null;
  fetchOptions = options;
  wantedHash = null;
  inFlight?.abort();
  void fetchAnswer();
}

export function followVenueTheme(hash: string): void {
  if (!started) return;
  if (inFlight !== null) {
    wantedHash = hash;
    return;
  }
  if (hash !== appliedHash) void fetchAnswer();
}

export function applyVenueTheme(answer: unknown): void {
  if (!started || !isVenueThemeAnswer(answer)) return;
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
