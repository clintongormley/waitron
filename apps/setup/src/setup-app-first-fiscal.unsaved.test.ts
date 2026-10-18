import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens, leaveCoordinatorFor } from "@waitron/ui";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { wizardApi, venue } from "../test/first-setup-browser.js";
const hosts: HTMLElement[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.remove());
  await new Promise((resolve) => setTimeout(resolve, 0));
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
function emit(app: SetupApp, name: string, detail?: unknown) {
  app
    .shadowRoot!.querySelector("main")!
    .dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function screen(app: SetupApp, name: string) {
  await expect
    .poll(() => app.shadowRoot!.querySelector(`[data-test=screen-${name}]`))
    .not.toBeNull();
  const el = app.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    `[data-test=screen-${name}]`,
  )!;
  await el.updateComplete;
  return el;
}
it("protects a nested module draft through the wizard's real leave coordinator", async () => {
  const { api } = wizardApi();
  const host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  hosts.push(host);
  const app = new SetupApp();
  app.api = api;
  host.append(app);
  await screen(app, "mode");
  emit(app, "setup-patch", { patch: { mode: "live", venue } });
  emit(app, "setup-goto", { screen: "venue" });
  await screen(app, "venue");
  emit(app, "setup-advance");
  await screen(app, "cert");
  emit(app, "setup-goto", { screen: "review" });
  const shell = await screen(app, "first-setup");
  const module = shell.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("vf-first-fiscal-screen")!;
  await module.updateComplete;
  const hour = module.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "vf-first-setup-hour",
  )!;
  await hour.updateComplete;
  const answer = hour.shadowRoot!.querySelector<HTMLInputElement>(
    'input[name="taxpayer-hour"][value="yes"]',
  )!;
  await userEvent.click(answer);
  await hour.updateComplete;
  expect(leaveCoordinatorFor(module)!.isDirty([shell])).toBe(true);
  const parent = module.parentElement!;
  module.remove();
  await module.updateComplete;
  parent.append(module);
  await module.updateComplete;
  expect(leaveCoordinatorFor(module)!.isDirty([shell])).toBe(true);
  emit(app, "setup-goto", { screen: "email" });
  const warning = app.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  const closed = new Promise<void>((resolve) =>
    warning
      .shadowRoot!.querySelector("wt-modal")!
      .addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.click(warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  await closed;
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("[data-test=screen-first-setup]")).not.toBeNull();
  expect(
    hour.shadowRoot!.querySelector<HTMLInputElement>('input[name="taxpayer-hour"][value="yes"]')!
      .checked,
  ).toBe(true);
  emit(app, "setup-goto", { screen: "email" });
  await expect.poll(() => warning.open).toBe(true);
  warning.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen(app, "email");
});
