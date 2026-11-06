// TypeScript reads no types from a .mjs file without allowJs.
declare module "*/scripts/box/host-protocol.mjs" {
  export const HOST_REPLY_MAX: number;
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
