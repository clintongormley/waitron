import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type Screen } from "./setup-app.js";
import type { SetupApi } from "./api/client.js";
import type { SetupRestoreBucketScreen } from "./screens/restore-bucket-screen.js";
import type { WtTextarea } from "@waitron/ui/src/components/wt-textarea.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
  setLocale("en-GB");
});
const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
const screen = (el: SetupApp) => (el as unknown as { screen: Screen }).screen;
const q = <T extends HTMLElement>(form: SetupRestoreBucketScreen, selector: string) =>
  form.shadowRoot!.querySelector<T>(selector)!;
const kit = (form: SetupRestoreBucketScreen) => q<WtTextarea>(form, "[data-test=kit]");
async function mount() {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    restoreFromBucket: vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true }),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect(screen(el)).toBe("mode"));
  Object.assign(el, { screen: "restore-bucket" });
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector<SetupRestoreBucketScreen>(
    "setup-restore-bucket-screen",
  )!;
  await form.updateComplete;
  return { el, form, host, api };
}
async function edit(form: SetupRestoreBucketScreen, field = "kit", value = " kit bytes \n") {
  q(form, `[data-test=${field}]`).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
}
function back(form: SetupRestoreBucketScreen) {
  q(form, "[data-test=back]").click();
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
async function fill(form: SetupRestoreBucketScreen) {
  await edit(form);
  await edit(form, "environment", "preproduction");
  const ack = q<HTMLInputElement>(form, "[data-test=acknowledge]");
  ack.checked = true;
  ack.dispatchEvent(new Event("change"));
  await form.updateComplete;
}

describe("setup bucket restore unsaved changes", () => {
  it.each(["kit", "environment"])(
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
      await edit(form, field, field === "kit" ? " kit bytes \n" : "preproduction");
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      expect(screen(el)).toBe("restore-bucket");
      await choose(el, "keep");
      expect((q(form, `[data-test=${field}]`) as WtTextarea).value).toBe(
        field === "kit" ? " kit bytes \n" : "preproduction",
      );
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      await choose(el, "discard");
      await expect.poll(() => screen(el)).toBe("role");
      expect(kit(form).value).toBe("");
      expect((q(form, "[data-test=environment]") as WtTextarea).value).toBe("production");
      expect(leaveCoordinatorFor(el)!.isDirty([el])).toBe(true);
    },
  );
  it("clean Back is direct", async () => {
    const { el, form } = await mount();
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
    expect(warning(el).open).toBe(false);
  });
  it("safety acknowledgements alone stay exempt", async () => {
    const { el, form } = await mount();
    Object.assign(form, {
      liveUnknown: true,
      venue: { legalName: "Example", taxId: "B12345678", locationName: "Main" },
    });
    await form.updateComplete;
    for (const name of ["acknowledge", "old-box-gone", "venue-confirmed"]) {
      const input = q<HTMLInputElement>(form, `[data-test=${name}]`);
      input.checked = true;
      input.dispatchEvent(new Event("change"));
    }
    await form.updateComplete;
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
    expect(warning(el).open).toBe(false);
  });
  it("reverting authoring fields clears unload and leaves directly", async () => {
    const { el, form } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    await edit(form, "kit", "");
    await edit(form, "environment", "production");
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
  });
  it("native warning Escape retains kit and returns focus", async () => {
    const { el, form } = await mount();
    const input = kit(form).shadowRoot!.querySelector<HTMLTextAreaElement>("textarea")!;
    await userEvent.fill(page.elementLocator(input), " kit bytes \n");
    const button = q(form, "[data-test=back]");
    await userEvent.click(page.elementLocator(button));
    await expect.poll(() => warning(el).open).toBe(true);
    const modal = warning(el).shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => warning(el).open).toBe(false);
    expect(input.value).toBe(" kit bytes \n");
    expect(screen(el)).toBe("restore-bucket");
    await expect.poll(() => form.shadowRoot!.activeElement).toBe(button);
  });
  it("Restore sends exact existing body directly and success releases unload", async () => {
    const { el, form, api } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    q(form, "[data-test=restore]").click();
    await expect.poll(() => screen(el)).toBe("done");
    expect(api.restoreFromBucket).toHaveBeenCalledExactlyOnceWith({
      kit: " kit bytes \n",
      environment: "preproduction",
      oldBoxGone: false,
      venueConfirmed: null,
    });
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(false);
  });
  it("refusal keeps returned kit dirty against the empty baseline", async () => {
    const { el, form, api } = await mount();
    vi.mocked(api.restoreFromBucket).mockRejectedValue({ code: "restore.environment_mismatch" });
    await fill(form);
    q(form, "[data-test=restore]").click();
    await expect
      .poll(
        () =>
          el.shadowRoot!.querySelector<SetupRestoreBucketScreen>("setup-restore-bucket-screen")
            ?.request?.kit,
      )
      .toBe(" kit bytes \n");
    const returned = el.shadowRoot!.querySelector<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
    )!;
    await returned.updateComplete;
    expect(unload()).toBe(true);
    back(returned);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(kit(returned).value).toBe(" kit bytes \n");
  });
  it("invalid submission retains typed kit", async () => {
    const { el, form, api } = await mount();
    await edit(form);
    q(form, "[data-test=restore]").click();
    await form.updateComplete;
    expect(api.restoreFromBucket).not.toHaveBeenCalled();
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(kit(form).value).toBe(" kit bytes \n");
  });
  it("editing aborts an unanswered Back", async () => {
    const { el, form } = await mount();
    await edit(form);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await edit(form, "environment", "preproduction");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("restore-bucket");
    expect(kit(form).value).toBe(" kit bytes \n");
    expect(unload()).toBe(true);
  });
  it("disconnect removes unload and reconnect retains dirty kit", async () => {
    const { el, form, host } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    el.remove();
    expect(unload()).toBe(false);
    host.append(el);
    await el.updateComplete;
    expect(kit(form).value).toBe(" kit bytes \n");
    expect(unload()).toBe(true);
  });
  it.each(["departed", "reconnected", "superseded"])(
    "%s bucket replies cannot replace the current owner",
    async (lifetime) => {
      for (const result of ["success", "refusal"]) {
        const { el, form, api, host } = await mount();
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        let resolveSecond!: () => void;
        vi.mocked(api.restoreFromBucket).mockReturnValueOnce(
          new Promise<Awaited<ReturnType<SetupApi["restoreFromBucket"]>>>((yes, no) => {
            resolve = () => yes({ restoreStaged: true, restarting: true });
            reject = no;
          }),
        );
        await fill(form);
        q(form, "[data-test=restore]").click();
        await expect.poll(() => screen(el)).toBe("provisioning");
        if (lifetime === "reconnected") {
          el.remove();
          host.append(el);
          await el.updateComplete;
        } else {
          Object.assign(el, { screen: "restore-bucket" });
          await el.updateComplete;
          const replacement = el.shadowRoot!.querySelector<SetupRestoreBucketScreen>(
            "setup-restore-bucket-screen",
          )!;
          await replacement.updateComplete;
          await fill(replacement);
          if (lifetime === "superseded") {
            vi.mocked(api.restoreFromBucket).mockReturnValueOnce(
              new Promise<Awaited<ReturnType<SetupApi["restoreFromBucket"]>>>((yes) => {
                resolveSecond = () => yes({ restoreStaged: true, restarting: true });
              }),
            );
            q(replacement, "[data-test=restore]").click();
            await expect.poll(() => screen(el)).toBe("provisioning");
          }
        }
        const retained = el.shadowRoot!.querySelector(
          lifetime === "departed" ? "setup-restore-bucket-screen" : "setup-provisioning-screen",
        );
        if (result === "success") resolve();
        else reject({ code: "restore.environment_mismatch" });
        await new Promise((done) => setTimeout(done, 20));
        await el.updateComplete;
        expect(screen(el)).toBe(lifetime === "departed" ? "restore-bucket" : "provisioning");
        expect(
          el.shadowRoot!.querySelector(
            lifetime === "departed" ? "setup-restore-bucket-screen" : "setup-provisioning-screen",
          ),
        ).toBe(retained);
        if (lifetime === "departed") {
          expect((retained as SetupRestoreBucketScreen).request).toBeUndefined();
          expect(kit(retained as SetupRestoreBucketScreen).value).toBe(" kit bytes \n");
        }
        if (lifetime === "superseded") {
          resolveSecond();
          await expect.poll(() => screen(el)).toBe("done");
        }
        cleanupWidgets();
      }
    },
  );
  it("loading a kit file protects its resulting text", async () => {
    const { el, form } = await mount();
    const files = new DataTransfer();
    files.items.add(new File([" kit from file \n"], "recovery.txt"));
    const input = q<HTMLInputElement>(form, "[data-test=kit-file]");
    input.files = files.files;
    input.dispatchEvent(new Event("change"));
    await expect.poll(() => kit(form).value).toBe(" kit from file \n");
    expect(unload()).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("role");
    expect(kit(form).value).toBe("");
    expect(input.files).toHaveLength(0);
  });
  it.each(["edit", "discard", "disconnect"])(
    "a late kit file read cannot undo %s",
    async (action) => {
      const { el, form, host } = await mount();
      await edit(form);
      let finish!: (value: string) => void;
      vi.spyOn(File.prototype, "text").mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
      const files = new DataTransfer();
      files.items.add(new File(["old"], "kit.txt"));
      const input = q<HTMLInputElement>(form, "[data-test=kit-file]");
      input.files = files.files;
      input.dispatchEvent(new Event("change"));
      if (action === "edit") await edit(form, "kit", "new kit");
      else if (action === "discard") {
        back(form);
        await expect.poll(() => warning(el).open).toBe(true);
        await choose(el, "discard");
        await expect.poll(() => screen(el)).toBe("role");
      } else {
        el.remove();
        host.append(el);
        await el.updateComplete;
      }
      finish("late kit");
      await new Promise((done) => setTimeout(done, 20));
      await form.updateComplete;
      expect(kit(form).value).toBe(
        action === "edit" ? "new kit" : action === "discard" ? "" : " kit bytes \n",
      );
      vi.restoreAllMocks();
    },
  );
  it("removing only the bucket child releases its unload scope", async () => {
    const { el, form } = await mount();
    await fill(form);
    expect(unload()).toBe(true);
    Object.assign(el, { screen: "role" });
    await el.updateComplete;
    expect(form.isConnected).toBe(false);
    expect(unload()).toBe(false);
  });
  it("whitespace-only kit is distinct from an empty authoring field", async () => {
    const { el, form } = await mount();
    await edit(form, "kit", " ");
    expect(unload()).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(kit(form).value).toBe(" ");
  });
});
