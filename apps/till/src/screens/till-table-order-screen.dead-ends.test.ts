import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DeadEndAnswer } from "../api/client.js";
import type { OrderLine } from "../state/working-order.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import {
  beer,
  flan,
  mount,
  openDraftLine,
  resized,
  store,
} from "./till-table-order-screen.test-helpers.js";

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
interface Check {
  sent: readonly OrderLine[];
  checkId: number;
}
function checkSaved(el: TillTableOrderScreen) {
  const checked = new Promise<Check>((resolve) =>
    el.addEventListener(
      "check-dead-ends",
      (event) => {
        event.preventDefault();
        resolve((event as CustomEvent<Check>).detail);
      },
      { once: true },
    ),
  );
  const revision = (el.routingRevision ?? 0) + 1;
  el.billEdit = {
    billId: el.orderId!,
    editorVersion: 1,
    draftId: "draft",
    draftRevision: revision,
  };
  el.routingRevision = revision;
  return checked;
}
async function saved(lines: OrderLine[]) {
  const { el } = await mount();
  el.parentElement!.style.width = "1280px";
  await resized(el);
  store(el).loadFrom(store(el).id, lines);
  await el.updateComplete;
  const check = await checkSaved(el);
  return { el, check };
}
const send = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-draft-action="send-all"]',
  )!;
const section = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector("[data-draft-routing-detail] till-dead-ends-section")!;

it("checks live saved line objects and requires a station before sending the unresolved dish", async () => {
  const { el, check } = await saved([{ product: beer, quantity: "1" }]);
  expect(check.sent).toEqual([store(el).lines[0]]);
  el.answerDeadEnds(check.sent, answer, check.checkId);
  await el.updateComplete;
  expect(send(el).disabled).toBe(true);
  await openDraftLine(el, 0);
  expect(section(el)).not.toBeNull();
  section(el).dispatchEvent(
    new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }),
  );
  await el.updateComplete;
  expect(store(el).lines[0]!.makeAt).toBe("kitchen");
  expect(send(el).disabled).toBe(false);
});

it("keeps Send disabled and does not submit while the draft command is pending", async () => {
  const { el, check } = await saved([{ product: beer, quantity: "1" }]);
  const submitted = vi.fn();
  el.addEventListener("submit-draft", submitted);
  store(el).sending = true;
  await el.updateComplete;
  el.answerDeadEnds(check.sent, { ...answer, deadEnds: [] }, check.checkId);
  await el.updateComplete;
  expect(send(el).disabled).toBe(true);
  send(el).click();
  expect(submitted).not.toHaveBeenCalled();
});

it("removes a dead-end line and sends only the remaining dish with recomputed groups", async () => {
  const { el, check } = await saved([
    { product: beer, quantity: "1" },
    { product: flan, quantity: "1" },
  ]);
  el.answerDeadEnds(check.sent, answer, check.checkId);
  await el.updateComplete;
  const picker = await openDraftLine(el, 0);
  section(el).dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
  await el.updateComplete;
  await picker.updateComplete;
  const submitted: SubmitDraftDetail[] = [];
  el.addEventListener("submit-draft", (event) =>
    submitted.push((event as CustomEvent<SubmitDraftDetail>).detail),
  );
  await userEvent.click(send(el));
  expect(submitted[0]?.sent.map((line) => line.product.name)).toEqual(["Flan"]);
  expect(submitted[0]?.groups).toEqual([{ release: "fire", lineIndexes: [0] }]);
});

it("clears a saved making station that has since been switched off", async () => {
  const { el, check } = await saved([{ product: beer, quantity: "1", makeAt: "old-bar" }]);
  el.answerDeadEnds(check.sent, answer, check.checkId);
  await el.updateComplete;
  expect(store(el).lines[0]!.makeAt).toBeUndefined();
  expect(send(el).disabled).toBe(true);
});

it("ignores an earlier question answered after the same saved lines are checked again", async () => {
  const { el, check: first } = await saved([{ product: beer, quantity: "1" }]);
  const second = await checkSaved(el);
  el.answerDeadEnds(first.sent, answer, first.checkId);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-draft-routing-warning]")).toBeNull();
  el.answerDeadEnds(second.sent, answer, second.checkId);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-draft-routing-warning]")).not.toBeNull();
});

const buttonFill = (host: Element) =>
  getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;
it.each(["light", "dark"] as const)(
  "draws Send quiet while its only dish has no station, then blue (%s theme)",
  async (theme) => {
    const { el, check } = await saved([{ product: beer, quantity: "1" }]);
    el.parentElement!.setAttribute("data-theme", theme);
    el.answerDeadEnds(check.sent, answer, check.checkId);
    await el.updateComplete;
    await send(el).updateComplete;
    const quietFill = buttonFill(send(el));
    const move =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-draft-move]")!;
    await move.updateComplete;
    expect(quietFill).toBe(buttonFill(move));
    expect(send(el).disabled).toBe(true);
    expect(send(el).getAttribute("variant")).toBe("secondary");
    await openDraftLine(el, 0);
    section(el).dispatchEvent(
      new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }),
    );
    await el.updateComplete;
    await send(el).updateComplete;
    expect(send(el).disabled).toBe(false);
    expect(send(el).getAttribute("variant")).toBe("primary");
    expect(buttonFill(send(el))).not.toBe(quietFill);
  },
);
