import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  isVenueThemeAnswer,
  type VenueLogoAddresses,
  type VenueThemeAnswer,
} from "@waitron/ui-core/theme";

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

export type VenueLogoState =
  | { readonly kind: "waiting" }
  | { readonly kind: "none" }
  | { readonly kind: "logo"; readonly logo: VenueLogoAddresses; readonly failed: boolean };

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

const WAITING: VenueLogoState = { kind: "waiting" };
const NONE: VenueLogoState = { kind: "none" };
let logoState: VenueLogoState = NONE;
const failedLogos = new Set<string>();
const logoListeners = new Set<() => void>();

function logoKey(logo: VenueLogoAddresses): string {
  return JSON.stringify([logo.light, logo.dark]);
}

function stateKey(state: VenueLogoState): string {
  return state.kind === "logo" ? JSON.stringify([logoKey(state.logo), state.failed]) : state.kind;
}

function setLogoState(next: VenueLogoState): void {
  if (stateKey(logoState) === stateKey(next)) return;
  logoState = next;
  for (const listener of logoListeners) listener();
}

function settleLogo(logo: VenueLogoAddresses | null): void {
  setLogoState(
    logo === null ? NONE : { kind: "logo", logo, failed: failedLogos.has(logoKey(logo)) },
  );
}

/** The start's own request ending with nothing applied ends its wait; a dropped one does not. */
function endWait(controller: AbortController): void {
  if (inFlight === controller && logoState.kind === "waiting") setLogoState(NONE);
}

export function currentVenueLogo(): VenueLogoState {
  return logoState;
}

export function subscribeVenueLogo(listener: () => void): () => void {
  logoListeners.add(listener);
  return () => {
    logoListeners.delete(listener);
  };
}

function reportVenueLogo(logo: VenueLogoAddresses, failed: boolean): void {
  const key = logoKey(logo);
  if (failed) failedLogos.add(key);
  else failedLogos.delete(key);
  if (logoState.kind === "logo") settleLogo(logoState.logo);
}

export function reportVenueLogoFailure(logo: VenueLogoAddresses): void {
  reportVenueLogo(logo, true);
}

export function reportVenueLogoLoaded(logo: VenueLogoAddresses): void {
  reportVenueLogo(logo, false);
}

export class VenueLogoController implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  readonly #onChange: ((state: VenueLogoState) => void) | undefined;
  #unsubscribe?: () => void;

  constructor(host: ReactiveControllerHost, onChange?: (state: VenueLogoState) => void) {
    this.#host = host;
    this.#onChange = onChange;
    host.addController(this);
  }

  get state(): VenueLogoState {
    return logoState;
  }

  hostConnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = subscribeVenueLogo(() => {
      this.#host.requestUpdate();
      this.#onChange?.(logoState);
    });
    // A host out of the page while the logo changed has not redrawn since.
    this.#host.requestUpdate();
  }

  hostDisconnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}

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
  const timer = setTimeout(() => {
    controller.abort();
    endWait(controller);
  }, fetchOptions.timeLimitMs ?? VENUE_THEME_TIME_LIMIT_MS);
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
    endWait(controller);
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
  failedLogos.clear();
  if (stored === null) setLogoState(WAITING);
  else settleLogo(stored.logo);
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
  settleLogo(answer.logo);
  if (answer.hash === appliedHash) return;
  sheet.replaceSync(answer.css);
  appliedHash = answer.hash;
  try {
    window.localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
  } catch {
    // The copy stored before stays, and the next start paints it until an answer arrives.
  }
}
