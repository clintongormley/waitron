import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-button.js";
import "./wt-form-actions.js";

afterEach(cleanup);

test("places cancel at the left and the primary action at the right", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  );
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!;
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!;
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!;
  expect(cancel.getBoundingClientRect().left).toBe(row.getBoundingClientRect().left);
  expect(primary.getBoundingClientRect().right).toBe(row.getBoundingClientRect().right);
});

test("keeps a lone primary action on the right", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button variant="primary">Continue</wt-button></wt-form-actions>',
  );
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!;
  const primary = el.querySelector<HTMLElement>("wt-button")!;
  expect(primary.getBoundingClientRect().right).toBe(row.getBoundingClientRect().right);
});
