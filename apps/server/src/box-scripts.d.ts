// TypeScript reads no types from a .mjs file without allowJs.
declare module "*/scripts/box/host-protocol.mjs" {
  export const HOST_REPLY_MAX: number;
  export const START_SCREENS: readonly string[];
  export const PARSER_REFUSALS: readonly string[];
  export const REPLY_REFUSALS: Readonly<Record<string, readonly string[]>>;
  export const CHANGE_KINDS: readonly string[];
  export const CHANGE_STATES: readonly string[];
  export const CHANGE_REFUSALS: Readonly<Record<string, readonly string[]>>;
  export const SCAN_SECURITY: readonly string[];
  export const TAG_OUTCOMES: readonly string[];
  export function formatHostRequest(request: {
    verb: string;
    fields: Readonly<Record<string, unknown>>;
    actor: Readonly<Record<string, unknown>>;
  }): string;
  export function parseHostReply(
    verb: string,
    text: unknown,
  ):
    | Readonly<{ kind: "ok"; value: Readonly<Record<string, unknown>> }>
    | Readonly<{ kind: "refused"; reason: string }>
    | Readonly<{ kind: "malformed" }>;
}

declare module "*/scripts/box/wifi-record.mjs" {
  export const WIFI_NO_COPY_REASONS: readonly string[];
  export function isSsidHex(value: unknown): boolean;
}

declare module "*/scripts/box/wifi-boot-copy.mjs" {
  export const WIFI_COPY_STATES: readonly string[];
  export const WIFI_COPY_FAILURES: readonly string[];
}

declare module "*/scripts/box/name-tag.mjs" {
  export function usableVenueName(value: unknown): string | null;
}
