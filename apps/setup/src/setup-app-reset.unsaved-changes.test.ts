import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupApp, type Screen } from "./setup-app.js";
import type { SetupApi } from "./api/client.js";
import type { SetupResetScreen } from "./screens/reset-screen.js";
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
async function mount() {
  const api = {
    firstSetupStatus: vi.fn().mockResolvedValue({ claimed: false }),
    firstSetupOfferings: vi.fn().mockResolvedValue({ modules: [] }),
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
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
function back(form: SetupResetScreen) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("setup Reset unsaved changes", () => {
  it("clean Back goes directly to Provisioning", async () => {
    const { el, form } = await mount();
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("provisioning");
    expect(warning(el).open).toBe(false);
  });

  it("Reset sends nothing, asks nothing, and its accepted outcome leaves unload clear", async () => {
    const { el, form, api } = await mount();
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await expect
      .poll(() => form.shadowRoot!.querySelector("[data-test=outcome]")?.textContent)
      .toContain("resetting");
    expect(api.resetIncompleteAdopt).toHaveBeenCalledExactlyOnceWith();
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(false);
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
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
      await expect.poll(() => form.busy).toBe(true);
      back(form);
      await expect.poll(() => screen(el)).toBe("provisioning");
      Object.assign(el, { screen: "reset" });
      await el.updateComplete;
      const replacement = el.shadowRoot!.querySelector<SetupResetScreen>("setup-reset-screen")!;
      await replacement.updateComplete;
      if (answer === "success") resolve({ resetStaged: true, restarting: true });
      else reject({ code: "server.internal" });
      await pending.catch(() => {});
      await el.updateComplete;
      await replacement.updateComplete;
      expect(replacement.outcome).toBeUndefined();
      expect(replacement.errorMessage).toBeUndefined();
      expect(replacement.busy).toBe(false);
    },
  );

  it("a reply from the previous shell connection cannot replace the reconnected screen", async () => {
    const { el, form, api, host } = await mount();
    let resolve!: (value: { resetStaged: true; restarting: true }) => void;
    const pending = new Promise<{ resetStaged: true; restarting: true }>((yes) => {
      resolve = yes;
    });
    vi.mocked(api.resetIncompleteAdopt).mockReturnValue(pending);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await expect.poll(() => form.busy).toBe(true);
    el.remove();
    host.append(el);
    await el.updateComplete;
    await form.updateComplete;
    resolve({ resetStaged: true, restarting: true });
    await pending;
    await el.updateComplete;
    await form.updateComplete;
    expect(form.outcome).toBeUndefined();
    expect(form.busy).toBe(false);
  });
});
