import { expect, it } from "vitest";
import { deleteTargetName } from "./delete-impact.js";
it.each([
  [{ id: "a", name: "Terrace", deleted: true }, "deleted", "Terrace (deleted)"],
  [{ id: "a", name: "Terrace", deleted: true }, "eliminado", "Terrace (eliminado)"],
  [{ id: "a", name: "Bar" }, "deleted", "Bar"],
  [{ id: "a", name: "Bar", deleted: false }, "deleted", "Bar"],
])("marks only a deleted target: %j", (target, mark, expected) => {
  expect(deleteTargetName(target, mark)).toBe(expected);
});
