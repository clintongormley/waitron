import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";

class PartyNameHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<till-table-order-screen
        .party=${{
          id: "v1",
          revision: 3,
          guestCount: 3,
          state: "open",
          name: "Ana",
          displayName: "Ana",
          mainBillId: "wo-4",
          outstanding: "0.00",
          billCount: 1,
          tableIds: [],
          unsentDrafts: [],
          reminder: null,
        }}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("party-name-screen-test-host", PartyNameHost);
afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));
it("the table screen protects a refused name against the stored name and discards without submitting", async () => {
  const { el: app } = await mountWidget<PartyNameHost>("party-name-screen-test-host", {});
  const screen = app.shadowRoot!.querySelector("till-table-order-screen")!;
  await screen.updateComplete;
  const names: unknown[] = [];
  screen.addEventListener("name-party", (event) => names.push((event as CustomEvent).detail));
  screen.nameRefusal = { name: "Luis", message: "Name refused" };
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("till-party-name-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(input.value).toBe("Luis");
  expect(field.error).toBe("Name refused");
  await userEvent.click(
    page.elementLocator(form.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!),
  );
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  expect(question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => question.open).toBe(false);
  expect(input.value).toBe("Luis");
  expect(screen.shadowRoot!.querySelector("till-party-name-dialog")).toBe(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();
  await app.updateComplete;
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
  expect(names).toEqual([]);
});
