import { describe, expect, it } from "vitest";
import { DraftRows } from "./merge-draft.js";

describe("DraftRows", () => {
  it("refreshes clean fields and new rows while retaining unsaved fields", () => {
    const drafts = new DraftRows<{ id: string; name: string; count: number }>();
    const rows = drafts.merge([], [{ id: "a", name: "Original", count: 0 }]);
    rows[0]!.name = "Unsaved";
    expect(
      drafts.merge(rows, [
        { id: "a", name: "Elsewhere", count: 2 },
        { id: "b", name: "New", count: 1 },
      ]),
    ).toEqual([
      { id: "a", name: "Unsaved", count: 2 },
      { id: "b", name: "New", count: 1 },
    ]);
  });
  it("removes deleted rows and accepts server values after the draft has been saved", () => {
    const drafts = new DraftRows<{ id: string; name: string }>();
    const rows = drafts.merge([], [{ id: "a", name: "Original" }]);
    rows[0]!.name = "Saved";
    const saved = drafts.merge(rows, [{ id: "a", name: "Saved" }]);
    expect(drafts.merge(saved, [{ id: "a", name: "Later" }])).toEqual([{ id: "a", name: "Later" }]);
    expect(drafts.merge(saved, [])).toEqual([]);
  });
});
