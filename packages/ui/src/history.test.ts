import { describe, expect, it } from "vitest";
import { UndoHistory } from "./history.js";

describe("UndoHistory", () => {
  it("starts with its first state and nothing to undo or redo", () => {
    const history = new UndoHistory("a");
    expect(history.current).toBe("a");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBeUndefined();
    expect(history.current).toBe("a");
  });

  it("undoes and redoes in order", () => {
    const history = new UndoHistory("a");
    history.push("b");
    history.push("c");
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe("b");
    expect(history.canRedo).toBe(true);
    expect(history.undo()).toBe("a");
    expect(history.undo()).toBeUndefined();
    expect(history.current).toBe("a");
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe("b");
    expect(history.current).toBe("b");
    expect(history.redo()).toBe("c");
    expect(history.current).toBe("c");
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeUndefined();
    expect(history.current).toBe("c");
  });

  it("a redone step can be undone again", () => {
    const history = new UndoHistory("a");
    history.push("b");
    history.undo();
    expect(history.redo()).toBe("b");
    expect(history.canUndo).toBe(true);
    expect(history.undo()).toBe("a");
  });

  it("a new push after Undo empties Redo", () => {
    const history = new UndoHistory("a");
    history.push("b");
    history.undo();
    history.push("c");
    expect(history.current).toBe("c");
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe("a");
  });

  it("merges pushes that carry the same key", () => {
    const history = new UndoHistory("a");
    history.push("b", "label:t1");
    history.push("c", "label:t1");
    expect(history.current).toBe("c");
    expect(history.undo()).toBe("a");
    expect(history.canUndo).toBe(false);
  });

  it("does not merge different keys, or a push with no key", () => {
    const history = new UndoHistory("a");
    history.push("b", "k");
    history.push("c", "x");
    expect(history.undo()).toBe("b");
    history.push("d");
    history.push("e");
    expect(history.undo()).toBe("d");
  });

  it("does not merge a keyed push after a push with no key", () => {
    const history = new UndoHistory("a");
    history.push("b");
    history.push("c", "k");
    expect(history.undo()).toBe("b");
  });

  it("does not merge across an undo", () => {
    const history = new UndoHistory("a");
    history.push("b", "k");
    history.undo();
    history.push("c", "k");
    expect(history.undo()).toBe("a");
  });

  it("does not merge across a redo or a reset", () => {
    const history = new UndoHistory("a");
    history.push("b", "k");
    history.undo();
    history.redo();
    history.push("c", "k");
    expect(history.undo()).toBe("b");
    history.reset("z");
    history.push("y", "k");
    expect(history.undo()).toBe("z");
  });

  it("resets to one state", () => {
    const history = new UndoHistory("a");
    history.push("b");
    history.push("c");
    history.undo();
    history.reset("z");
    expect(history.current).toBe("z");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("keeps every step", () => {
    const history = new UndoHistory(0);
    for (let step = 1; step <= 500; step++) history.push(step);
    for (let step = 499; step >= 0; step--) expect(history.undo()).toBe(step);
    expect(history.undo()).toBeUndefined();
    expect(history.current).toBe(0);
  });
});
