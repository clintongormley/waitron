// Every case resolves the directory through `resolveScriptVenueDir` and through the server's own
// `loadConfig`, and asserts the two strings are equal.
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { resolveScriptVenueDir } from "./venue-dir.js";

/** `loadConfig` uses these roots as string fallbacks and never stats them. */
const MIGRATIONS_ROOT = "/dev/null/migrations";
const STATE_ROOT = "/dev/null/state";

function serverVenueDir(env: NodeJS.ProcessEnv): string {
  return loadConfig(env, MIGRATIONS_ROOT, STATE_ROOT).venueDir;
}

describe("resolveScriptVenueDir agrees with the server's own config", () => {
  it("takes an absolute WAITRON_VENUE_DIR verbatim", async () => {
    const env = { WAITRON_VENUE_DIR: "/var/lib/waitron/venue" };
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe("/var/lib/waitron/venue");
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(serverVenueDir(env));
  });

  it("makes a RELATIVE WAITRON_VENUE_DIR absolute, as the server does", async () => {
    const env = { WAITRON_VENUE_DIR: "some/venue" };
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(resolve("some/venue"));
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(serverVenueDir(env));
  });

  it("treats WAITRON_VENUE_DIR= as unset, never as the cwd", async () => {
    // `resolve("")` is the cwd (CLAUDE.md §3).
    const env = { WAITRON_VENUE_DIR: "", WAITRON_STATE_DIR: "/srv/waitron" };
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(join("/srv/waitron", "venue"));
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(serverVenueDir(env));
  });

  it("defaults to <WAITRON_STATE_DIR>/venue when no venue directory is named", async () => {
    const env = { WAITRON_STATE_DIR: "/srv/waitron" };
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(join("/srv/waitron", "venue"));
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(serverVenueDir(env));
  });

  it("falls back to the caller's default state root when neither variable is set", async () => {
    const env = {};
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(join(STATE_ROOT, "venue"));
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(serverVenueDir(env));
  });

  it("leaves a RELATIVE default state root relative, exactly as the server does", async () => {
    // `resolveConfigDir` returns the fallback verbatim. Unreachable in production, where
    // `DEFAULT_STATE_ROOT` is always absolute.
    const env = {};
    expect(await resolveScriptVenueDir(env, "state")).toBe(join("state", "venue"));
    expect(await resolveScriptVenueDir(env, "state")).toBe(
      loadConfig(env, MIGRATIONS_ROOT, "state").venueDir,
    );
  });
});

describe("the default state root a script uses with no argument", () => {
  it("is the one boot.ts computes, so a script and the server share it", async () => {
    const { DEFAULT_STATE_ROOT } = await import("../src/boot.js");
    expect(await resolveScriptVenueDir({})).toBe(join(DEFAULT_STATE_ROOT, "venue"));
    expect(await resolveScriptVenueDir({})).toBe(
      loadConfig({}, MIGRATIONS_ROOT, DEFAULT_STATE_ROOT).venueDir,
    );
  });
});
