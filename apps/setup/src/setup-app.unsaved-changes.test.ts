import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type DeepPartial, type Screen } from "./setup-app.js";
import type { ProvisionBody, SetupApi } from "./api/client.js";
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
