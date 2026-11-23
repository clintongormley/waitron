import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type Screen } from "./setup-app.js";
import type { SetupApi } from "./api/client.js";
import type { SetupConnectScreen } from "./screens/connect-screen.js";
import type { WtInput } from "@waitron/ui/src/components/wt-input.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import {
  APPROVED,
  MAIN,
  finishRequested,
  forgetJoin,
  joinScreen,
  joinStubs,
} from "../test/join-browser.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  forgetJoin();
});

const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
const address = (form: SetupConnectScreen) =>
  form.shadowRoot!.querySelector<WtInput>("[data-test=primaryUrl]")!;
const screen = (el: SetupApp) => (el as unknown as { screen: Screen }).screen;

async function mount() {
  const api = {
    firstSetupStatus: vi.fn().mockResolvedValue({ claimed: false }),
    firstSetupOfferings: vi.fn().mockResolvedValue({ modules: [] }),
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    ...joinStubs(),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect(screen(el)).toBe("mode"));
  // Arriving from the join-or-recover choice page is what sends Back there.
  Object.assign(el, { screen: "role" });
  await el.updateComplete;
  Object.assign(el, { screen: "connect" });
  await el.updateComplete;
  const form = (await joinScreen(el)) as SetupConnectScreen;
  return { el, form, host, api };
}
async function edit(form: SetupConnectScreen, value: string) {
  address(form).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
}
function back(form: SetupConnectScreen) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
}
async function choose(el: SetupApp, decision: "keep" | "discard") {
  warning(el).dispatchEvent(
    new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("setup Connect unsaved changes", () => {
  it("Back keeps the edited address until Discard, restoring only the child", async () => {
    const { el, form } = await mount();
    form.dispatchEvent(
      new CustomEvent("setup-patch", {
        detail: { patch: { admin: { email: "root@example.test" } } },
        bubbles: true,
        composed: true,
      }),
    );
    await edit(form, " edited ");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    expect(screen(el)).toBe("connect");
    await choose(el, "keep");
    expect(address(form).value).toBe(" edited ");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("role");
    expect(address(form).value).toBe("");
    expect(leaveCoordinatorFor(el)!.isDirty([el])).toBe(true);
  });

  it("clean Back goes directly to Role", async () => {
    const { el, form } = await mount();
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
    expect(warning(el).open).toBe(false);
  });

  it("the address compares its trimmed value and clears unload after a revert", async () => {
    const { el, form } = await mount();
    await edit(form, "edited");
    expect(unload()).toBe(true);
    await edit(form, "   ");
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
    expect(warning(el).open).toBe(false);
  });

  it("native warning Escape preserves the address and returns focus to Back", async () => {
    const { el, form } = await mount();
    const input = address(form).shadowRoot!.querySelector<HTMLInputElement>("input")!;
    await userEvent.fill(page.elementLocator(input), MAIN);
    const button = form.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!;
    await userEvent.click(page.elementLocator(button));
    await expect.poll(() => warning(el).open).toBe(true);
    const modal = warning(el).shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    const closed = new Promise((resolve) =>
      warning(el)
        .shadowRoot!.querySelector("wt-modal")!
        .addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await expect.poll(() => warning(el).open).toBe(false);
    expect(input.value).toBe(MAIN);
    expect(screen(el)).toBe("connect");
    await expect.poll(() => form.shadowRoot!.activeElement).toBe(button);
  });

  it("Join and Finish joining go on without asking, and success clears unload", async () => {
    const { el, form, api } = await mount();
    vi.mocked(api.joinState).mockResolvedValue(APPROVED);
    const requested = finishRequested(el);
    await edit(form, MAIN);
    expect(unload()).toBe(true);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=join]")!.click();
    await vi.waitFor(() =>
      expect(form.shadowRoot!.querySelector("[data-test=code]")).not.toBeNull(),
    );
    expect(api.startJoin).toHaveBeenCalledOnce();
    expect(unload()).toBe(false);
    await requested;
    await expect.poll(() => screen(el)).toBe("done");
    expect(api.finishJoin).toHaveBeenCalledOnce();
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(false);
  });

  it("an address the box refuses keeps the draft and still asks on Back", async () => {
    const { el, form, api } = await mount();
    vi.mocked(api.startJoin).mockRejectedValue({ code: "mirror.primary_url_invalid" });
    await edit(form, "https://192.168.1.10");
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=join]")!.click();
    await vi.waitFor(() => expect(address(form).invalid).toBe(true));
    expect(api.finishJoin).not.toHaveBeenCalled();
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("role");
  });

  it("an edit cancels a stale Back answer", async () => {
    const { el, form } = await mount();
    await edit(form, "first");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await edit(form, "newer");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("connect");
    expect(address(form).value).toBe("newer");
    expect(unload()).toBe(true);
  });

  it("removing only the Connect child releases its unload protection and question", async () => {
    const { el, form } = await mount();
    await edit(form, MAIN);
    expect(unload()).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    form.remove();
    await expect.poll(() => warning(el).open).toBe(false);
    expect(unload()).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("connect");
  });

  it("reconnecting keeps the original baseline and cannot revive a stale Back", async () => {
    const { el, form, host } = await mount();
    await edit(form, MAIN);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    el.remove();
    expect(unload()).toBe(false);
    host.append(el);
    await el.updateComplete;
    await form.updateComplete;
    expect(unload()).toBe(true);
    await choose(el, "discard");
    expect(screen(el)).toBe("connect");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("role");
    expect(address(form).value).toBe("");
  });
});
