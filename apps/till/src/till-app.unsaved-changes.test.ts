import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    probeTillReload(
      scenario: "dirty-keep" | "dirty-discard" | "clean" | "reverted" | "saved",
    ): Promise<{
      dialogs: string[];
      reloaded: boolean;
      note: string | null;
      savedNotes: string[];
    }>;
  }
}

describe("W69 activated native till reload", () => {
  it("rejecting the browser warning retains the staged absence request", async () => {
    const result = await commands.probeTillReload("dirty-keep");
    expect(result.dialogs).toEqual(["beforeunload"]);
    expect(result.reloaded).toBe(false);
    expect(result.note).toBe("Family visit");
    expect(result.savedNotes).toEqual([]);
  });

  it("accepting the browser warning reloads without submitting the staged request", async () => {
    const result = await commands.probeTillReload("dirty-discard");
    expect(result.dialogs).toEqual(["beforeunload"]);
    expect(result.reloaded).toBe(true);
    expect(result.note).toBeNull();
    expect(result.savedNotes).toEqual([]);
  });

  it.each(["clean", "reverted", "saved"] as const)(
    "%s schedule reloads without a browser warning",
    async (scenario) => {
      const result = await commands.probeTillReload(scenario);
      expect(result.dialogs).toEqual([]);
      expect(result.reloaded).toBe(true);
      expect(result.note).toBeNull();
      expect(result.savedNotes).toEqual(scenario === "saved" ? ["Family visit"] : []);
    },
  );
});
