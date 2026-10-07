import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    probeTillReload(
      scenario: "dirty-keep" | "dirty-discard" | "clean" | "reverted" | "saved",
      leave?: "reload" | "navigation" | "close",
    ): Promise<{
      dialogs: string[];
      reloaded: boolean;
      closed: boolean;
      href: string | null;
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

describe("W69 activated native till document leave", () => {
  it("rejecting cross-origin navigation retains the actual Schedule draft", async () => {
    const result = await commands.probeTillReload("dirty-keep", "navigation");
    expect(result.dialogs).toEqual(["beforeunload"]);
    expect(result.reloaded).toBe(false);
    expect(new URL(result.href!).pathname).toBe("/tabs/counter/view/schedule");
    expect(result.note).toBe("Family visit");
    expect(result.savedNotes).toEqual([]);
  });

  it("accepting cross-origin navigation leaves without submitting the Schedule draft", async () => {
    const result = await commands.probeTillReload("dirty-discard", "navigation");
    expect(result.dialogs).toEqual(["beforeunload"]);
    expect(result.reloaded).toBe(true);
    expect(result.href).toBe("https://w69-destination.invalid/left");
    expect(result.note).toBeNull();
    expect(result.savedNotes).toEqual([]);
  });

  it("rejecting tab closing keeps the document and its Schedule input", async () => {
    const result = await commands.probeTillReload("dirty-keep", "close");
    expect(result.dialogs).toEqual(["beforeunload"]);
    expect(result.closed).toBe(false);
    expect(result.reloaded).toBe(false);
    expect(result.note).toBe("Family visit");
    expect(result.savedNotes).toEqual([]);
  });

  it("accepting tab closing closes without submitting the Schedule draft", async () => {
    const result = await commands.probeTillReload("dirty-discard", "close");
    expect(result.dialogs).toEqual(["beforeunload"]);
    expect(result.closed).toBe(true);
    expect(result.savedNotes).toEqual([]);
  });

  it.each(["clean", "reverted", "saved"] as const)(
    "%s Schedule permits cross-origin navigation without a warning",
    async (scenario) => {
      const result = await commands.probeTillReload(scenario, "navigation");
      expect(result.dialogs).toEqual([]);
      expect(result.href).toBe("https://w69-destination.invalid/left");
      expect(result.note).toBeNull();
      expect(result.savedNotes).toEqual(scenario === "saved" ? ["Family visit"] : []);
    },
  );

  it.each(["clean", "reverted", "saved"] as const)(
    "%s Schedule permits tab closing without a warning",
    async (scenario) => {
      const result = await commands.probeTillReload(scenario, "close");
      expect(result.dialogs).toEqual([]);
      expect(result.closed).toBe(true);
      expect(result.savedNotes).toEqual(scenario === "saved" ? ["Family visit"] : []);
    },
  );
});
