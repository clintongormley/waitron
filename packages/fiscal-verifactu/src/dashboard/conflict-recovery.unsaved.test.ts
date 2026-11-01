import { afterEach, expect, it } from "vitest";
import { render } from "lit";
import { leaveCoordinatorFor } from "@waitron/ui";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { ConflictRecovery } from "./conflict-recovery.js";

let host: HTMLElement;
afterEach(() => host?.remove());
const unload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  render(
    VERIFACTU_DASHBOARD.publicPages![0]!.create({
      request: async () => {
        throw new Error("Unexpected request");
      },
      locale: "en",
    }).render(),
    host,
  );
  const screen = host.querySelector("vf-conflict-recovery") as ConflictRecovery;
  await screen.updateComplete;
  return screen;
}
it("protects a typed recovery key on leaving, and Stop releases that draft", async () => {
  const screen = await mount();
  expect(unload()).toBe(false);
  screen.shadowRoot!.querySelector("wt-input")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "private-key" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(leaveCoordinatorFor(screen)?.isDirty()).toBe(true);
  expect(unload()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-action=stop]")!.click();
  await screen.updateComplete;
  expect(unload()).toBe(false);
  expect(leaveCoordinatorFor(screen)?.isDirty()).toBe(false);
  expect(
    screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
  ).toBe("");
});
it("discards the key through the shared leave question, without making a request", async () => {
  const screen = await mount();
  screen.shadowRoot!.querySelector("wt-input")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "private-key" },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  const leave = leaveCoordinatorFor(screen);
  expect(leave).toBeDefined();
  let left = false;
  const result = leave!.request({
    scopes: "all",
    reason: "navigation",
    signal: new AbortController().signal,
    proceed: () => {
      left = true;
    },
  });
  await screen.updateComplete;
  const question = screen.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await (question as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await result).toBe("proceeded");
  expect(left).toBe(true);
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
  ).toBe("");
});
