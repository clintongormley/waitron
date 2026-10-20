import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { SetupEmailScreen } from "./email-screen.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
afterEach(cleanupWidgets);
it("explains missing original publication settings on the first Continue attempt", async () => {
  const { el } = await mountWidget<SetupEmailScreen>("setup-email-screen", {
    publicationOnly: true,
  });
  const next = el.shadowRoot!.querySelector<WtButton>("[data-test=next]")!;
  expect(next.disabled).toBe(false);
  expect(el.shadowRoot!.querySelector<WtInput>("[data-test=server]")!.invalid).toBe(false);
  await userEvent.click(next.shadowRoot!.querySelector("button")!);
  await el.updateComplete;
  expect(next.disabled).toBe(true);
  expect(el.shadowRoot!.querySelector<WtInput>("[data-test=server]")!.invalid).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
  ).toBeTruthy();
  expect(el.shadowRoot!.querySelector("[data-test=test]")).toBeNull();
});

it("publication re-entry neither promises nor sends a test email", async () => {
  const { el } = await mountWidget<SetupEmailScreen>("setup-email-screen", {
    publicationOnly: true,
  });
  expect(el.shadowRoot!.querySelector(".intro")!.textContent).toContain(
    "Re-enter the email settings used for this setup.",
  );
});
