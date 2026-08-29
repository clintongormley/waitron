import { describe, expect, it, vi } from "vitest";
import type { SingletonRole } from "@waitron/db";
import type { PassReport } from "./pass.js";
import { singletonPass } from "./singleton-pass.js";

const NOW = new Date("2026-08-29T10:00:00.000Z");
const PRIMARY_REPORT: PassReport = { nextDueAt: NOW, duties: [] };

describe("singletonPass", () => {
  it("runs the primary pass when the node holds the singletons", async () => {
    const runPrimary = vi.fn(async (): Promise<PassReport> => PRIMARY_REPORT);
    const pass = singletonPass(() => "primary", runPrimary);
    expect(await pass(NOW)).toBe(PRIMARY_REPORT);
    expect(runPrimary).toHaveBeenCalledOnce();
  });

  it("returns an empty pass and never runs the primary pass for a secondary", async () => {
    const runPrimary = vi.fn(async (): Promise<PassReport> => PRIMARY_REPORT);
    const pass = singletonPass(() => "secondary", runPrimary);
    expect(await pass(NOW)).toEqual({ nextDueAt: null, duties: [] });
    expect(runPrimary).not.toHaveBeenCalled();
  });

  it("reads the role PER PASS, so a promotion mid-run starts the duties on the next tick", async () => {
    const runPrimary = vi.fn(async (): Promise<PassReport> => PRIMARY_REPORT);
    let role: SingletonRole = "secondary";
    const pass = singletonPass(() => role, runPrimary);
    expect(await pass(NOW)).toEqual({ nextDueAt: null, duties: [] });
    expect(runPrimary).not.toHaveBeenCalled();
    role = "primary"; // a promotion flips the holder
    expect(await pass(NOW)).toBe(PRIMARY_REPORT);
    expect(runPrimary).toHaveBeenCalledOnce();
  });
});
