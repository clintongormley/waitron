import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type Screen } from "./setup-app.js";
import type { SetupApi } from "./api/client.js";
import type { SetupResetScreen } from "./screens/reset-screen.js";
import type { WtInput } from "@waitron/ui/src/components/wt-input.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
const field = (form: SetupResetScreen, key: string) =>
  form.shadowRoot!.querySelector<WtInput>(`[data-test=${key}]`)!;
const screen = (el: SetupApp) => (el as unknown as { screen: Screen }).screen;
async function mount() {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    resetIncompleteAdopt: vi.fn().mockResolvedValue({ resetStaged: true, restarting: true }),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect(screen(el)).toBe("mode"));
  Object.assign(el, { screen: "reset" });
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector<SetupResetScreen>("setup-reset-screen")!;
  await form.updateComplete;
  return { el, form, host, api };
}
async function edit(form: SetupResetScreen, key: string, value: string) {
  field(form, key).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
}
function back(form: SetupResetScreen) {
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
async function fill(form: SetupResetScreen) {
  await edit(form, "personId", "  operator-1  ");
  await edit(form, "password", " secret ");
}

describe("setup Reset unsaved changes", () => {
  it.each(["personId", "password"])(
    "Back keeps the edited %s until Discard, restoring only the child",
    async (key) => {
      const { el, form } = await mount();
      form.dispatchEvent(
        new CustomEvent("setup-patch", {
          detail: { patch: { admin: { email: "root@example.test" } } },
          bubbles: true,
          composed: true,
        }),
      );
      await edit(form, key, " edited ");
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      expect(screen(el)).toBe("reset");
      await choose(el, "keep");
      expect(field(form, key).value).toBe(" edited ");
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      await choose(el, "discard");
      await expect.poll(() => screen(el)).toBe("provisioning");
      expect(field(form, key).value).toBe("");
      expect(leaveCoordinatorFor(el)!.isDirty([el])).toBe(true);
    },
  );

  it("clean Back goes directly to Provisioning", async () => {
    const { el, form } = await mount();
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("provisioning");
    expect(warning(el).open).toBe(false);
  });

  it.each(["personId"])(
    "%s compares its trimmed request value and clears unload after a revert",
    async (key) => {
      const { el, form } = await mount();
      await edit(form, key, "edited");
      expect(unload()).toBe(true);
      await edit(form, key, "   ");
      expect(unload()).toBe(false);
      back(form);
      await expect.poll(() => screen(el)).toBe("provisioning");
      expect(warning(el).open).toBe(false);
    },
  );

  it("password whitespace remains protected and an exact revert clears it", async () => {
    const { el, form } = await mount();
    await edit(form, "password", " ");
    expect(unload()).toBe(true);
    await edit(form, "password", "");
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("provisioning");
  });

  it("native warning Escape preserves the password and returns focus to Back", async () => {
    const { el, form } = await mount();
    const input = field(form, "password").shadowRoot!.querySelector<HTMLInputElement>("input")!;
    await userEvent.fill(page.elementLocator(input), " secret ");
    const button = form.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!;
    await userEvent.click(page.elementLocator(button));
    await expect.poll(() => warning(el).open).toBe(true);
    const modal = warning(el).shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => warning(el).open).toBe(false);
    expect(input.value).toBe(" secret ");
    expect(screen(el)).toBe("reset");
    await expect.poll(() => form.shadowRoot!.activeElement).toBe(button);
  });

  it("Reset sends the existing exact body directly and an accepted outcome clears unload", async () => {
    const { el, form, api } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await expect
      .poll(() => form.shadowRoot!.querySelector("[data-test=outcome]")?.textContent)
      .toContain("resetting");
    expect(api.resetIncompleteAdopt).toHaveBeenCalledExactlyOnceWith({
      personId: "operator-1",
      password: " secret ",
    });
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(false);
  });

  it("a refused Reset retains and protects the credentials", async () => {
    const { el, form, api } = await mount();
    vi.mocked(api.resetIncompleteAdopt).mockRejectedValue({ code: "password.invalid" });
    await fill(form);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await expect.poll(() => form.credentialsRejected).toBe(true);
    expect(field(form, "personId").value).toBe("  operator-1  ");
    expect(field(form, "password").value).toBe(" secret ");
    expect(unload()).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(form, "password").value).toBe(" secret ");
  });

  it("invalid submission retains the draft and still asks on Back", async () => {
    const { el, form, api } = await mount();
    await edit(form, "password", " ");
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await form.updateComplete;
    expect(api.resetIncompleteAdopt).not.toHaveBeenCalled();
    expect(field(form, "password").invalid).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("provisioning");
  });

  it("an edit cancels a stale Back answer", async () => {
    const { el, form } = await mount();
    await edit(form, "password", "first");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await edit(form, "password", "newer");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("reset");
    expect(field(form, "password").value).toBe("newer");
    expect(unload()).toBe(true);
  });

  it("removing only the Reset child releases its unload protection and question", async () => {
    const { el, form } = await mount();
    await edit(form, "password", "secret");
    expect(unload()).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    form.remove();
    await expect.poll(() => warning(el).open).toBe(false);
    expect(unload()).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("reset");
  });

  it("rereseting keeps the original baseline and cannot revive a stale Back", async () => {
    const { el, form, host } = await mount();
    await edit(form, "password", "secret");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    el.remove();
    expect(unload()).toBe(false);
    host.append(el);
    await el.updateComplete;
    await form.updateComplete;
    expect(unload()).toBe(true);
    await choose(el, "discard");
    expect(screen(el)).toBe("reset");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("provisioning");
    expect(field(form, "password").value).toBe("");
  });
  it.each(["success", "refusal"])(
    "a departed Reset's late %s cannot change the replacement owner",
    async (answer) => {
      const { el, form, api } = await mount();
      let resolve!: (value: { resetStaged: true; restarting: true }) => void;
      let reject!: (error: { code: string }) => void;
      const pending = new Promise<{ resetStaged: true; restarting: true }>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      vi.mocked(api.resetIncompleteAdopt).mockReturnValue(pending);
      await fill(form);
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
      await expect.poll(() => form.busy).toBe(true);
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      await choose(el, "discard");
      await expect.poll(() => screen(el)).toBe("provisioning");
      Object.assign(el, { screen: "reset" });
      await el.updateComplete;
      const replacement = el.shadowRoot!.querySelector<SetupResetScreen>("setup-reset-screen")!;
      await replacement.updateComplete;
      await edit(replacement, "password", "replacement secret");
      if (answer === "success") resolve({ resetStaged: true, restarting: true });
      else reject({ code: "password.invalid" });
      await pending.catch(() => {});
      await el.updateComplete;
      await replacement.updateComplete;
      expect(replacement.outcome).toBeUndefined();
      expect(replacement.credentialsRejected).toBe(false);
      expect(field(replacement, "password").value).toBe("replacement secret");
      expect(replacement.busy).toBe(false);
      expect(unload()).toBe(true);
    },
  );

  it("a terminal refusal removes the credential form's unload scope", async () => {
    const { el, form, api } = await mount();
    vi.mocked(api.resetIncompleteAdopt).mockRejectedValue({ code: "setup.reset_unavailable" });
    await fill(form);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await expect.poll(() => form.outcome?.kind).toBe("refused");
    await form.updateComplete;
    expect(field(form, "password")).toBeNull();
    expect(unload()).toBe(false);
    expect(warning(el).open).toBe(false);
  });

  it("a reply from the previous shell connection cannot replace the reconnected draft", async () => {
    const { el, form, api, host } = await mount();
    let resolve!: (value: { resetStaged: true; restarting: true }) => void;
    const pending = new Promise<{ resetStaged: true; restarting: true }>((yes) => {
      resolve = yes;
    });
    vi.mocked(api.resetIncompleteAdopt).mockReturnValue(pending);
    await fill(form);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await expect.poll(() => form.busy).toBe(true);
    el.remove();
    host.append(el);
    await el.updateComplete;
    await form.updateComplete;
    await edit(form, "password", "new connection secret");
    resolve({ resetStaged: true, restarting: true });
    await pending;
    await el.updateComplete;
    await form.updateComplete;
    expect(form.outcome).toBeUndefined();
    expect(form.busy).toBe(false);
    expect(field(form, "password").value).toBe("new connection secret");
    expect(unload()).toBe(true);
  });
});
