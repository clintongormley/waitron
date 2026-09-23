// The one-shot operator scripts under `scripts/` open the SAME directory the server does, and this
// suite is what says so with a command rather than a comment: every case resolves the directory
// twice — once through `resolveScriptVenueDir`, once through the server's own `loadConfig` — and
// asserts the two strings are equal. A third spelling of "the venue directory" would fail here.
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { resolveScriptVenueDir } from "./venue-dir.js";

/** `loadConfig` only ever uses these two roots as string fallbacks — it never stats them — so a
 * placeholder is enough (the same choice `dev-setup.test.ts` makes). */
const MIGRATIONS_ROOT = "/dev/null/migrations";
const STATE_ROOT = "/dev/null/state";

/** What the server would resolve for this env, from the server's own loader. */
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
    // The files are opened by path for the life of the process, so a path that shifted with the
    // cwd would be a different directory to a script started from elsewhere on the box.
    const env = { WAITRON_VENUE_DIR: "some/venue" };
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(resolve("some/venue"));
    expect(await resolveScriptVenueDir(env, STATE_ROOT)).toBe(serverVenueDir(env));
  });

  it("treats WAITRON_VENUE_DIR= as unset, never as the cwd", async () => {
    // `resolve("")` is the cwd — the trap CLAUDE.md §3 names. An operator's `VAR=` line must reach
    // the same default as no line at all.
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
    // Measured, not assumed: `resolveConfigDir` resolves the value it is GIVEN and returns the
    // fallback verbatim, so a relative default root stays relative on both sides. This case cannot
    // be reached in production — `boot.ts`'s `DEFAULT_STATE_ROOT` is built with `fileURLToPath` and
    // is always absolute — and it is here because the first version of this test asserted the
    // opposite and the server's own loader is what settled it.
    const env = {};
    expect(await resolveScriptVenueDir(env, "state")).toBe(join("state", "venue"));
    expect(await resolveScriptVenueDir(env, "state")).toBe(
      loadConfig(env, MIGRATIONS_ROOT, "state").venueDir,
    );
  });
});

describe("the default state root a script uses with no argument", () => {
  it("is the one boot.ts computes, so a script and the server share it", async () => {
    // The scripts are bundled into `dist/` beside `dist/server.js`, and `DEFAULT_STATE_ROOT` is
    // `new URL("state", import.meta.url)` — the BUNDLE's own directory. Importing the constant
    // rather than respelling it is what keeps the two bundles pointed at one directory.
    const { DEFAULT_STATE_ROOT } = await import("../src/boot.js");
    expect(await resolveScriptVenueDir({})).toBe(join(DEFAULT_STATE_ROOT, "venue"));
    expect(await resolveScriptVenueDir({})).toBe(
      loadConfig({}, MIGRATIONS_ROOT, DEFAULT_STATE_ROOT).venueDir,
    );
  });
});
