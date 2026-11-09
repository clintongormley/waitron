import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import type { FreshSignInDialog } from "./fresh-sign-in-dialog.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
import "./fresh-sign-in-dialog.js";

class ProofLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-fresh-sign-in-dialog .api=${this.api}></dashboard-fresh-sign-in-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("proof-leave-test-app", ProofLeaveApp);
afterEach(cleanupWidgets);
it("a typed proof can be kept on Escape, then discarded without carrying out the action", async () => {
  const confirmFreshSignIn = vi.fn();
  const { el: app } = await mountWidget<ProofLeaveApp>("proof-leave-test-app", {
    api: {
      getProfile: async () => ({
        displayName: "Marta",
        firstNames: "Marta",
        lastNames: "",
        telephone: null,
        email: "marta@example.test",
        pendingEmail: null,
        locale: null,
        hasPassword: true,
        hasTotp: false,
        hasGoogle: false,
        passkeys: [],
      }),
      confirmFreshSignIn,
    } as unknown as DashboardApi,
  });
  const host = app.shadowRoot!.querySelector<FreshSignInDialog>("dashboard-fresh-sign-in-dialog")!;
  const result = host.show(new AbortController().signal);
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  const signIn = host.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")!;
  await expect.poll(() => signIn.ways).not.toBeNull();
  const password = signIn.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=current-password]",
  )!;
  await password.updateComplete;
  password.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("typed password");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => question.open).toBe(false);
  expect(password.value).toBe("typed password");
  expect(dialog.open).toBe(true);
  password.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => question.open).toBe(true);
  const closed = dialogClosed(dialog);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await closed;
  expect(await result).toBe(false);
  expect(signIn.typed).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(confirmFreshSignIn).not.toHaveBeenCalled();
});
