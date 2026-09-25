import { describe, expect, it } from "vitest";
import { DEVICE_HELP, DEVICE_ORDER, type DeviceId } from "./trust-page-devices.js";

describe("DEVICE_HELP", () => {
  it("lists every device exactly once, in display order", () => {
    expect([...DEVICE_ORDER].sort()).toEqual(Object.keys(DEVICE_HELP).sort());
    expect(new Set(DEVICE_ORDER).size).toBe(DEVICE_ORDER.length);
  });

  // Without a browser restart, the operator is left staring at a cached warning.
  it.each(Object.keys(DEVICE_HELP) as DeviceId[])(
    "%s ends its install steps by closing the browser and reopening THIS page",
    (id) => {
      const last = DEVICE_HELP[id].install.at(-1) ?? "";
      expect(last).toMatch(/\b(quit|close)\b/i);
      // Not "open this server again": the operator is already looking at the page that tells them
      // whether it worked, so sending them back to it is one instruction instead of two.
      expect(last.endsWith("then reopen this page.")).toBe(true);
    },
  );

  it.each(Object.keys(DEVICE_HELP) as DeviceId[])(
    "%s explains how to remove a previously installed certificate",
    (id) => {
      expect(DEVICE_HELP[id].removal.length).toBeGreaterThan(0);
      expect(DEVICE_HELP[id].removal.join(" ")).toMatch(/remove|delete|distrust/i);
    },
  );

  it.each(Object.keys(DEVICE_HELP) as DeviceId[])("%s has a heading and a summary", (id) => {
    expect(DEVICE_HELP[id].heading).not.toBe("");
    expect(DEVICE_HELP[id].summary).not.toBe("");
    expect(DEVICE_HELP[id].install.length).toBeGreaterThan(1);
  });

  it("says server, never box, in operator-visible text", () => {
    const all = DEVICE_ORDER.flatMap((id) => {
      const d = DEVICE_HELP[id];
      return [d.heading, d.summary, ...d.install, ...d.removal, ...(d.notes ?? [])];
    }).join(" ");
    expect(all).not.toMatch(/\bbox(es)?\b/i);
  });
});
