import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type Screen } from "./setup-app.js";
import type { SetupApi } from "./api/client.js";
import type { SetupRestoreScreen } from "./screens/restore-screen.js";
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
const screen = (el: SetupApp) => (el as unknown as { screen: Screen }).screen;
const q = <T extends HTMLElement>(form: SetupRestoreScreen, selector: string) =>
  form.shadowRoot!.querySelector<T>(selector)!;
const key = (form: SetupRestoreScreen) => q<WtInput>(form, "[data-test=recovery-key]");
const artifact = (form: SetupRestoreScreen) => q<HTMLInputElement>(form, "[data-test=artifact]");
const backup = new File(["encrypted"], "waitron.backup");
async function mount() {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    restore: vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true }),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect(screen(el)).toBe("mode"));
  Object.assign(el, { screen: "restore" });
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector<SetupRestoreScreen>("setup-restore-screen")!;
  await form.updateComplete;
  return { el, form, host, api };
}
async function edit(form: SetupRestoreScreen, field: string) {
  if (field === "artifact") {
    const files = new DataTransfer();
    files.items.add(backup);
    artifact(form).files = files.files;
    artifact(form).dispatchEvent(new Event("change"));
  } else {
    q(form, `[data-test=${field}]`).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: field === "environment" ? "preproduction" : " secret " },
        bubbles: true,
        composed: true,
      }),
    );
  }
  await form.updateComplete;
}
function back(form: SetupRestoreScreen, destination = "back") {
  q(form, `[data-test=${destination}]`).click();
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
async function fill(form: SetupRestoreScreen) {
  await edit(form, "artifact");
  await edit(form, "recovery-key");
  await edit(form, "environment");
  const ack = q<HTMLInputElement>(form, "[data-test=acknowledge]");
  ack.checked = true;
  ack.dispatchEvent(new Event("change"));
  await form.updateComplete;
}

describe("setup archive restore unsaved changes", () => {
  it.each(["artifact", "recovery-key", "environment"])(
    "Back preserves edited %s until Discard, restoring only the child",
    async (field) => {
      const { el, form } = await mount();
      form.dispatchEvent(
        new CustomEvent("setup-patch", {
          detail: { patch: { admin: { email: "root@example.test" } } },
          bubbles: true,
          composed: true,
        }),
      );
      await edit(form, field);
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      expect(screen(el)).toBe("restore");
      await choose(el, "keep");
      if (field === "artifact") expect(artifact(form).files?.[0]).toBe(backup);
      else
        expect((q(form, `[data-test=${field}]`) as WtInput).value).toBe(
          field === "environment" ? "preproduction" : " secret ",
        );
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      await choose(el, "discard");
      await expect.poll(() => screen(el)).toBe("role");
      expect(artifact(form).files).toHaveLength(0);
      expect(key(form).value).toBe("");
      expect((q(form, "[data-test=environment]") as WtInput).value).toBe("production");
      expect(leaveCoordinatorFor(el)!.isDirty([el])).toBe(true);
    },
  );
  it("Cloud recovery navigation preserves the archive form on Keep", async () => {
    const { el, form } = await mount();
    await fill(form);
    back(form, "cloud-restore");
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(screen(el)).toBe("restore");
    expect(key(form).value).toBe(" secret ");
    expect(artifact(form).files?.[0]).toBe(backup);
    back(form, "cloud-restore");
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("cloud-restore");
    expect(unload()).toBe(false);
  });
  it("clean Back is direct", async () => {
    const { el, form } = await mount();
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
    expect(warning(el).open).toBe(false);
  });
  it("safety acknowledgements alone stay exempt", async () => {
    const { el, form } = await mount();
    const ack = q<HTMLInputElement>(form, "[data-test=acknowledge]");
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await form.updateComplete;
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
    expect(warning(el).open).toBe(false);
  });
  it("reverting all authoring fields clears unload and leaves directly", async () => {
    const { el, form } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    artifact(form).value = "";
    artifact(form).dispatchEvent(new Event("change"));
    for (const [field, value] of [
      ["recovery-key", ""],
      ["environment", "production"],
    ])
      q(form, `[data-test=${field}]`).dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
    await form.updateComplete;
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
  });
  it("native warning Escape preserves the exact recovery key and returns focus", async () => {
    const { el, form } = await mount();
    const input = key(form).shadowRoot!.querySelector<HTMLInputElement>("input")!;
    await userEvent.fill(page.elementLocator(input), " secret ");
    const button = q(form, "[data-test=back]");
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
    expect(input.value).toBe(" secret ");
    expect(screen(el)).toBe("restore");
    await expect.poll(() => form.shadowRoot!.activeElement).toBe(button);
  });
  it("Restore sends the existing exact arguments directly and success releases unload", async () => {
    const { el, form, api } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    q(form, "[data-test=restore]").click();
    await expect.poll(() => screen(el)).toBe("done");
    expect(api.restore).toHaveBeenCalledExactlyOnceWith(backup, " secret ", "preproduction", false);
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(false);
  });
  it("a refused request remains protected against the original empty form", async () => {
    const { el, form, api } = await mount();
    vi.mocked(api.restore).mockRejectedValue({ code: "restore.environment_mismatch" });
    await fill(form);
    q(form, "[data-test=restore]").click();
    await expect.poll(() => screen(el)).toBe("restore");
    await expect
      .poll(
        () =>
          el.shadowRoot!.querySelector<SetupRestoreScreen>("setup-restore-screen")?.request
            ?.artifact,
      )
      .toBe(backup);
    const returned = el.shadowRoot!.querySelector<SetupRestoreScreen>("setup-restore-screen")!;
    await returned.updateComplete;
    expect(unload()).toBe(true);
    expect(key(returned).value).toBe(" secret ");
    expect(artifact(returned).files?.[0]).toBe(backup);
    back(returned);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(key(returned).value).toBe(" secret ");
  });
  it("invalid submission retains and protects typed credentials", async () => {
    const { el, form, api } = await mount();
    await edit(form, "recovery-key");
    q(form, "[data-test=restore]").click();
    await form.updateComplete;
    expect(api.restore).not.toHaveBeenCalled();
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(key(form).value).toBe(" secret ");
  });
  it("editing during a question invalidates its old Discard", async () => {
    const { el, form } = await mount();
    await edit(form, "recovery-key");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await edit(form, "environment");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("restore");
    expect(key(form).value).toBe(" secret ");
    expect(unload()).toBe(true);
  });
  it("disconnect removes unload and reconnect restores the retained dirty draft", async () => {
    const { el, form, host } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    el.remove();
    expect(unload()).toBe(false);
    host.append(el);
    await el.updateComplete;
    expect(key(form).value).toBe(" secret ");
    expect(unload()).toBe(true);
  });
  it.each(["success", "refusal"])(
    "a departed restore %s cannot replace a new form",
    async (result) => {
      const { el, form, api } = await mount();
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      vi.mocked(api.restore).mockReturnValue(
        new Promise<Awaited<ReturnType<SetupApi["restore"]>>>((yes, no) => {
          resolve = () => yes({ restoreStaged: true, restarting: true });
          reject = no;
        }),
      );
      await fill(form);
      q(form, "[data-test=restore]").click();
      await expect.poll(() => screen(el)).toBe("provisioning");
      Object.assign(el, { screen: "restore" });
      await el.updateComplete;
      const replacement = el.shadowRoot!.querySelector<SetupRestoreScreen>("setup-restore-screen")!;
      await replacement.updateComplete;
      await edit(replacement, "recovery-key");
      if (result === "success") resolve();
      else reject({ code: "restore.environment_mismatch" });
      await new Promise((done) => setTimeout(done, 20));
      await el.updateComplete;
      expect(screen(el)).toBe("restore");
      expect(el.shadowRoot!.querySelector("setup-restore-screen")).toBe(replacement);
      expect(replacement.request).toBeUndefined();
      expect(replacement.errorMessage).toBeUndefined();
      expect(key(replacement).value).toBe(" secret ");
      expect(unload()).toBe(true);
    },
  );

  it.each(["success", "refusal"])(
    "a previous connection's restore %s cannot overwrite the reconnected wizard",
    async (result) => {
      const { el, form, host, api } = await mount();
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      vi.mocked(api.restore).mockReturnValue(
        new Promise<Awaited<ReturnType<SetupApi["restore"]>>>((yes, no) => {
          resolve = () => yes({ restoreStaged: true, restarting: true });
          reject = no;
        }),
      );
      await fill(form);
      q(form, "[data-test=restore]").click();
      await expect.poll(() => screen(el)).toBe("provisioning");
      el.remove();
      host.append(el);
      await el.updateComplete;
      const retained = el.shadowRoot!.querySelector("setup-provisioning-screen");
      if (result === "success") resolve();
      else reject({ code: "restore.environment_mismatch" });
      await new Promise((done) => setTimeout(done, 20));
      await el.updateComplete;
      expect(screen(el)).toBe("provisioning");
      expect(el.shadowRoot!.querySelector("setup-provisioning-screen")).toBe(retained);
      expect(warning(el).open).toBe(false);
      expect(unload()).toBe(false);
    },
  );
  it("removing only the archive child releases its unload scope", async () => {
    const { el, form } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    Object.assign(el, { screen: "role" });
    await el.updateComplete;
    expect(form.isConnected).toBe(false);
    expect(unload()).toBe(false);
  });

  it("recovery-key whitespace remains significant", async () => {
    const { el, form } = await mount();
    key(form).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: " " }, bubbles: true, composed: true }),
    );
    await form.updateComplete;
    expect(unload()).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(key(form).value).toBe(" ");
  });

  it.each(["success", "refusal"])(
    "an older restore %s cannot complete the newer pending attempt",
    async (result) => {
      const { el, form, api } = await mount();
      let resolveFirst!: () => void;
      let rejectFirst!: (error: unknown) => void;
      let resolveSecond!: () => void;
      vi.mocked(api.restore)
        .mockReturnValueOnce(
          new Promise<Awaited<ReturnType<SetupApi["restore"]>>>((yes, no) => {
            resolveFirst = () => yes({ restoreStaged: true, restarting: true });
            rejectFirst = no;
          }),
        )
        .mockReturnValueOnce(
          new Promise<Awaited<ReturnType<SetupApi["restore"]>>>((yes) => {
            resolveSecond = () => yes({ restoreStaged: true, restarting: true });
          }),
        );
      await fill(form);
      q(form, "[data-test=restore]").click();
      await expect.poll(() => screen(el)).toBe("provisioning");
      Object.assign(el, { screen: "restore" });
      await el.updateComplete;
      const second = el.shadowRoot!.querySelector<SetupRestoreScreen>("setup-restore-screen")!;
      await second.updateComplete;
      await fill(second);
      q(second, "[data-test=restore]").click();
      await expect.poll(() => screen(el)).toBe("provisioning");
      if (result === "success") resolveFirst();
      else rejectFirst({ code: "restore.environment_mismatch" });
      await new Promise((done) => setTimeout(done, 20));
      await el.updateComplete;
      expect(screen(el)).toBe("provisioning");
      expect(el.shadowRoot!.querySelector("setup-restore-screen")).toBeNull();
      resolveSecond();
      await expect.poll(() => screen(el)).toBe("done");
      expect(unload()).toBe(false);
    },
  );
});
