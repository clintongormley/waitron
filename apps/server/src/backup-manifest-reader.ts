import type { BackupManifest } from "./backup-manifest.js";

export class BackupManifestReadError extends Error {
  constructor(readonly status: "invalid" | "unsupported") {
    super("Backup manifest refused");
    this.name = "BackupManifestReadError";
  }
}
function invalid(): never {
  throw new BackupManifestReadError("invalid");
}
function unsupported(): never {
  throw new BackupManifestReadError("unsupported");
}

function rawJson(bytes: Uint8Array): unknown {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) invalid();
    throw error;
  }
  let at = 0;
  function space() {
    while (at < raw.length && /[\x20\t\r\n]/.test(raw[at]!)) at++;
  }
  function string(): string {
    if (raw[at] !== '"') invalid();
    const start = at++;
    for (; at < raw.length; at++) {
      if (raw[at] === "\\") {
        at++;
        continue;
      }
      if (raw[at] === '"') {
        at++;
        try {
          return JSON.parse(raw.slice(start, at)) as string;
        } catch (error) {
          if (error instanceof SyntaxError) invalid();
          throw error;
        }
      }
    }
    invalid();
  }
  function value(depth: number): unknown {
    if (depth > 32) invalid();
    space();
    if (raw[at] === '"') return string();
    if (raw[at] === "{") {
      at++;
      space();
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (raw[at] === "}") {
        at++;
        return out;
      }
      for (;;) {
        space();
        const key = string();
        if (Object.hasOwn(out, key)) invalid();
        space();
        if (raw[at++] !== ":") invalid();
        out[key] = value(depth + 1);
        space();
        const next = raw[at++];
        if (next === "}") return out;
        if (next !== ",") invalid();
      }
    }
    if (raw[at] === "[") {
      at++;
      space();
      const out: unknown[] = [];
      if (raw[at] === "]") {
        at++;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        space();
        const next = raw[at++];
        if (next === "]") return out;
        if (next !== ",") invalid();
      }
    }
    for (const [token, parsed] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const) {
      if (raw.startsWith(token, at)) {
        at += token.length;
        return parsed;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(raw.slice(at));
    if (!number) invalid();
    at += number[0].length;
    return Number(number[0]);
  }
  const out = value(0);
  space();
  if (at !== raw.length) invalid();
  return out;
}
function object(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) invalid();
  return raw as Record<string, unknown>;
}
export function readBackupManifest(bytes: Uint8Array): BackupManifest {
  const value = object(rawJson(bytes));
  if (!Number.isSafeInteger(value.manifestVersion) || Number(value.manifestVersion) < 1) invalid();
  if (value.manifestVersion !== 1) unsupported();
  const keys = ["manifestVersion", "createdAt", "environment", "modules"];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
  if (
    typeof value.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  )
    invalid();
  if (value.environment !== "production" && value.environment !== "preproduction") invalid();
  const modules = object(value.modules);
  for (const [name, version] of Object.entries(modules))
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      !Number.isSafeInteger(version) ||
      Number(version) < 0
    )
      invalid();
  return {
    manifestVersion: 1,
    createdAt: value.createdAt,
    environment: value.environment,
    modules: Object.fromEntries(Object.entries(modules)) as Record<string, number>,
  };
}
