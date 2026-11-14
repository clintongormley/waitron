import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import * as layout from "./state-layout.js";

it("every name is declared once", () => {
  const names = layout.STATE_LAYOUT.map((entry) => entry.name);
  expect(new Set(names).size).toBe(names.length);
});

it("a plain reset keeps exactly tls and records", () => {
  expect([...layout.RESET_KEPT].sort()).toEqual(["records", "tls"]);
});

it("every constant is in the table", () => {
  const names = layout.STATE_LAYOUT.map((entry) => entry.name);
  const suffixes = new Set([
    "TRADING_ENV_REPLACED_SUFFIX",
    "WAL_SUFFIX",
    "SHM_SUFFIX",
    "JOURNAL_SUFFIX",
    "LITESTREAM_META_SUFFIX",
    "INCOMING_SUFFIX",
  ]);
  const venueNames = new Set([
    "VENUE_FILE",
    "NODE_FILE",
    "VENUE_WAL_FILE",
    "NODE_WAL_FILE",
    "VENUE_LOCK_FILE",
    "VENUE_HOLDER_FILE",
    "MIGRATIONS_LOCK_FILE",
    "VENUE_LITESTREAM_DIR",
    "REPLACED_DATABASE_PREFIX",
  ]);
  for (const [key, value] of Object.entries(layout)) {
    if (typeof value !== "string" || suffixes.has(key)) continue;
    const path = venueNames.has(key)
      ? `${layout.VENUE_DIR_NAME}/${value}`
      : key === "STREAM_RESTORE_PREFIX" || key === "RESTORE_ENTRY_PREFIX"
        ? `${layout.SCRATCH_DIR}/${value}`
        : value;
    expect(
      names.some((name) => path === name || path.startsWith(`${name}/`)),
      key,
    ).toBe(true);
  }
  expect(names).toContain(`trading.env${layout.TRADING_ENV_REPLACED_SUFFIX}`);
});

it("venueDirOf defaults unset and empty values and resolves a development override", () => {
  const state = resolve("state");
  expect(layout.venueDirOf({}, state)).toBe(join(state, "venue"));
  expect(layout.venueDirOf({ WAITRON_VENUE_DIR: "" }, state)).toBe(join(state, "venue"));
  expect(layout.venueDirOf({ WAITRON_VENUE_DIR: "dev-venue" }, state)).toBe(resolve("dev-venue"));
  expect(layout.venueDirOf({ WAITRON_VENUE_DIR: "/separate/venue" }, state)).toBe(
    "/separate/venue",
  );
});
