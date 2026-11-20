export type BuiltRelease = { bundled: false } | { bundled: true; version: string | null };

declare const __WAITRON_RELEASE_VERSION__: unknown;

// The 50-character bound comes from the fiscal record's software Version field.
const RELEASE_VERSION =
  /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;
const CHANNELS = ["alpha", "beta", "rc", undefined];

function versionMatch(value: string): RegExpExecArray | null {
  return value.length <= 50 ? RELEASE_VERSION.exec(value) : null;
}

export function isReleaseVersion(value: string): boolean {
  return versionMatch(value) !== null;
}

function versionParts(version: string): bigint[] {
  const match = versionMatch(version);
  if (match === null) throw new Error("Expected a numbered release version");
  return [
    ...match[1]!.split(".").map(BigInt),
    BigInt(CHANNELS.indexOf(match[2])),
    BigInt(match[3] ?? "0"),
  ];
}

export function compareReleaseVersions(candidate: string, installed: string): number {
  const requested = versionParts(candidate);
  const current = versionParts(installed);
  for (const [index, part] of requested.entries()) {
    if (part < current[index]!) return -1;
    if (part > current[index]!) return 1;
  }
  return 0;
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
