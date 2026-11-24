import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, DROPDOWN_ICONS, registerIcons } from "@waitron/ui";
import type { MenuArchiveImpact } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./menu-archive-dialog.js";

registerIcons(DROPDOWN_ICONS);

const impact: MenuArchiveImpact = {
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

class ArchiveLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = {
    getMenuArchiveImpact: vi.fn(async () => impact),
    archiveMenu: vi.fn(async () => {}),
  };
  archived = false;
  override render() {
    return html`<dashboard-menu-archive-dialog
        .menu=${{ id: "winter", name: "Winter" }}
        .api=${this.api}
        @menu-archived=${() => {
          this.archived = true;
        }}
      ></dashboard-menu-archive-dialog>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("menu-archive-leave-test-app", ArchiveLeaveApp);
afterEach(cleanupWidgets);

it.each([false, true])("requires a replacement through archive (sign-in: %s)", async (signIn) => {
  const { el: app } = await mountWidget<ArchiveLeaveApp>("menu-archive-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-menu-archive-dialog")!;
  const submit = () =>
    form.shadowRoot!.querySelector('[data-test="archive"]') as HTMLElementTagNameMap["wt-button"];
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
  expect(form.shadowRoot!.querySelector('[data-test="archive-warning"]')!.textContent).toBe(
    ["Archiving is permanent.", "El archivo es permanente."].find(
      (wording) => wording === t("menus.archive_warning"),
    ),
  );
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
    app.api.archiveMenu.mockRejectedValueOnce({
      code: "authorization.not_permitted",
      params: { permission: "venue.configure" },
    });
    await userEvent.click(page.elementLocator(submit().shadowRoot!.querySelector("button")!));
    app.api.getMenuArchiveImpact.mockResolvedValueOnce({ ...impact, defaultChoices: null });
    await userEvent.click(page.getByRole("button", { name: t("permission_sign_in.heading") }));
    await vi.waitFor(() => expect(submit()?.disabled).toBe(false));
    expect(app.archived).toBe(false);
  }
  await userEvent.click(page.elementLocator(submit().shadowRoot!.querySelector("button")!));
  await vi.waitFor(() => expect(app.archived).toBe(true));
  expect(app.api.archiveMenu).toHaveBeenLastCalledWith("winter", {
    replacements: { evening: "spring" },
    ...(signIn ? {} : { defaultMenuId: "spring" }),
  });
});

it.each([false, true])(
  "explains a missing replacement (must be published: %s)",
  async (requiresSellable) => {
    const archiveMenu = vi.fn();
    const { el: form } = await mountWidget<HTMLElementTagNameMap["dashboard-menu-archive-dialog"]>(
      "dashboard-menu-archive-dialog",
      {
        menu: { id: "winter", name: "Winter" },
        api: {
          archiveMenu,
          getMenuArchiveImpact: async () => ({
            ...impact,
            defaultChoices: null,
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
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="archive"]')
        ?.disabled,
    ).toBe(true);
    expect(archiveMenu).not.toHaveBeenCalled();
  },
);

it.each(["cancel", "escape"] as const)("discards the staged choice on %s", async (reason) => {
  const { el: app } = await mountWidget<ArchiveLeaveApp>("menu-archive-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-menu-archive-dialog")!;
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
    form.addEventListener("menu-archive-close", () => resolve(), { once: true }),
  );
  const closing = modal.requestClose(reason);
  if (reason === "escape")
    await userEvent.click(page.getByRole("button", { name: t("unsaved.discard") }));
  await closing;
  await close;
  expect(app.api.archiveMenu).not.toHaveBeenCalled();
});
