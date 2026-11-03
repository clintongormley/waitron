import { describe, expect, it } from "vitest";
import { NODE_LOCAL_MANIFEST } from "./manifest.js";

describe("the node-local manifest", () => {
  it("lists no item twice", () => {
    const items = NODE_LOCAL_MANIFEST.map((row) => `${row.where}:${row.item}`);
    expect(new Set(items).size).toBe(items.length);
    expect(new Set(NODE_LOCAL_MANIFEST.map((row) => row.item)).size).toBe(items.length);
  });

  it("names exact file names, a template only for a module's kept file", () => {
    const patterned = NODE_LOCAL_MANIFEST.filter((row) => /[*<]/.test(row.item)).map((r) => r.item);
    expect(patterned).toEqual(["module-evidence/<module>/<source>.json"]);
  });

  it("never sends M1's private signing key, and carries the key ring and the venue's credentials", () => {
    const classOf = (item: string) => NODE_LOCAL_MANIFEST.find((row) => row.item === item)?.class;
    expect(classOf("node_signing_key")).toBe("source-only");
    expect(classOf("secrets.env")).toBe("transferred");
    expect(classOf("tenant_credentials")).toBe("transferred");
    expect(classOf("trading.env")).toBe("destination-owned");
    expect(classOf("change_log")).toBe("rebuildable");
  });

  it("says what M2 does with every item", () => {
    expect(NODE_LOCAL_MANIFEST.filter((row) => row.treatment.trim() === "")).toEqual([]);
  });
});
