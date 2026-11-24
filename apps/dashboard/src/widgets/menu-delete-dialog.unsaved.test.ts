import { LitElement, html } from "lit";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, DROPDOWN_ICONS, registerIcons } from "@waitron/ui";
import type { MenuDeleteImpact } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./menu-delete-dialog.js";

registerIcons(DROPDOWN_ICONS);

const impact: MenuDeleteImpact = {
  productCount: 3,
  periods: [
    {
      id: "evening",
      name: "Evening",
      departmentName: "Dining",
      starting: true,
      replacement: "starting",
      requiresSellable: false,
      choices: [{ id: "spring", name: "Spring" }],
    },
  ],
  dependants: [],
  defaultChoices: [{ id: "spring", name: "Spring" }],
};

class DeleteLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = {
    getMenuDeleteImpact: vi.fn(async () => impact),
    deleteMenu: vi.fn(async () => {}),
  };
  deleted = false;
  override render() {
    return html`<dashboard-menu-delete-dialog
        .menu=${{ id: "winter", name: "Winter", kind: "menu" }}
        .api=${this.api}
        @menu-deleted=${() => {
          this.deleted = true;
        }}
      ></dashboard-menu-delete-dialog>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("menu-delete-leave-test-app", DeleteLeaveApp);
afterEach(cleanupWidgets);

it.each([false, true])("requires a replacement through Delete (sign-in: %s)", async (signIn) => {
  const locale = currentLocale();
  setLocale("en-GB");
  onTestFinished(() => setLocale(locale));
  const { el: app } = await mountWidget<DeleteLeaveApp>("menu-delete-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-menu-delete-dialog")!;
  const submit = () =>
    form.shadowRoot!.querySelector('[data-test="delete"]') as HTMLElementTagNameMap["wt-button"];
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("wt-combobox")).not.toBeNull());
  expect(submit().disabled).toBe(true);
  const picker = form.shadowRoot!.querySelector("wt-combobox")!;
  expect(picker.search).toBe("auto");
  await vi.waitFor(() =>
    expect(
      picker
        .shadowRoot!.querySelector('wt-icon[name="chevron-down"]')
        ?.shadowRoot?.querySelector("svg"),
    ).toBeTruthy(),
  );
  expect(form.shadowRoot!.querySelector('[data-test="delete-warning"]')!.textContent).toBe(
    "This can't be undone.",
  );
  expect(
    form.shadowRoot!.querySelector('[data-test="delete-product-count"]')!.textContent!.trim(),
  ).toBe("This menu has 3 products.");
  form
    .shadowRoot!.querySelector('wt-combobox[name="default-menu"]')!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "spring" }, bubbles: true, composed: true }),
    );
  await form.updateComplete;
  expect(submit().disabled).toBe(true);
  picker.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "spring" }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  expect(submit().disabled).toBe(false);
  if (signIn) {
    form.permissionContinuation = {
      snapshot: () => ({ accountGeneration: 0, authenticated: true, permissions: [] }),
      subscribe: () => () => {},
      signIn: async () => "signed-in",
    };
    app.api.deleteMenu.mockRejectedValueOnce({
      code: "authorization.not_permitted",
      params: { permission: "venue.configure" },
    });
    await userEvent.click(page.elementLocator(submit().shadowRoot!.querySelector("button")!));
    app.api.getMenuDeleteImpact.mockResolvedValueOnce({ ...impact, defaultChoices: null });
    await userEvent.click(page.getByRole("button", { name: t("permission_sign_in.heading") }));
    await vi.waitFor(() => expect(submit()?.disabled).toBe(false));
    expect(app.deleted).toBe(false);
  }
  await userEvent.click(page.elementLocator(submit().shadowRoot!.querySelector("button")!));
  await vi.waitFor(() => expect(app.deleted).toBe(true));
  expect(app.api.deleteMenu).toHaveBeenLastCalledWith("winter", {
    replacements: { evening: "spring" },
    ...(signIn ? {} : { defaultMenuId: "spring" }),
  });
});

it.each([false, true])(
  "explains a missing replacement (must be published: %s)",
  async (requiresSellable) => {
    const deleteMenu = vi.fn();
    const { el: form } = await mountWidget<HTMLElementTagNameMap["dashboard-menu-delete-dialog"]>(
      "dashboard-menu-delete-dialog",
      {
        menu: { id: "winter", name: "Winter", kind: "menu" },
        api: {
          deleteMenu,
          getMenuDeleteImpact: async () => ({
            ...impact,
            defaultChoices: null,
            productCount: 0,
            periods: [{ ...impact.periods[0]!, choices: [], requiresSellable }],
          }),
        },
      },
    );
    await vi.waitFor(() =>
      expect(form.shadowRoot!.textContent).toMatch(
        requiresSellable
          ? /Publish another full menu for Dining · Evening|Publica otra carta completa para Dining · Evening/
          : /No replacement is available for Dining · Evening|No hay otra carta disponible para Dining · Evening/,
      ),
    );
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="delete"]')
        ?.disabled,
    ).toBe(true);
    expect(deleteMenu).not.toHaveBeenCalled();
  },
);

it.each([
  ["menu", "incluirla"],
  ["set_menu", "incluirlo"],
] as const)("uses the Spanish dependant warning for %s", async (kind, wording) => {
  const locale = currentLocale();
  setLocale("es-ES");
  onTestFinished(() => setLocale(locale));
  const { el: form } = await mountWidget<HTMLElementTagNameMap["dashboard-menu-delete-dialog"]>(
    "dashboard-menu-delete-dialog",
    {
      menu: { id: "winter", name: "Winter", kind },
      api: {
        deleteMenu: vi.fn(),
        getMenuDeleteImpact: async () => ({
          productCount: 3,
          periods: [],
          dependants: [{ id: "spring", name: "Spring" }],
          defaultChoices: null,
        }),
      },
    },
  );
  await vi.waitFor(() => expect(form.shadowRoot!.textContent).toContain(wording));
});

it.each(["cancel", "escape"] as const)("discards the staged choice on %s", async (reason) => {
  const { el: app } = await mountWidget<DeleteLeaveApp>("menu-delete-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-menu-delete-dialog")!;
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("wt-combobox")).not.toBeNull());
  form.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "spring" },
      bubbles: true,
      composed: true,
    }),
  );
  const modal = form.shadowRoot!.querySelector("wt-modal")!;
  const close = new Promise<void>((resolve) =>
    form.addEventListener("menu-delete-close", () => resolve(), { once: true }),
  );
  const closing = modal.requestClose(reason);
  if (reason === "escape")
    await userEvent.click(page.getByRole("button", { name: t("unsaved.discard") }));
  await closing;
  await close;
  expect(app.api.deleteMenu).not.toHaveBeenCalled();
});
