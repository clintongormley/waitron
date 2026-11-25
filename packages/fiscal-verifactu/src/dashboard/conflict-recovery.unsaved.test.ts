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
  await screen.shadowRoot!.querySelector("wt-master-key-input")!.updateComplete;
  return screen;
}
function keyInput(screen: ConflictRecovery): HTMLElement {
  return screen
    .shadowRoot!.querySelector("wt-master-key-input")!
    .shadowRoot!.querySelector("wt-input")!;
}
it("protects a typed master key on leaving, and Stop releases that draft", async () => {
  const screen = await mount();
  expect(unload()).toBe(false);
  keyInput(screen).dispatchEvent(
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
  expect(keyInput(screen).shadowRoot!.querySelector("input")!.value).toBe("");
});
it("discards the key through the shared leave question, without making a request", async () => {
  const screen = await mount();
  keyInput(screen).dispatchEvent(
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
  expect(keyInput(screen).shadowRoot!.querySelector("input")!.value).toBe("");
});
it("counts a partly typed key as the page's own draft", async () => {
  const screen = await mount();
  const input = keyInput(screen).shadowRoot!.querySelector("input")!;
  input.value = "ABCD";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await screen.updateComplete;
  expect(leaveCoordinatorFor(screen)?.isDirty([screen])).toBe(true);
});
