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

it("every state entry declares its backup handling and why material stays out", () => {
  for (const entry of layout.STATE_LAYOUT) {
    expect(entry, entry.name).toHaveProperty("backup");
    const disposition = entry.backup;
    if (disposition === "required" || disposition === "optional") {
      expect(entry.kind, entry.name).toBe("file");
    } else {
      expect(typeof disposition, entry.name).toBe("object");
      for (const [key, value] of Object.entries(disposition)) {
        if (key === "required") {
          expect(value, entry.name).toEqual(expect.arrayContaining([expect.any(String)]));
          for (const path of value as readonly string[])
            expect(path.startsWith(`${entry.name}/`), path).toBe(true);
        } else {
          expect(value, entry.name).toEqual(expect.stringMatching(/\S/));
        }
      }
      expect(Object.keys(disposition).length, entry.name).toBeGreaterThan(0);
    }
  }
});

it("derives the existing archive paths while databases and module history keep their own capture", () => {
  expect(layout.REQUIRED_BACKUP_STATE).toEqual([
    "secrets.env",
    "trading.env",
    "tls/ca.crt",
    "tls/ca.key",
    "tls/server.pem",
  ]);
  expect(layout.OPTIONAL_BACKUP_STATE).toEqual(["backup.env"]);
  expect(
    layout.STATE_LAYOUT.find((entry) => entry.name === layout.VENUE_DIR_NAME)?.backup,
  ).toHaveProperty("snapshot");
  expect(
    layout.STATE_LAYOUT.find((entry) => entry.name === layout.MODULE_RECORDS_DIR)?.backup,
  ).toHaveProperty("evidence");
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
