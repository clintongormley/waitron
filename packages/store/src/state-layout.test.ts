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
  for (const [key, value] of Object.entries(layout)) {
    if (typeof value !== "string" || key === "TRADING_ENV_REPLACED_SUFFIX") continue;
    const path =
      key === "STREAM_RESTORE_PREFIX" || key === "RESTORE_ENTRY_PREFIX"
        ? `${layout.SCRATCH_DIR}/${value}`
        : value;
    expect(
      names.some((name) => path === name || path.startsWith(`${name}/`)),
      key,
    ).toBe(true);
  }
  expect(names).toContain(`trading.env${layout.TRADING_ENV_REPLACED_SUFFIX}`);
});
