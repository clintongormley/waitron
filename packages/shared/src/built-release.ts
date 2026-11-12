export type BuiltRelease = { bundled: false } | { bundled: true; version: string | null };

declare const __WAITRON_RELEASE__: unknown;

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Run from source, the server has no stamp; every bundle `scripts/bundle-node.mjs`'s command line
 * builds carries one, `null` when the build is not a release. */
export function builtRelease(): BuiltRelease {
  if (typeof __WAITRON_RELEASE__ === "undefined") return { bundled: false };
  const stamp: unknown = __WAITRON_RELEASE__;
  if (stamp === null || typeof stamp !== "object") return { bundled: true, version: null };
  const version = (stamp as { version?: unknown }).version;
  return {
    bundled: true,
    version: typeof version === "string" && RELEASE_VERSION.test(version) ? version : null,
  };
}
