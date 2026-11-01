import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { NODE_CLASSIFICATION } from "./classification.js";
import * as schema from "./schema/index.js";

describe("NODE_CLASSIFICATION", () => {
  it("classifies exactly the tables the schema declares, each local", () => {
    const declared = Object.values(schema).map((table) => getTableName(table));
    expect(declared.length).toBeGreaterThan(0);
    expect(NODE_CLASSIFICATION.map((entry) => entry.table).sort()).toEqual(declared.sort());
    expect(NODE_CLASSIFICATION.map((entry) => entry.class)).toEqual(declared.map(() => "local"));
  });

  it("gives each table the reason that names its node id", () => {
    for (const entry of NODE_CLASSIFICATION) {
      expect(entry.reason).toBe(
        "this box's own row, in node.db, which is never streamed; keyed by this box's node id",
      );
    }
  });
});
