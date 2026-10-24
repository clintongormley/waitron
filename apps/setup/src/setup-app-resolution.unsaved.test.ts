import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { leaveCoordinatorFor, type WtInput } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, wizardApi } from "../test/first-setup-browser.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});
it("asks before discarding the interrupted password draft and restores its native control", async () => {
  const { api, requests } = wizardApi({ claimed: true });
  const { el } = await mountWidget<SetupApp>("setup-app", { api });
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=resume-password]"))
    .not.toBeNull();
  const field = el.shadowRoot!.querySelector<WtInput>("[data-test=resume-password]")!;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(input, "synthetic private draft");
  const coordinator = leaveCoordinatorFor(el)!;
  expect(coordinator.isDirty()).toBe(true);
  let proceeded = false;
  const pending = coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      proceeded = true;
    },
  });
  const warning = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
    "wt-unsaved-changes",
  )!;
  await expect.poll(() => warning.open).toBe(true);
  expect(proceeded).toBe(false);
  warning.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await pending).toBe("proceeded");
  await el.updateComplete;
  expect(input.value).toBe("");
  expect(coordinator.isDirty()).toBe(false);
  expect(requests.some((r) => /\/(recover|start-again|provision)$/.test(r.path))).toBe(false);
});

it("asks before leaving an entered setup password for backup recovery", async () => {
  const { api } = wizardApi({
    claimed: true,
    intercept(path) {
      if (path.endsWith("/backup/status"))
        return Response.json({ phase: "unstarted", proofRequired: true });
    },
  });
  const { el } = await mountWidget<SetupApp>("setup-app", { api });
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=resume-password]"))
    .not.toBeNull();
  const field = el.shadowRoot!.querySelector<WtInput>("[data-test=resume-password]")!;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, "private repair draft");
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=recover-backup]")!;
  await userEvent.click(button.shadowRoot!.querySelector("button")!);
  await expect
    .poll(
      () =>
        el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("wt-unsaved-changes")!.open,
    )
    .toBe(true);
  expect(el.shadowRoot!.querySelector("setup-first-backup")).toBeNull();
  el.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => el.shadowRoot!.querySelector("setup-first-backup")).not.toBeNull();
  const repair = el.shadowRoot!.querySelector("setup-first-backup")!;
  repair.dispatchEvent(
    new CustomEvent("setup-goto", {
      detail: { screen: "first-owner" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=resume-password]"))
    .not.toBeNull();
  const restored = el.shadowRoot!.querySelector<WtInput>("[data-test=resume-password]")!;
  await restored.updateComplete;
  expect(restored.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
});
