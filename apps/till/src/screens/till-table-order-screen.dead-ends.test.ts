import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DeadEndAnswer } from "../api/client.js";
import type { OrderLine } from "../state/working-order.js";
import type { SubmitDraftDetail } from "./till-table-order-screen.js";
import { beer, flan, mount, resized, store } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const answer: DeadEndAnswer = {
  sends: true,
  deadEnds: [
    {
      key: "0",
      name: "Beer",
      quantity: "1",
      stationId: "bar",
      stationName: "Upstairs bar",
      why: "closed",
    },
  ],
  stations: [
    { id: "bar", name: "Upstairs bar", open: false },
    { id: "kitchen", name: "Kitchen", open: true },
  ],
};

async function preview(lines: OrderLine[]) {
  const { el } = await mount();
  el.parentElement!.style.width = "1280px";
  await resized(el);
  store(el).loadFrom(store(el).id, lines);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
  await el.updateComplete;
  return el;
}

it("checks sent line objects and requires a station before Confirm", async () => {
  const el = await preview([{ product: beer, quantity: "1" }]);
  let checked: readonly OrderLine[] | undefined;
  el.addEventListener("check-dead-ends", (event) => {
    event.preventDefault();
    checked = (event as CustomEvent<{ sent: readonly OrderLine[] }>).detail.sent;
  });
  // A reopened preview must ask with the same live line objects, not saved draft ids.
  el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
  await el.updateComplete;
  expect(checked).toEqual([store(el).lines[0]]);
  el.answerDeadEnds([store(el).lines[0]!], answer);
  await el.updateComplete;
  const confirm = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[data-draft-confirm]",
  )!;
  expect(confirm.disabled).toBe(true);
  const section = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!;
  expect(section).not.toBeNull();
  section.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  await el.updateComplete;
  expect(store(el).lines[0]!.makeAt).toBe("kitchen");
  expect(confirm.disabled).toBe(false);
});

it("keeps Confirm disabled and does not submit while the draft save is pending", async () => {
  const { el } = await mount();
  el.parentElement!.style.width = "1280px";
  await resized(el);
  store(el).loadFrom(store(el).id, [{ product: beer, quantity: "1" }]);
  await el.updateComplete;
  let submitted = false;
  el.addEventListener("check-dead-ends", (event) => event.preventDefault());
  el.addEventListener("submit-draft", () => (submitted = true));
  el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
  await el.updateComplete;
  const confirm = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[data-draft-confirm]",
  )!;
  expect(confirm.disabled).toBe(true);
  confirm.click();
  expect(submitted).toBe(false);
});

it("removes a dead-end line and confirms only the remaining dish with recomputed groups", async () => {
  const el = await preview([
    { product: beer, quantity: "1" },
    { product: flan, quantity: "1" },
  ]);
  el.answerDeadEnds([...store(el).lines], answer);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!.dispatchEvent(
    new CustomEvent("remove", { detail: { key: "0" } }),
  );
  await el.updateComplete;
  let submitted: SubmitDraftDetail | undefined;
  el.addEventListener("submit-draft", (event) => {
    submitted = (event as CustomEvent<SubmitDraftDetail>).detail;
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
  expect(submitted?.sent.map((line) => line.product.name)).toEqual(["Flan"]);
  expect(submitted?.groups).toEqual([{ release: "hold", lineIndexes: [0] }]);
});

it("clears a saved making station that has since been switched off", async () => {
  const el = await preview([{ product: beer, quantity: "1", makeAt: "old-bar" }]);
  el.answerDeadEnds([store(el).lines[0]!], answer);
  await el.updateComplete;
  expect(store(el).lines[0]!.makeAt).toBeUndefined();
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-draft-confirm]")!
      .disabled,
  ).toBe(true);
});

it("ignores an earlier question answered after the same lines are reopened", async () => {
  const el = await preview([{ product: beer, quantity: "1" }]);
  const checks: number[] = [];
  el.addEventListener("check-dead-ends", (event) => {
    event.preventDefault();
    checks.push((event as CustomEvent<{ checkId: number }>).detail.checkId);
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-draft-dismiss]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
  await el.updateComplete;
  el.answerDeadEnds([store(el).lines[0]!], answer, checks[0]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-dead-ends-section")).toBeNull();
  el.answerDeadEnds([store(el).lines[0]!], answer, checks[1]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-dead-ends-section")).not.toBeNull();
});
