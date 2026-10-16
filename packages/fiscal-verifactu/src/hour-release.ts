export interface HourRelease {
  readonly sourceCommit: string;
  readonly committedAt: string;
  readonly instantMs: number;
  readonly generator: string;
  readonly generatorSha256: string;
}
declare const __WAITRON_HOUR_RELEASE__: unknown;

function embeddedRelease(): HourRelease | null {
  const value = typeof __WAITRON_HOUR_RELEASE__ === "undefined" ? null : __WAITRON_HOUR_RELEASE__;
  if (value === null || typeof value !== "object") return null;
  const stamp = value as HourRelease;
  if (
    typeof stamp.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(stamp.sourceCommit) ||
    !Number.isSafeInteger(stamp.instantMs) ||
    !Number.isFinite(new Date(stamp.instantMs).getTime()) ||
    new Date(stamp.instantMs).toISOString() !== stamp.committedAt ||
    stamp.generator !== "scripts/generate-hour-release.mjs:v1" ||
    typeof stamp.generatorSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(stamp.generatorSha256)
  )
    return null;
  return Object.freeze({ ...stamp });
}

const release = embeddedRelease();
export function readHourRelease(): HourRelease | null {
  return release;
}
