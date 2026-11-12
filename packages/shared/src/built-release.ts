export type BuiltRelease = { bundled: false } | { bundled: true; version: string | null };

declare const __WAITRON_RELEASE_VERSION__: unknown;

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// The length bound is the record's: @waitron/verifactu 0.2.1 refuses a `SistemaInformatico.Version`
// over 50 characters (dist/validate.js:459). `scripts/bundle-node.mjs` keeps its own copy of this
// rule; `scripts/bundle-node.test.mjs` holds the two to the same answers.
export function isReleaseVersion(value: string): boolean {
  return value.length <= 50 && RELEASE_VERSION.test(value);
}

/** No stamp means run from source, or bundled by calling `bundle()` without `releaseVersion` as
 * test support does; every bundle `scripts/bundle-node.mjs`'s command line builds carries one,
 * `null` when the build is not a release. */
export function builtRelease(): BuiltRelease {
  if (typeof __WAITRON_RELEASE_VERSION__ === "undefined") return { bundled: false };
  const stamp: unknown = __WAITRON_RELEASE_VERSION__;
  if (stamp === null || typeof stamp !== "object") return { bundled: true, version: null };
  const version = (stamp as { version?: unknown }).version;
  return {
    bundled: true,
    version: typeof version === "string" && isReleaseVersion(version) ? version : null,
  };
}
