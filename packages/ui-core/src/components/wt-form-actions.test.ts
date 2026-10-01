import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-button.js";
import type { WtFormActions } from "./wt-form-actions.js";
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

test("shows no message until the form gives one", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  );
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

test("announces the form's message on its own line above the actions, from the left edge", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "800px";
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;

  const message = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(message.getAttribute("role")).toBe("alert");
  expect(message.textContent).toBe("Correct the highlighted fields to continue.");
  const box = message.getBoundingClientRect();
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!.getBoundingClientRect();
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!.getBoundingClientRect();
  const own = el.getBoundingClientRect();
  expect(box.bottom).toBeLessThanOrEqual(primary.top);
  expect(box.bottom).toBeLessThanOrEqual(cancel.top);
  expect(box.left).toBe(own.left);
  expect(box.right).toBe(own.right);
  expect(getComputedStyle(message).textAlign).toBe("start");
});

test("keeps the primary action on the right while a message shows", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!;
  const primary = el.querySelector<HTMLElement>("wt-button")!;
  expect(primary.getBoundingClientRect().right).toBe(row.getBoundingClientRect().right);
});

test("on a narrow (320 px) row too, puts the message on its own line above the actions, within the row's width", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "320px";
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;

  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!.getBoundingClientRect();
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!.getBoundingClientRect();
  expect(message.bottom).toBeLessThanOrEqual(primary.top);
  expect(message.right).toBeLessThanOrEqual(row.right);
  expect(primary.right).toBe(row.right);
});

test("on a narrow (320 px) row, keeps cancel level with the primary action below the message", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "320px";
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;

  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!.getBoundingClientRect();
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!.getBoundingClientRect();
  expect(message.bottom).toBeLessThanOrEqual(primary.top);
  expect(cancel.top).toBe(primary.top);
  expect(cancel.bottom).toBe(primary.bottom);
});

test("puts the message above a lone cancel action", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Close</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "800px";
  el.error = "That agent was already paired.";
  await el.updateComplete;

  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!.getBoundingClientRect();
  expect(message.bottom).toBeLessThanOrEqual(cancel.top);
  expect(message.left).toBe(cancel.left);
});

test("shows no message of its own while its container shows it", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  el.showError = false;
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

test("reports each change of its message to its container", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  const seen: string[] = [];
  const composed: boolean[] = [];
  host.addEventListener("wt-form-error", (event) => {
    seen.push((event as CustomEvent<{ message: string }>).detail.message);
    composed.push(event.composed);
  });
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  el.error = "";
  await el.updateComplete;
  expect(seen).toEqual(["Correct the highlighted fields to continue.", ""]);
  expect(composed).toEqual([true, true]);
});

test("paints the message from the danger token", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");

  const message = getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!);
  expect(message.color).toBe("rgb(1, 2, 3)");
});
