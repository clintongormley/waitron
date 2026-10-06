import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type DeepPartial, type Screen } from "./setup-app.js";
import type { ConfigurationPreview, ProvisionBody, SetupApi } from "./api/client.js";
import type { SetupAdminScreen } from "./screens/admin-screen.js";
import type { WtInput } from "@waitron/ui/src/components/wt-input.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const initialAdmin = {
  firstNames: "Alba",
  lastNames: "Ramos",
  displayName: "Alba R.",
  email: "alba@example.com",
  password: "initial password",
  pin: "1234",
};
type AdminField = keyof typeof initialAdmin;
type State = { screen: Screen; draft: DeepPartial<ProvisionBody> };

async function mount() {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    provision: vi.fn(),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect((el as unknown as State).screen).toBe("mode"));
  Object.assign(el, {
    draft: { mode: "prepare", venue: { admin: { ...initialAdmin } } },
    screen: "admin",
  });
  await el.updateComplete;
  const admin = el.shadowRoot!.querySelector<SetupAdminScreen>("setup-admin-screen")!;
  await admin.updateComplete;
  return { el, admin, api, host };
}
const field = (admin: SetupAdminScreen, key: AdminField) =>
  admin.shadowRoot!.querySelector<WtInput>(`[data-test=${key}]`)!;
async function edit(admin: SetupAdminScreen, key: AdminField, value: string) {
  field(admin, key).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value },
      bubbles: true,
      composed: true,
    }),
  );
  await admin.updateComplete;
}
const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
async function choose(el: SetupApp, decision: "keep" | "discard") {
  warning(el).dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}
function goto(el: SetupApp, screen: Screen) {
  el.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("setup-goto", {
      detail: { screen },
      bubbles: true,
      composed: true,
    }),
  );
}
function back(admin: SetupAdminScreen) {
  admin.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("setup administrator unsaved changes", () => {
  it.each<AdminField>(["firstNames", "lastNames", "displayName", "email", "password", "pin"])(
    "keeps the edited %s on Back, then discards only after approval",
    async (key) => {
      const { el, admin, api } = await mount();
      await edit(admin, key, `changed ${key}`);
      back(admin);
      await expect.poll(() => warning(el).open).toBe(true);
      expect((el as unknown as State).screen).toBe("admin");
      expect(admin.isConnected).toBe(true);
      expect(field(admin, key).value).toBe(`changed ${key}`);
      expect((el as unknown as State).draft.venue!.admin).toEqual(initialAdmin);
      await choose(el, "keep");
      expect((el as unknown as State).screen).toBe("admin");
      expect(field(admin, key).value).toBe(`changed ${key}`);
      back(admin);
      await expect.poll(() => warning(el).open).toBe(true);
      await choose(el, "discard");
      await expect.poll(() => (el as unknown as State).screen).toBe("mode");
      expect((el as unknown as State).draft.venue!.admin).toEqual(initialAdmin);
      expect(api.provision).not.toHaveBeenCalled();
      expect(unload()).toBe(false);
    },
  );

  it("lets clean and reverted values go Back without asking", async () => {
    const { el, admin } = await mount();
    expect(unload()).toBe(false);
    await edit(admin, "password", "changed password");
    expect(unload()).toBe(true);
    await edit(admin, "password", initialAdmin.password);
    expect(unload()).toBe(false);
    back(admin);
    await expect.poll(() => (el as unknown as State).screen).toBe("mode");
    expect(warning(el).open).toBe(false);
  });

  it("Next patches the exact values without asking and commits the child", async () => {
    const { el, admin, api } = await mount();
    const submitted = {
      ...initialAdmin,
      email: "new@example.com",
      password: "  kept spaces  ",
      pin: "9876",
    };
    await edit(admin, "email", submitted.email);
    await edit(admin, "password", submitted.password);
    await edit(admin, "pin", submitted.pin);
    expect(unload()).toBe(true);
    admin.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
    expect((el as unknown as State).draft.venue!.admin).toEqual(submitted);
    expect(warning(el).open).toBe(false);
    expect(api.provision).not.toHaveBeenCalled();
  });

  it("invalid Next retains the typed values and Back still asks", async () => {
    const { el, admin } = await mount();
    await edit(admin, "password", "");
    admin.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await admin.updateComplete;
    expect((el as unknown as State).screen).toBe("admin");
    expect(warning(el).open).toBe(false);
    back(admin);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(admin, "password").value).toBe("");
  });

  it("does not change the pending destination on a repeated route request", async () => {
    const { el, admin } = await mount();
    await edit(admin, "email", "changed@example.com");
    back(admin);
    await expect.poll(() => warning(el).open).toBe(true);
    goto(el, "role");
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("mode");
  });

  it("a new edit invalidates an unanswered Back question", async () => {
    const { el, admin } = await mount();
    await edit(admin, "password", "first edit");
    back(admin);
    await expect.poll(() => warning(el).open).toBe(true);
    const oldWarning = warning(el);
    await edit(admin, "password", "newer edit");
    await expect.poll(() => warning(el).open).toBe(false);
    oldWarning.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect((el as unknown as State).screen).toBe("admin");
    expect(field(admin, "password").value).toBe("newer edit");
  });

  it("background draft updates and reconnect retain the original child baseline", async () => {
    const { el, admin, host } = await mount();
    await edit(admin, "email", "edited@example.com");
    (el as unknown as State).draft = {
      mode: "prepare",
      venue: { admin: { ...initialAdmin, email: "background@example.com" } },
    };
    await el.updateComplete;
    expect(field(admin, "email").value).toBe("edited@example.com");
    el.remove();
    expect(unload()).toBe(false);
    host.append(el);
    await el.updateComplete;
    await admin.updateComplete;
    expect(leaveCoordinatorFor(admin)!.isDirty()).toBe(true);
    back(admin);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(admin, "email").value).toBe("edited@example.com");
  });

  it("same-step navigation keeps the edited child without asking", async () => {
    const { el, admin } = await mount();
    await edit(admin, "email", "edited@example.com");
    goto(el, "admin");
    await el.updateComplete;
    expect(warning(el).open).toBe(false);
    expect(admin.isConnected).toBe(true);
    expect(field(admin, "email").value).toBe("edited@example.com");
  });
  it("Escape on the native warning retains the administrator and returns focus to Back", async () => {
    const { el, admin } = await mount();
    const input = field(admin, "password").shadowRoot!.querySelector("input")!;
    await userEvent.fill(input, "native edited password");
    await userEvent.click(page.getByRole("button", { name: "Back", exact: true }));
    await expect.poll(() => warning(el).open).toBe(true);
    const nativeWarning = warning(el)
      .shadowRoot!.querySelector("wt-modal")!
      .shadowRoot!.querySelector("dialog")!;
    await expect.poll(() => nativeWarning.open).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => warning(el).open).toBe(false);
    await expect.poll(() => nativeWarning.open).toBe(false);
    expect((el as unknown as State).screen).toBe("admin");
    expect(input.value).toBe("native edited password");
    const backButton = admin
      .shadowRoot!.querySelector("[data-test=back]")!
      .shadowRoot!.querySelector("button")!;
    const focused = () => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active;
    };
    await expect.poll(focused).toBe(backButton);
  });

  it.each([false, true])(
    "Next invalidates an unanswered Back before moving the committed child into venue (repeated route: %s)",
    async (repeat) => {
      const { el, admin } = await mount();
      await edit(admin, "email", "submitted@example.com");
      back(admin);
      await expect.poll(() => warning(el).open).toBe(true);
      if (repeat) {
        goto(el, "role");
        await el.updateComplete;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      admin.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
      await expect.poll(() => (el as unknown as State).screen).toBe("venue");
      await expect.poll(() => warning(el).open).toBe(false);
      await choose(el, "discard");
      expect((el as unknown as State).screen).toBe("venue");
      expect((el as unknown as State).draft.venue!.admin).toEqual({
        ...initialAdmin,
        email: "submitted@example.com",
      });
    },
  );

  it("disconnect aborts the warning and ignores departed fields", async () => {
    const { el, admin } = await mount();
    await edit(admin, "password", "retained edit");
    back(admin);
    await expect.poll(() => warning(el).open).toBe(true);
    el.remove();
    await expect.poll(() => warning(el).open).toBe(false);
    await edit(admin, "password", "departed input");
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("admin");
    expect(field(admin, "password").value).toBe("retained edit");
    expect(unload()).toBe(false);
  });
});

function patchRoot(el: SetupApp, patch: DeepPartial<ProvisionBody>) {
  el.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("setup-patch", { detail: { patch }, bubbles: true, composed: true }),
  );
}
function submitRoot(el: SetupApp) {
  el.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("provision-requested", { bubbles: true, composed: true }),
  );
}
async function nextEditedAdmin() {
  const mounted = await mount();
  await edit(mounted.admin, "email", "submitted@example.com");
  mounted.admin.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
  await expect.poll(() => (mounted.el as unknown as State).screen).toBe("venue");
  return mounted;
}

async function modeDraft(mode: "demo" | "prepare" | "live" = "prepare") {
  const mounted = await mount();
  (mounted.el as unknown as State).draft.mode = mode;
  await edit(mounted.admin, "email", "submitted@example.com");
  mounted.admin.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
  await expect.poll(() => (mounted.el as unknown as State).screen).toBe("venue");
  patchRoot(mounted.el, {
    venue: {
      legalName: "Casa Alba",
      taxId: "B12345674",
      seriesCode: "SALE",
      rectificativeSeriesCode: "CREDIT",
      location: {
        operationDescription: "Restaurant",
        dayCutover: "04:00",
        invoiceLocales: ["es-ES", "en-GB"],
      },
    },
  });
  goto(mounted.el, "mode");
  await expect.poll(() => (mounted.el as unknown as State).screen).toBe("mode");
  const modeScreen = mounted.el.shadowRoot!.querySelector("setup-mode-screen")!;
  await modeScreen.updateComplete;
  return { ...mounted, modeScreen };
}

function modeChoice(modeScreen: HTMLElement, choice: string) {
  modeScreen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${choice}]`)!.click();
}

function authoredDraft(mode: "demo" | "prepare" | "live"): DeepPartial<ProvisionBody> {
  return {
    mode,
    venue: {
      admin: { ...initialAdmin, email: "submitted@example.com" },
      legalName: "Casa Alba",
      taxId: "B12345674",
      seriesCode: "SALE",
      rectificativeSeriesCode: "CREDIT",
      location: {
        operationDescription: "Restaurant",
        dayCutover: "04:00",
        invoiceLocales: ["es-ES", "en-GB"],
      },
    },
  };
}

describe("setup mode leaves the root draft", () => {
  it.each([
    ["prepare", "demo"],
    ["demo", "prepare"],
  ] as const)("asks before %s becomes %s and clears any root values", async (from, to) => {
    const { el, modeScreen, api } = await modeDraft(from);
    modeChoice(modeScreen, `choose-${to}`);
    await expect.poll(() => warning(el).open).toBe(true);
    expect((el as unknown as State).screen).toBe("mode");
    expect((el as unknown as State).draft).toEqual(authoredDraft(from));
    await choose(el, "keep");
    expect((el as unknown as State).draft).toEqual(authoredDraft(from));
    expect(modeScreen.isConnected).toBe(true);
    expect(unload()).toBe(true);
    modeChoice(modeScreen, `choose-${to}`);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft).toEqual({
      mode: to,
      venue: { admin: initialAdmin, location: {} },
    });
    expect(api.provision).not.toHaveBeenCalled();
  });

  it("Join or recover asks before abandoning a root draft", async () => {
    const { el, modeScreen, api } = await modeDraft();
    modeChoice(modeScreen, "choose-existing");
    await expect.poll(() => warning(el).open).toBe(true);
    expect((el as unknown as State).screen).toBe("mode");
    expect((el as unknown as State).draft).toEqual(authoredDraft("prepare"));
    await choose(el, "keep");
    expect((el as unknown as State).screen).toBe("mode");
    expect(unload()).toBe(true);
    modeChoice(modeScreen, "choose-existing");
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("role");
    expect((el as unknown as State).draft).toEqual({
      mode: "prepare",
      venue: { admin: initialAdmin },
    });
    expect(unload()).toBe(false);
    expect(api.provision).not.toHaveBeenCalled();
  });

  it("the Live safety confirmation asks before replacing a Demo draft", async () => {
    const { el, modeScreen } = await modeDraft("demo");
    modeChoice(modeScreen, "choose-live");
    await modeScreen.updateComplete;
    expect(warning(el).open).toBe(false);
    modeScreen
      .shadowRoot!.querySelector("[data-test=understand]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
      );
    await modeScreen.updateComplete;
    modeChoice(modeScreen, "confirm-live");
    await expect.poll(() => warning(el).open).toBe(true);
    expect((el as unknown as State).draft).toEqual(authoredDraft("demo"));
    await choose(el, "keep");
    expect(modeScreen.shadowRoot!.querySelector("[data-test=live-warning]")).not.toBeNull();
    expect((el as unknown as State).draft).toEqual(authoredDraft("demo"));
    modeChoice(modeScreen, "confirm-live");
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("live-source");
    expect((el as unknown as State).draft).toEqual({
      mode: "live",
      venue: { admin: initialAdmin, location: {} },
    });
  });

  it("repeated mode choices cannot replace the pending destination", async () => {
    const { el, modeScreen } = await modeDraft();
    modeChoice(modeScreen, "choose-demo");
    await expect.poll(() => warning(el).open).toBe(true);
    modeChoice(modeScreen, "choose-existing");
    modeChoice(modeScreen, "choose-prepare");
    await el.updateComplete;
    expect((el as unknown as State).screen).toBe("mode");
    expect((el as unknown as State).draft).toEqual(authoredDraft("prepare"));
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft.mode).toBe("demo");
  });

  it("unchanged mode and Prepare to Live retain the root without asking", async () => {
    const { el, modeScreen } = await modeDraft();
    modeChoice(modeScreen, "choose-prepare");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft).toEqual(authoredDraft("prepare"));
    expect(warning(el).open).toBe(false);
    goto(el, "mode");
    await expect.poll(() => (el as unknown as State).screen).toBe("mode");
    const nextMode = el.shadowRoot!.querySelector("setup-mode-screen")!;
    await nextMode.updateComplete;
    modeChoice(nextMode, "choose-live");
    await nextMode.updateComplete;
    nextMode
      .shadowRoot!.querySelector("[data-test=understand]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
      );
    await nextMode.updateComplete;
    modeChoice(nextMode, "confirm-live");
    await expect.poll(() => (el as unknown as State).screen).toBe("live-source");
    expect((el as unknown as State).draft).toEqual(authoredDraft("live"));
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(true);
  });

  it("replacing the mode screen invalidates its question before restoring root values", async () => {
    const { el, modeScreen } = await modeDraft();
    modeChoice(modeScreen, "choose-demo");
    await expect.poll(() => warning(el).open).toBe(true);
    Object.assign(el, { screen: "role" });
    await el.updateComplete;
    expect(modeScreen.isConnected).toBe(false);
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("role");
    expect((el as unknown as State).draft).toEqual(authoredDraft("prepare"));
    expect(unload()).toBe(true);
  });

  it("cancelling the Live stage invalidates its unanswered mode choice", async () => {
    const { el, modeScreen } = await modeDraft("demo");
    modeChoice(modeScreen, "choose-live");
    await modeScreen.updateComplete;
    modeScreen
      .shadowRoot!.querySelector("[data-test=understand]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
      );
    await modeScreen.updateComplete;
    modeChoice(modeScreen, "confirm-live");
    await expect.poll(() => warning(el).open).toBe(true);
    modeChoice(modeScreen, "live-cancel");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("mode");
    expect((el as unknown as State).draft).toEqual(authoredDraft("demo"));
    expect(modeScreen.shadowRoot!.querySelector("[data-test=choose-demo]")).not.toBeNull();
  });

  it("native warning Escape keeps root values and returns focus to the mode choice", async () => {
    const { el, modeScreen } = await modeDraft();
    const row = modeScreen.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-demo]")!;
    const button = row.shadowRoot!.querySelector("button")!;
    await userEvent.click(button);
    await expect.poll(() => warning(el).open).toBe(true);
    const modal = warning(el).shadowRoot!.querySelector("wt-modal")!;
    await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => warning(el).open).toBe(false);
    expect((el as unknown as State).draft).toEqual(authoredDraft("prepare"));
    expect((el as unknown as State).screen).toBe("mode");
    await expect.poll(() => row.shadowRoot!.activeElement).toBe(button);
  });

  it("clean mode choices do not ask or invent a draft", async () => {
    const { el } = await mount();
    goto(el, "mode");
    await expect.poll(() => (el as unknown as State).screen).toBe("mode");
    const modeScreen = el.shadowRoot!.querySelector("setup-mode-screen")!;
    await modeScreen.updateComplete;
    modeChoice(modeScreen, "choose-existing");
    await expect.poll(() => (el as unknown as State).screen).toBe("role");
    expect(warning(el).open).toBe(false);
    expect((el as unknown as State).draft).toEqual({
      mode: "prepare",
      venue: { admin: initialAdmin },
    });
    expect(unload()).toBe(false);
  });

  it("selecting Demo again retains authored Demo values without asking", async () => {
    const { el, modeScreen } = await modeDraft("demo");
    modeChoice(modeScreen, "choose-demo");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft).toEqual(authoredDraft("demo"));
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(true);
  });

  it("Live to Prepare retains authored values without asking", async () => {
    const { el, modeScreen } = await modeDraft("live");
    modeChoice(modeScreen, "choose-prepare");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect((el as unknown as State).draft).toEqual(authoredDraft("prepare"));
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(true);
  });

  it("a changed root invalidates an unanswered mode choice without discarding newer values", async () => {
    const { el, modeScreen } = await modeDraft();
    modeChoice(modeScreen, "choose-demo");
    await expect.poll(() => warning(el).open).toBe(true);
    patchRoot(el, { venue: { legalName: "Newer restaurant" } });
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("mode");
    expect((el as unknown as State).draft).toEqual({
      ...authoredDraft("prepare"),
      venue: { ...authoredDraft("prepare").venue, legalName: "Newer restaurant" },
    });
    expect(unload()).toBe(true);
  });

  it("disconnect and reconnect cannot apply a departed mode answer", async () => {
    const { el, modeScreen, host } = await modeDraft();
    modeChoice(modeScreen, "choose-demo");
    await expect.poll(() => warning(el).open).toBe(true);
    el.remove();
    await expect.poll(() => warning(el).open).toBe(false);
    host.appendChild(el);
    await el.updateComplete;
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("mode");
    expect((el as unknown as State).draft).toEqual(authoredDraft("prepare"));
    expect(unload()).toBe(true);
    modeChoice(modeScreen, "choose-demo");
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
  });
});

describe("setup root draft unsaved changes", () => {
  it("Next transfers protection to the root, and Back retains the accepted administrator", async () => {
    const { el } = await nextEditedAdmin();
    expect(unload()).toBe(true);
    goto(el, "admin");
    await expect.poll(() => (el as unknown as State).screen).toBe("admin");
    expect(warning(el).open).toBe(false);
    const admin = el.shadowRoot!.querySelector<SetupAdminScreen>("setup-admin-screen")!;
    await admin.updateComplete;
    expect(field(admin, "email").value).toBe("submitted@example.com");
    expect(unload()).toBe(true);
  });

  it("unchanged patches and value reverts release root unload protection", async () => {
    const { el } = await mount();
    patchRoot(el, { venue: { admin: { email: initialAdmin.email } } });
    expect(unload()).toBe(false);
    patchRoot(el, { venue: { admin: { email: "changed@example.com" } } });
    expect(unload()).toBe(true);
    patchRoot(el, { venue: { admin: { email: initialAdmin.email } } });
    expect(unload()).toBe(false);
  });

  it("unchanged nested values stay clean but invoice language order remains significant", async () => {
    const { el } = await mount();
    patchRoot(el, { venue: { location: { invoiceLocales: ["es-ES", "en-GB"] } } });
    expect(unload()).toBe(true);
    await el.updateComplete;
    submitRoot(el);
    await expect.poll(() => (el as unknown as State).screen).toBe("done");
    expect(unload()).toBe(false);
    patchRoot(el, {
      venue: { admin: { pin: "1234", password: "initial password", email: initialAdmin.email } },
    });
    expect(unload()).toBe(false);
    patchRoot(el, { venue: { location: { invoiceLocales: ["en-GB", "es-ES"] } } });
    expect(unload()).toBe(true);
    patchRoot(el, { venue: { location: { invoiceLocales: ["es-ES", "en-GB"] } } });
    expect(unload()).toBe(false);
  });

  it("pending provisioning keeps protection and success commits the exact submitted body", async () => {
    const { el, api } = await nextEditedAdmin();
    let accept!: () => void;
    vi.mocked(api.provision).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = () => resolve({ provisioned: true, restarting: true });
        }),
    );
    submitRoot(el);
    await expect.poll(() => (el as unknown as State).screen).toBe("provisioning");
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(true);
    expect(api.provision).toHaveBeenCalledExactlyOnceWith({
      mode: "prepare",
      venue: { admin: { ...initialAdmin, email: "submitted@example.com" } },
    });
    accept();
    await expect.poll(() => (el as unknown as State).screen).toBe("done");
    expect(unload()).toBe(false);
  });

  it("a provisioning refusal preserves the accepted draft and its unload protection", async () => {
    const { el, api } = await nextEditedAdmin();
    vi.mocked(api.provision).mockRejectedValue({ code: "setup.not_ready" });
    submitRoot(el);
    await expect
      .poll(
        () =>
          (
            el.shadowRoot!.querySelector("setup-provisioning-screen") as
              (HTMLElement & { canRetry?: boolean }) | null
          )?.canRetry,
      )
      .toBe(true);
    expect(api.provision).toHaveBeenCalledOnce();
    await el.updateComplete;
    expect((el as unknown as State).draft.venue!.admin!.email).toBe("submitted@example.com");
    expect(unload()).toBe(true);
  });

  it("successful provisioning commits the captured request, keeping any newer patch dirty", async () => {
    const { el, api } = await nextEditedAdmin();
    let accept!: () => void;
    vi.mocked(api.provision).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = () => resolve({ provisioned: true, restarting: true });
        }),
    );
    submitRoot(el);
    patchRoot(el, { venue: { admin: { email: "newer@example.com" } } });
    accept();
    await expect.poll(() => (el as unknown as State).screen).toBe("done");
    expect(unload()).toBe(true);
    expect((el as unknown as State).draft.venue!.admin!.email).toBe("newer@example.com");
    patchRoot(el, { venue: { admin: { email: "submitted@example.com" } } });
    expect(unload()).toBe(false);
  });

  it("disconnect releases root protection, and reconnect retains its original baseline", async () => {
    const { el, host } = await nextEditedAdmin();
    expect(unload()).toBe(true);
    el.remove();
    expect(unload()).toBe(false);
    host.appendChild(el);
    await el.updateComplete;
    expect(unload()).toBe(true);
    patchRoot(el, { venue: { admin: { email: initialAdmin.email } } });
    expect(unload()).toBe(false);
  });

  it("a departed patch cannot alter the root, and a departed success cannot commit its baseline", async () => {
    const { el, host, api } = await nextEditedAdmin();
    let accept!: () => void;
    vi.mocked(api.provision).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = () => resolve({ provisioned: true, restarting: true });
        }),
    );
    submitRoot(el);
    el.remove();
    patchRoot(el, { venue: { admin: { email: "departed@example.com" } } });
    expect((el as unknown as State).draft.venue!.admin!.email).toBe("submitted@example.com");
    accept();
    await Promise.resolve();
    host.appendChild(el);
    await el.updateComplete;
    expect((el as unknown as State).screen).toBe("provisioning");
    expect(unload()).toBe(true);
  });
});

const importedConfiguration: ConfigurationPreview = {
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    taxpayerDomicile: null,
    seriesCode: "F",
    fullSeriesCode: "C",
    rectificativeSeriesCode: "R",
    location: {
      id: "source-location",
      name: "Prepared",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      fiscalTerritory: "ES-common",
      addressLine1: "Calle 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    },
  },
  counts: { products: 4 },
  reconnect: ["printers"],
};
function importConfiguration(el: SetupApp, api: SetupApi) {
  const stage = vi.fn().mockResolvedValue(importedConfiguration);
  api.stageConfiguration = stage;
  const artifact = new File(["encrypted"], "prepared.waitron-config");
  el.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("configuration-requested", {
      detail: { request: { artifact, passphrase: "import proof" } },
      bubbles: true,
      composed: true,
    }),
  );
  return { stage, artifact };
}

describe("setup root lifecycle and import", () => {
  it("an accepted configuration preview stays dirty until provisioning succeeds", async () => {
    const { el, api } = await mount();
    goto(el, "live-source");
    await expect.poll(() => (el as unknown as State).screen).toBe("live-source");
    const { stage, artifact } = importConfiguration(el, api);
    await expect.poll(() => (el as unknown as State).screen).toBe("configuration-preview");
    expect(stage).toHaveBeenCalledExactlyOnceWith(artifact, "import proof");
    expect(unload()).toBe(true);
    expect((el as unknown as State).draft).toEqual({
      mode: "prepare",
      configurationImport: true,
      venue: {
        ...importedConfiguration.venue,
        admin: initialAdmin,
        location: {
          name: "Prepared",
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurant",
          fiscalTerritory: "ES-common",
          addressLine1: "Calle 1",
          addressLine2: null,
          postalCode: "28001",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
        },
      },
    });
    goto(el, "review");
    await expect.poll(() => (el as unknown as State).screen).toBe("review");
    expect(warning(el).open).toBe(false);
    expect(unload()).toBe(true);
    submitRoot(el);
    await expect.poll(() => (el as unknown as State).screen).toBe("done");
    expect(unload()).toBe(false);
  });

  it.each(["success", "refusal"])(
    "a %s from an earlier connection cannot update the reconnected wizard",
    async (outcome) => {
      const { el, host, api } = await nextEditedAdmin();
      let finish!: () => void;
      vi.mocked(api.provision).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish =
              outcome === "success"
                ? () => resolve({ provisioned: true, restarting: true })
                : () => reject({ code: "setup.request_invalid", params: { field: "legalName" } });
          }),
      );
      submitRoot(el);
      el.remove();
      host.appendChild(el);
      await el.updateComplete;
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect((el as unknown as State).screen).toBe("provisioning");
      expect(unload()).toBe(true);
      expect((el as unknown as State).draft.venue!.admin!.email).toBe("submitted@example.com");
    },
  );
});

describe("setup root import connection generation", () => {
  it.each(["success", "refusal"])(
    "ignores an import %s received after reconnecting",
    async (outcome) => {
      const { el, host, api } = await mount();
      goto(el, "live-source");
      await expect.poll(() => (el as unknown as State).screen).toBe("live-source");
      let finish!: () => void;
      api.stageConfiguration = vi.fn().mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish =
              outcome === "success"
                ? () => resolve(importedConfiguration)
                : () => reject({ code: "setup.request_invalid" });
          }),
      );
      const source = el.shadowRoot!.querySelector("main")!;
      source.dispatchEvent(
        new CustomEvent("configuration-requested", {
          detail: {
            request: {
              artifact: new File(["encrypted"], "old.waitron-config"),
              passphrase: "old proof",
            },
          },
          bubbles: true,
          composed: true,
        }),
      );
      el.remove();
      host.appendChild(el);
      goto(el, "mode");
      await expect.poll(() => (el as unknown as State).screen).toBe("mode");
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect((el as unknown as State).screen).toBe("mode");
      expect((el as unknown as State).draft).toEqual({
        mode: "prepare",
        venue: { admin: initialAdmin },
      });
      expect(unload()).toBe(false);
    },
  );
});
