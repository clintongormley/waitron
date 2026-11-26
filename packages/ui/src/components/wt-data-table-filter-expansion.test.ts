import { expect, test, vi } from "vitest";
import { FilterExpansion, visibleTree } from "./wt-data-table-filter-expansion.js";

test("choose records only the temporary keys and hands back the rest for the ordinary tree", () => {
  const expansion = new FilterExpansion();
  const closeBelow = vi.fn((keys: readonly string[]) => [...keys, "below"]);
  const rest = expansion.choose(["a", "b", "c"], false, (key) => key === "b", closeBelow);
  expect(rest).toEqual(["a", "c"]);
  expect(closeBelow).toHaveBeenCalledWith(["b"]);
  expect(expansion.get("a")).toBeUndefined();
  expect(expansion.get("b")).toBe(false);
  expect(expansion.get("below")).toBe(false);
  expect(expansion.get("c")).toBeUndefined();
});

test("choose with no temporary key records nothing and hands back every key", () => {
  const expansion = new FilterExpansion();
  const closeBelow = vi.fn(() => ["below"]);
  expect(expansion.choose(["a", "b"], false, () => false, closeBelow)).toEqual(["a", "b"]);
  expect(closeBelow).not.toHaveBeenCalled();
  expect(expansion.get("below")).toBeUndefined();
});

type Node = { key: string; parent: string | null; open?: boolean };

const tree = (rows: Node[], visible: Node[], opens?: (row: Node) => boolean) =>
  visibleTree(
    rows,
    visible,
    (row) => row.key,
    (row) => row.parent,
    false,
    () => true,
    opens,
  );

test("of two rows sharing a key, the first is the one the path above a match climbs through", () => {
  const child = { key: "child", parent: "x" };
  const rows = [
    { key: "x", parent: null },
    child,
    { key: "x", parent: "p" },
    { key: "p", parent: null },
  ];
  expect(tree(rows, [child]).rows.map((row) => row.key)).toEqual(["x", "child", "x"]);
});

test("a filter holds open only the matched branches it opens, and passes over a parent no row has", () => {
  const leaf = { key: "leaf", parent: "shut" };
  const shut = { key: "shut", parent: "open", open: false };
  const open = { key: "open", parent: "ghost", open: true };
  const opens = (row: Node) => row.open!;
  const { heldOpen } = tree([open, shut, leaf], [open, shut, leaf], opens);
  expect([...heldOpen].sort()).toEqual(["ghost", "open"]);
});
