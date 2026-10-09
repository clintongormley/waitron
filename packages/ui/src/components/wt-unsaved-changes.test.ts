import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import * as ui from "../index.js";

afterEach(cleanup);

function focused(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

async function expectChoiceFocus(el: ui.WtUnsavedChanges, choice: "keep" | "discard") {
  const button = el
    .shadowRoot!.querySelector(`wt-button[data-choice="${choice}"]`)!
    .shadowRoot!.querySelector("button")!;
  await expect.poll(focused).toBe(button);
}

test("exports and registers the shared unsaved changes confirmation", () => {
  expect(ui.WtUnsavedChanges).toBe(customElements.get("wt-unsaved-changes"));
  expect(customElements.get("wt-unsaved-changes")).toBeTypeOf("function");
});

async function confirmation() {
  const el = (await mount("<wt-unsaved-changes></wt-unsaved-changes>")) as ui.WtUnsavedChanges;
  el.heading = "Discard unsaved changes?";
  el.message = "Your changes have not been saved.";
  el.keepLabel = "Keep editing";
  el.discardLabel = "Discard changes";
  el.open = true;
  await el.updateComplete;
  return el;
}

test("opens above the editor with Keep editing focused and supplied copy visible", async () => {
  const el = await confirmation();
  const dialog = el.shadowRoot!.querySelector("wt-modal")?.shadowRoot?.querySelector("dialog");
  expect(dialog?.open).toBe(true);
  expect(dialog?.matches(":modal")).toBe(true);
  await expectChoiceFocus(el, "keep");
  await expect.element(page.getByText("Your changes have not been saved.")).toBeVisible();
  expect(dialog?.getAttribute("aria-describedby")).toBeTruthy();
});

test.each(["keep", "discard"] as const)(
  "emits one composed %s choice and stops its triggering click",
  async (decision) => {
    const el = await confirmation();
    const choices: CustomEvent[] = [];
    const clicks = vi.fn();
    host.addEventListener("wt-unsaved-choice", (event) => choices.push(event as CustomEvent));
    host.addEventListener("click", clicks);
    await userEvent.click(
      page.getByRole("button", { name: decision === "keep" ? "Keep editing" : "Discard changes" }),
    );
    await vi.waitFor(() => expect(choices).toHaveLength(1));
    expect(choices[0]!.detail).toEqual({ decision });
    expect(choices[0]!.composed).toBe(true);
    expect(choices[0]!.bubbles).toBe(true);
    expect(clicks).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
      ).toBe(false),
    );
    expect(choices).toHaveLength(1);
  },
);

test("Escape chooses Keep editing and a later opening can choose Discard", async () => {
  const el = await confirmation();
  const choices: string[] = [];
  el.addEventListener("wt-unsaved-choice", (event) =>
    choices.push((event as CustomEvent).detail.decision),
  );
  const closed = new Promise((resolve) =>
    el.shadowRoot!.querySelector("wt-modal")!.addEventListener("wt-close", resolve, { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  await vi.waitFor(() => expect(choices).toEqual(["keep"]));
  el.open = true;
  await el.updateComplete;
  await userEvent.click(page.getByRole("button", { name: "Discard changes" }));
  await vi.waitFor(() => expect(choices).toEqual(["keep", "discard"]));
});

test("owner abort closes the question without a discard or keep choice", async () => {
  const el = await confirmation();
  const choices = vi.fn();
  el.addEventListener("wt-unsaved-choice", choices);
  el.open = false;
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(false),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(choices).not.toHaveBeenCalled();
});

test("orders Keep then Discard for keyboard users and draws its inherited tokens", async () => {
  const el = await confirmation();
  await expectChoiceFocus(el, "keep");
  await userEvent.keyboard("{Tab}");
  await expectChoiceFocus(el, "discard");
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expectChoiceFocus(el, "keep");
  el.style.setProperty("--wt-color-surface-raised", "rgb(12, 34, 56)");
  el.style.setProperty("--wt-space-5", "9px");
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  expect(getComputedStyle(modal.shadowRoot!.querySelector("dialog")!).backgroundColor).toBe(
    "rgb(12, 34, 56)",
  );
  expect(getComputedStyle(modal.shadowRoot!.querySelector(".body")!).paddingTop).toBe("9px");
});
