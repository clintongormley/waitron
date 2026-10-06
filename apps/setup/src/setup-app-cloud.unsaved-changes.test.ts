import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type Screen } from "./setup-app.js";
import type { CloudRecoveryView, SetupApi } from "./api/client.js";
import type { SetupCloudRestoreScreen } from "./screens/cloud-restore-screen.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
  setLocale("en-GB");
});
const approved: CloudRecoveryView = {
  requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
  code: "12345678",
  openCloudUrl: "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
  expiresAt: "2026-10-06T23:00:00.000Z",
  state: "approved",
  point: {
    id: "f553b743-a56e-4c2d-9b15-11ae89130500",
    venueId: "a5c9c47f-2cd0-4d6b-bef1-ab30ca292380",
    capturedAt: "2026-10-06T21:00:00.000Z",
    modules: { core: 1 },
  },
};
const screen = (el: SetupApp) => (el as unknown as { screen: Screen }).screen;
const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
const formOf = (el: SetupApp) =>
  el.shadowRoot!.querySelector<SetupCloudRestoreScreen>("setup-cloud-restore-screen")!;
const q = <T extends HTMLElement>(form: SetupCloudRestoreScreen, selector: string) =>
  form.shadowRoot!.querySelector<T>(selector)!;
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function mount() {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    startCloudRecovery: vi.fn().mockResolvedValue(approved),
    cloudRecoveryStatus: vi.fn().mockResolvedValue(approved),
    startCloudRecoveryAgain: vi.fn().mockResolvedValue(approved),
    restoreFromCloud: vi.fn().mockResolvedValue({ restoreStaged: true, restarting: true }),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect(screen(el)).toBe("mode"));
  Object.assign(el, { screen: "cloud-restore" });
  await el.updateComplete;
  const form = formOf(el);
  await form.updateComplete;
  return { el, form, api, host };
}
function action(
  form: SetupCloudRestoreScreen,
  name: "start" | "status" | "start-again" | "restore",
) {
  form.dispatchEvent(
    new CustomEvent("cloud-restore-action", {
      detail: { action: name, pointId: approved.point!.id, oldBoxGone: false },
      bubbles: true,
      composed: true,
    }),
  );
}
function back(form: SetupCloudRestoreScreen) {
  q(form, "wt-button[slot=cancel]").click();
}
async function load(el: SetupApp, form: SetupCloudRestoreScreen) {
  action(form, "status");
  await expect.poll(() => form.view?.state).toBe("approved");
  await expect.poll(() => form.busy).toBe(false);
  await el.updateComplete;
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("setup Cloud restore leave lifecycle", () => {
  it("safety acknowledgements leave directly while retaining the root draft", async () => {
    const { el, form } = await mount();
    await load(el, form);
    Object.assign(form, { liveUnknown: true });
    await form.updateComplete;
    for (const name of ["acknowledge", "old-box-gone"]) {
      const input = q<HTMLInputElement>(form, `[data-test=${name}]`);
      input.checked = true;
      input.dispatchEvent(new Event("change"));
    }
    expect(unload()).toBe(false);
    form.dispatchEvent(
      new CustomEvent("setup-patch", {
        detail: { patch: { admin: { email: "root@example.test" } } },
        bubbles: true,
        composed: true,
      }),
    );
    expect(unload()).toBe(true);
    back(form);
    await expect.poll(() => screen(el)).toBe("restore");
    expect(warning(el).open).toBe(false);
    expect(leaveCoordinatorFor(el)!.isDirty([el])).toBe(true);
    expect((el as unknown as { draft: { admin: { email: string } } }).draft.admin.email).toBe(
      "root@example.test",
    );
  });
  it("acknowledged Restore submits directly and leaves no child warning", async () => {
    const { el, form, api } = await mount();
    await load(el, form);
    const ack = q<HTMLInputElement>(form, "[data-test=acknowledge]");
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await form.updateComplete;
    q(form, "[data-test=restore]").click();
    await expect.poll(() => screen(el)).toBe("done");
    expect(api.restoreFromCloud).toHaveBeenCalledExactlyOnceWith(
      "f553b743-a56e-4c2d-9b15-11ae89130500",
      false,
    );
    expect(unload()).toBe(false);
    expect(warning(el).open).toBe(false);
  });
  it.each(["start", "status", "start-again"] as const)(
    "departed %s replies cannot replace a new form or its busy state",
    async (name) => {
      for (const result of ["success", "refusal"] as const) {
        const { el, form, api } = await mount();
        const method =
          name === "start"
            ? "startCloudRecovery"
            : name === "status"
              ? "cloudRecoveryStatus"
              : "startCloudRecoveryAgain";
        let resolve!: (view: CloudRecoveryView) => void;
        let reject!: (error: unknown) => void;
        vi.mocked(api[method]).mockReturnValueOnce(
          new Promise<CloudRecoveryView>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
        );
        action(form, name);
        await expect.poll(() => form.busy).toBe(true);
        back(form);
        await expect.poll(() => screen(el)).toBe("restore");
        Object.assign(el, { screen: "cloud-restore" });
        await el.updateComplete;
        const replacement = formOf(el);
        await replacement.updateComplete;
        expect(replacement.busy).toBe(false);
        let finish!: (view: CloudRecoveryView) => void;
        vi.mocked(api.cloudRecoveryStatus).mockReturnValueOnce(
          new Promise<CloudRecoveryView>((yes) => {
            finish = yes;
          }),
        );
        action(replacement, "status");
        await expect.poll(() => replacement.busy).toBe(true);
        if (result === "success") resolve(approved);
        else reject({ code: "restore.stream_source_unchecked" });
        await settle();
        expect(screen(el)).toBe("cloud-restore");
        expect(formOf(el)).toBe(replacement);
        expect(replacement.view).toBeUndefined();
        expect(replacement.liveUnknown).toBe(false);
        expect(replacement.busy).toBe(true);
        finish({ ...approved, code: "87654321" });
        await expect.poll(() => replacement.view?.code).toBe("87654321");
        await expect.poll(() => replacement.busy).toBe(false);
        cleanupWidgets();
      }
    },
  );
  it.each(["success", "refusal"] as const)(
    "a reconnected status %s cannot overwrite a newer approval",
    async (result) => {
      const { el, form, api, host } = await mount();
      let resolve!: (view: CloudRecoveryView) => void;
      let reject!: (error: unknown) => void;
      vi.mocked(api.cloudRecoveryStatus).mockReturnValueOnce(
        new Promise<CloudRecoveryView>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
      );
      action(form, "status");
      await expect.poll(() => form.busy).toBe(true);
      el.remove();
      host.append(el);
      await el.updateComplete;
      await expect.poll(() => form.busy).toBe(false);
      await load(el, form);
      if (result === "success") resolve({ ...approved, code: "87654321" });
      else reject({ code: "restore.stream_source_unchecked" });
      await settle();
      expect(form.view?.code).toBe("12345678");
      expect(form.liveUnknown).toBe(false);
      expect(form.busy).toBe(false);
    },
  );
  it.each(["departed", "reconnected", "superseded"] as const)(
    "%s restore replies cannot replace the current screen",
    async (lifetime) => {
      for (const result of ["success", "refusal"] as const) {
        const { el, form, api, host } = await mount();
        await load(el, form);
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        vi.mocked(api.restoreFromCloud).mockReturnValueOnce(
          new Promise<Awaited<ReturnType<SetupApi["restoreFromCloud"]>>>((yes, no) => {
            resolve = () => yes({ restoreStaged: true, restarting: true });
            reject = no;
          }),
        );
        action(form, "restore");
        await expect.poll(() => screen(el)).toBe("provisioning");
        let finish!: () => void;
        if (lifetime === "reconnected") {
          el.remove();
          host.append(el);
          await el.updateComplete;
        } else {
          el.shadowRoot!.querySelector("[data-test=screen-provisioning]")!.dispatchEvent(
            new CustomEvent("setup-goto", {
              detail: { screen: "cloud-restore" },
              bubbles: true,
              composed: true,
            }),
          );
          await expect.poll(() => screen(el)).toBe("cloud-restore");
          await el.updateComplete;
          const replacement = formOf(el);
          await replacement.updateComplete;
          expect(replacement.busy).toBe(false);
          if (lifetime === "superseded") {
            vi.mocked(api.restoreFromCloud).mockReturnValueOnce(
              new Promise<Awaited<ReturnType<SetupApi["restoreFromCloud"]>>>((yes) => {
                finish = () => yes({ restoreStaged: true, restarting: true });
              }),
            );
            action(replacement, "restore");
            await expect.poll(() => screen(el)).toBe("provisioning");
          }
        }
        const expected = lifetime === "departed" ? "cloud-restore" : "provisioning";
        const retained = el.shadowRoot!.querySelector(`[data-test=screen-${expected}]`);
        if (result === "success") resolve();
        else reject({ code: "restore.stream_source_unchecked" });
        await settle();
        expect(screen(el)).toBe(expected);
        expect(el.shadowRoot!.querySelector(`[data-test=screen-${expected}]`)).toBe(retained);
        if (lifetime === "departed") expect(formOf(el).liveUnknown).toBe(false);
        if (lifetime === "superseded") {
          finish();
          await expect.poll(() => screen(el)).toBe("done");
        }
        cleanupWidgets();
      }
    },
  );
});
