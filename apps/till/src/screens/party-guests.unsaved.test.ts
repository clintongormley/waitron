import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";

class PartyGuestsHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<till-table-order-screen
        .party=${{
          kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 3 },
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
customElements.define("party-guests-screen-test-host", PartyGuestsHost);
afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));
it("the table screen protects a refused count against the stored count and discards without submitting", async () => {
  const { el: app } = await mountWidget<PartyGuestsHost>("party-guests-screen-test-host", {});
  const screen = app.shadowRoot!.querySelector("till-table-order-screen")!;
  await screen.updateComplete;
  const counts: unknown[] = [];
  screen.addEventListener("guests-party", (event) => counts.push((event as CustomEvent).detail));
  screen.guestsRefusal = { value: "1000", message: "Count refused" };
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("till-party-guests-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(input.value).toBe("1000");
  expect(field.error).toBe("Count refused");
  await userEvent.click(
    page.elementLocator(form.shadowRoot!.querySelector<HTMLElement>("[data-guests-cancel]")!),
  );
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  expect(question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => question.open).toBe(false);
  expect(input.value).toBe("1000");
  expect(screen.shadowRoot!.querySelector("till-party-guests-dialog")).toBe(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-guests-cancel]")!.click();
  await app.updateComplete;
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("till-party-guests-dialog")).toBeNull();
  expect(counts).toEqual([]);
});
