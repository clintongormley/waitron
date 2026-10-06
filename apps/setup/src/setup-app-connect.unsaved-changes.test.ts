import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type Screen } from "./setup-app.js";
import type { AdoptBody, SetupApi } from "./api/client.js";
import type { SetupConnectScreen } from "./screens/connect-screen.js";
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
const field = (form: SetupConnectScreen, key: string) =>
  form.shadowRoot!.querySelector<WtInput>(`[data-test=${key}]`)!;
const screen = (el: SetupApp) => (el as unknown as { screen: Screen }).screen;
const body: AdoptBody = {
  primaryUrl: "https://primary.example",
  credential: { personId: "operator-1", password: " secret ", totp: "123456" },
};

async function mount(request?: AdoptBody) {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    adopt: vi
      .fn()
      .mockResolvedValue({ adopted: true, breakGlassSecret: "test-recovery", restarting: true }),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect(screen(el)).toBe("mode"));
  Object.assign(el, { screen: "connect", connectRequest: request });
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector<SetupConnectScreen>("setup-connect-screen")!;
  await form.updateComplete;
  return { el, form, host, api };
}
async function edit(form: SetupConnectScreen, key: string, value: string) {
  field(form, key).dispatchEvent(
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
async function fill(form: SetupConnectScreen) {
  await edit(form, "primaryUrl", "  https://primary.example  ");
  await edit(form, "personId", "  operator-1  ");
  await edit(form, "password", " secret ");
  await edit(form, "totp", " 123456 ");
}

describe("setup Connect unsaved changes", () => {
  it.each(["primaryUrl", "personId", "password", "totp"])(
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
      expect(screen(el)).toBe("connect");
      await choose(el, "keep");
      expect(field(form, key).value).toBe(" edited ");
      back(form);
      await expect.poll(() => warning(el).open).toBe(true);
      await choose(el, "discard");
      await expect.poll(() => screen(el)).toBe("role");
      expect(field(form, key).value).toBe("");
      expect(leaveCoordinatorFor(el)!.isDirty([el])).toBe(true);
    },
  );

  it("clean Back goes directly to Role", async () => {
    const { el, form } = await mount();
    expect(unload()).toBe(false);
    back(form);
    await expect.poll(() => screen(el)).toBe("role");
    expect(warning(el).open).toBe(false);
  });

  it.each(["primaryUrl", "personId", "totp"])(
    "%s compares its trimmed request value and clears unload after a revert",
    async (key) => {
      const { el, form } = await mount();
      await edit(form, key, "edited");
      expect(unload()).toBe(true);
      await edit(form, key, "   ");
      expect(unload()).toBe(false);
      back(form);
      await expect.poll(() => screen(el)).toBe("role");
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
    await expect.poll(() => screen(el)).toBe("role");
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
    expect(screen(el)).toBe("connect");
    await expect.poll(() => form.shadowRoot!.activeElement).toBe(button);
  });

  it("Connect sends the existing exact body without asking and success clears unload", async () => {
    const { el, form, api } = await mount();
    const requests: unknown[] = [];
    form.addEventListener("adopt-requested", (event) =>
      requests.push((event as CustomEvent).detail),
    );
    await fill(form);
    expect(unload()).toBe(true);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await expect.poll(() => screen(el)).toBe("done");
    expect(requests).toEqual([{ body }]);
    expect(api.adopt).toHaveBeenCalledExactlyOnceWith(body);
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(false);
  });

  it("a refused Connect protects the returned credentials while the one-time code stays empty", async () => {
    const { el, form, api } = await mount();
    vi.mocked(api.adopt).mockRejectedValue({ code: "password.invalid" });
    await fill(form);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("setup-connect-screen") !== form)
      .toBe(true);
    await expect.poll(() => screen(el)).toBe("connect");
    const returned = el.shadowRoot!.querySelector<SetupConnectScreen>("setup-connect-screen")!;
    await returned.updateComplete;
    expect(
      ["primaryUrl", "personId", "password", "totp"].map((key) => field(returned, key).value),
    ).toEqual(["https://primary.example", "operator-1", " secret ", ""]);
    expect(unload()).toBe(true);
    back(returned);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(returned, "password").value).toBe(" secret ");
  });

  it("invalid submission retains the draft and still asks on Back", async () => {
    const { el, form, api } = await mount();
    await edit(form, "password", " ");
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await form.updateComplete;
    expect(api.adopt).not.toHaveBeenCalled();
    expect(field(form, "password").invalid).toBe(true);
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("role");
  });

  it("an edit cancels a stale Back answer", async () => {
    const { el, form } = await mount();
    await edit(form, "password", "first");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await edit(form, "password", "newer");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("connect");
    expect(field(form, "password").value).toBe("newer");
    expect(unload()).toBe(true);
  });

  it("a replacement request cancels an old Back question", async () => {
    const { el, form } = await mount();
    await edit(form, "password", "first");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    form.request = body;
    await form.updateComplete;
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect(screen(el)).toBe("connect");
    expect(field(form, "password").value).toBe(" secret ");
    expect(field(form, "totp").value).toBe("");
  });

  it("removing only the Connect child releases its unload protection and question", async () => {
    const { el, form } = await mount();
    await edit(form, "password", "secret");
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
    expect(screen(el)).toBe("connect");
    back(form);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => screen(el)).toBe("role");
    expect(field(form, "password").value).toBe("");
  });
});
