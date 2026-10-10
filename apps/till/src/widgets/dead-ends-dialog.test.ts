import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DeadEndAnswer } from "../api/client.js";
import "./dead-ends-dialog.js";
import type { TillDeadEndsDialog } from "./dead-ends-dialog.js";

afterEach(cleanupWidgets);

const answer: DeadEndAnswer = {
  sends: true,
  deadEnds: [
    { key: "0", name: "Beer", quantity: "2", stationId: "bar", stationName: "Bar", why: "closed" },
  ],
  stations: [{ id: "kitchen", name: "Kitchen", open: true }],
};

it("requires a destination or removal before continuing", async () => {
  setLocale("en");
  const { el } = await mountWidget<TillDeadEndsDialog>("till-dead-ends-dialog", {
    answer,
    allowRemove: true,
  });
  const root = el.shadowRoot!;
  const results: unknown[] = [];
  el.addEventListener("dead-ends-continue", (event) => results.push((event as CustomEvent).detail));
  expect(root.querySelector<HTMLElement>("[data-continue]")!.hasAttribute("disabled")).toBe(true);
  const section = root.querySelector<HTMLElement>("till-dead-ends-section")!;
  section.dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
  await el.updateComplete;
  root.querySelector<HTMLElement>("[data-continue]")!.click();
  expect(results).toEqual([{ choices: { "0": "kitchen" }, removed: [] }]);
});

it("removes a counter dish and lets the waiter cancel", async () => {
  const { el } = await mountWidget<TillDeadEndsDialog>("till-dead-ends-dialog", {
    answer,
    allowRemove: true,
  });
  const results: unknown[] = [];
  el.addEventListener("dead-ends-continue", (event) => results.push((event as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!.dispatchEvent(
    new CustomEvent("remove", { detail: { key: "0" } }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
  expect(results).toEqual([{ choices: {}, removed: ["0"] }]);
  const cancelled: string[] = [];
  el.addEventListener("dead-ends-cancel", () => cancelled.push("cancel"));
  el.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
  expect(cancelled).toEqual(["cancel"]);
});

it("does not offer Remove on an already stored bill", async () => {
  const { el } = await mountWidget<TillDeadEndsDialog>("till-dead-ends-dialog", {
    answer,
    allowRemove: false,
  });
  expect(
    el
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .hasAttribute("allowremove"),
  ).toBe(false);
  expect(el.shadowRoot!.querySelector<HTMLElement>(".remove")).toBeNull();
});

const buttonFill = (host: Element) =>
  getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;

it.each(["light", "dark"] as const)(
  "draws Continue quiet like Cancel until every dish has somewhere to go, then blue (%s theme)",
  async (theme) => {
    setLocale("en");
    const { el } = await mountWidget<TillDeadEndsDialog>(
      "till-dead-ends-dialog",
      { answer, allowRemove: true },
      theme,
    );
    const root = el.shadowRoot!;
    const proceed = root.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-continue]")!;
    const cancelFill = buttonFill(root.querySelector("[data-cancel]")!);
    await proceed.updateComplete;
    expect(proceed.hasAttribute("disabled")).toBe(true);
    expect(proceed.getAttribute("variant")).toBe("secondary");
    expect(buttonFill(proceed)).toBe(cancelFill);
    root
      .querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await el.updateComplete;
    await proceed.updateComplete;
    expect(proceed.hasAttribute("disabled")).toBe(false);
    expect(proceed.getAttribute("variant")).toBe("primary");
    expect(buttonFill(proceed)).not.toBe(cancelFill);
  },
);
