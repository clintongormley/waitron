import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { LeaveOutcome } from "@waitron/ui-core/unsaved-changes";
import {
  NavigationGuard,
  navigationGuardFor,
  observeNavigation,
  type NavigationLeave,
} from "./navigation-guard.js";

export interface UrlPathConfig {
  /** App path prefix without a trailing slash. */
  basePath: string;
  primary: string;
  /** Navigation field → path label, grouped by primary destination; * applies to every destination. */
  children: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Destinations whose unlisted `<key>/<value>` pairs a write keeps, as the address spells them,
   *  while the destination stays the same. */
  keepUnlisted?: readonly string[];
  leave?: NavigationLeave;
}

export function encodePathSegment(value: string): string {
  // Empty selections and dot-only identifiers must survive URL path normalization.
  if (value === "" || value === "." || value === "..") return `~${value}`;
  return encodeURIComponent(value).replaceAll("~", "%7E");
}

export function decodePathSegment(value: string): string {
  if (value === "~" || value === "~." || value === "~..") return value.slice(1);
  return decodeURIComponent(value);
}

/** Paths carry navigation identifiers; the owning screen validates their meaning. */
export class UrlStateController implements ReactiveController {
  private stopObserving?: () => void;
  private ownedGuard?: NavigationGuard;
  constructor(
    private readonly host: ReactiveControllerHost & HTMLElement,
    private readonly restore: (event?: Event) => void,
    private readonly config: UrlPathConfig,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    if (this.config.leave) this.ownedGuard = new NavigationGuard(window, this.config.leave);
    this.stopObserving = observeNavigation(window, this.restore);
    this.restore();
  }

  hostDisconnected(): void {
    this.stopObserving?.();
    this.ownedGuard?.dispose();
    this.ownedGuard = undefined;
  }

  #children(primary: string): Readonly<Record<string, string>> {
    return this.config.children[primary] ?? this.config.children["*"] ?? {};
  }

  #parts(): string[] {
    const prefix = `${this.config.basePath}/`;
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    return url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length).split("/") : [];
  }

  #read(): Record<string, string | null> {
    const parts = this.#parts();
    if (!parts[0]) return {};
    try {
      const primary = decodePathSegment(parts[0]);
      const values: Record<string, string | null> = { [this.config.primary]: primary };
      const fields = this.#children(primary);
      for (let i = 1; i + 1 < parts.length; i += 2) {
        const key = Object.keys(fields).find((key) => fields[key] === parts[i]);
        if (key !== undefined) values[key] = decodePathSegment(parts[i + 1]!);
      }
      return values;
    } catch {
      return {};
    }
  }

  read(key: string): string | null {
    return this.#read()[key] ?? null;
  }

  write(
    changes: Record<string, string | null>,
    replace = false,
    removeQuery: readonly string[] = [],
  ): void | Promise<LeaveOutcome> {
    if (!this.host.isConnected) return;
    const current = this.#read();
    const values = { ...current, ...changes };
    const primary = values[this.config.primary];
    const parts: string[] = [];
    if (primary != null) {
      parts.push(encodePathSegment(primary));
      const children = Object.entries(this.#children(primary));
      const pending = new Map(children);
      const add = (key: string, segment: string) => {
        const value = values[key];
        if (value != null) parts.push(segment, encodePathSegment(value));
      };
      // Pairs stay in the address's order, so a rewrite that changes nothing writes nothing.
      if (primary === current[this.config.primary] && this.config.keepUnlisted?.includes(primary)) {
        const keys = new Map(children.map(([key, segment]) => [segment, key]));
        const path = this.#parts();
        for (let i = 1; i + 1 < path.length; i += 2) {
          const key = keys.get(path[i]!);
          if (key === undefined) parts.push(path[i]!, path[i + 1]!);
          else if (pending.delete(key)) add(key, path[i]!);
        }
      }
      for (const [key, segment] of pending) add(key, segment);
    }
    const guard = navigationGuardFor(window);
    const url = new URL(guard?.href ?? location.href);
    url.pathname = `${this.config.basePath}/${parts.join("/")}`;
    for (const key of removeQuery) url.searchParams.delete(key);
    if (guard) return guard.write(url, replace);
    if (url.href === location.href) return;
    if (replace) history.replaceState(history.state, "", url);
    else history.pushState(history.state, "", url);
  }
}
