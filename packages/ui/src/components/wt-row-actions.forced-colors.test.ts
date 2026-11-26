import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, emulateForcedColours, mount } from "../test-helpers.js";
import "./wt-row-actions.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

test("the sheet edge stays visible when forced colours remove its shadow", async () => {
  const el = await mount(
    '<wt-row-actions label="Choices" bottom-sheet sheet-variant="menu"><button>Edit</button></wt-row-actions>',
  );
  await userEvent.click(el.shadowRoot!.querySelector("button")!);
  const dialog = page.getByRole("dialog", { name: "Choices" });
  await expect.element(dialog).toBeVisible();
  const edge = getComputedStyle(dialog.element());
  expect(edge.boxShadow).toBe("none");
  expect(edge.borderTopStyle).toBe("solid");
  expect(edge.borderTopWidth).toBe("1px");
  expect(edge.borderTopColor).not.toBe(edge.backgroundColor);
});
