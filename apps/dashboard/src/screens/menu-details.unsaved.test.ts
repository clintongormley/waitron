import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi, SectionInput } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, menuReadFixture, mountWidget } from "../widgets/test-helpers.js";
import type { MenuReadPart } from "../api/menu-api.js";
import "./menus-screen.js";
registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
class MenuDetailsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-menus-screen .api=${this.api}></dashboard-menus-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("menu-details-leave-test-app", MenuDetailsLeaveApp);
for (const kind of ["menu", "section"] as const) {
  for (const succeeds of [true, false]) {
    it(`${kind} ${succeeds ? "success commits before close and failed refresh" : "refusal retains the unsaved change"}`, async () => {
      const color = kind === "section" ? "#edabab" : null;
      history.replaceState(
        null,
        "",
        kind === "menu" ? "/menus" : "/menus/menu/menu/view/structure",
      );
      let written = false;
      const inputs: SectionInput[] = [];
      const write = async (input: SectionInput) => {
        inputs.push(input);
        if (!succeeds) throw { code: "management.request_invalid" };
        written = true;
      };
      const root = {
        id: "root",
        internalName: "Menu",
        names: { en: "Diner menu" },
        image: null,
        color: null,
        members: [],
      };
      const client = {
        listMenus: async () => {
          if (written) throw { code: "connection.failed" };
          return [{ id: "menu", name: "Menu", active: true }];
        },
        listLibraryProducts: async () => [],
        listCategories: async () => [],
        getMenuSettings: async () => ({
          defaultProductVatClass: "general",
          defaultColor: null,
        }),
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
        getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
        getMenuStatus: async () => ({ state: "unpublished", clashes: 0 }),
        getMenuStructure: async () => {
          if (written) throw { code: "connection.failed" };
          return { rootSectionId: "root", root, includable: [], includedBy: [], nodes: [] };
        },
        getMenuPrices: async () => [],
        getMenuRead(id: string, parts: readonly MenuReadPart[]) {
          return menuReadFixture(this as DashboardApi, id, parts);
        },
        createMenu: async (name: string, details: Omit<SectionInput, "internalName">) =>
          write({ internalName: name, ...details }),
        saveMenuStructure: async (
          _id: string,
          input: Parameters<DashboardApi["saveMenuStructure"]>[1],
        ) => {
          const { internalName, names, image, color } = input.sections[0]!;
          await write({ internalName, names, image, color });
          return { dropped: [] };
        },
      } as unknown as DashboardApi;
      Object.defineProperty(client, "background", { get: () => client });
      const { el: app } = await mountWidget<MenuDetailsLeaveApp>("menu-details-leave-test-app", {
        api: client,
      });
      const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
      if (kind === "menu") {
        await vi.waitFor(() =>
          expect(screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull(),
        );
        screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-menu]")!.click();
        await screen.updateComplete;
      } else {
        await vi.waitFor(() =>
          expect(screen.shadowRoot!.querySelector("dashboard-menu-structure-table")).not.toBeNull(),
        );
        screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!.dispatchEvent(
          new CustomEvent("wt-structure-add", {
            detail: { action: "new-section", path: [] },
            bubbles: true,
            composed: true,
          }),
        );
      }
      await screen.updateComplete;
      const form = screen.shadowRoot!.querySelector<
        HTMLElementTagNameMap["dashboard-section-details-form"]
      >(`[data-test=${kind === "menu" ? "menu-form" : "section-form"}]`)!;
      await expect.poll(() => form.open).toBe(true);
      await form.updateComplete;
      const field =
        form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=internalName]")!;
      await field.updateComplete;
      await userEvent.fill(
        page.elementLocator(field.shadowRoot!.querySelector("input")!),
        " Specials ",
      );
      await form.updateComplete;
      let atCommit: { submitted: SectionInput; dirty: boolean; open: boolean } | undefined;
      const commit = form.commitSaved.bind(form);
      vi.spyOn(form, "commitSaved").mockImplementation((submitted) => {
        commit(submitted);
        atCommit = { submitted, dirty: app.leave.coordinator.isDirty([form]), open: form.open };
      });
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
      if (kind === "section") {
        await expect.poll(() => form.open).toBe(false);
        expect(atCommit).toEqual({
          submitted: { internalName: "Specials", names: {}, image: null, color },
          dirty: false,
          open: true,
        });
        expect(inputs).toEqual([]);
        expect(app.leave.coordinator.isDirty([screen])).toBe(true);
        screen.shadowRoot!.querySelector<HTMLElement>('[data-test="structure-save"]')!.click();
      }
      await vi.waitFor(() =>
        expect(inputs).toEqual([{ internalName: "Specials", names: {}, image: null, color }]),
      );
      if (succeeds) {
        await expect
          .poll(() => atCommit)
          .toEqual({
            submitted: { internalName: "Specials", names: {}, image: null, color },
            dirty: false,
            open: true,
          });
        await expect.poll(() => form.open).toBe(false);
        await expect.poll(() => app.leave.coordinator.isDirty()).toBe(false);
        if (kind === "section")
          await expect
            .poll(() => screen.shadowRoot!.querySelector('[data-test="structure-error"]'))
            .not.toBeNull();
      } else if (kind === "section") {
        const save = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          '[data-test="structure-save"]',
        )!;
        await expect.poll(() => save.disabled).toBe(false);
        expect(save.closest("wt-form-actions")!.error).not.toBe("");
        expect(app.leave.coordinator.isDirty([screen])).toBe(true);
      } else {
        await expect.poll(() => form.busy).toBe(false);
        expect(atCommit).toBeUndefined();
        await userEvent.keyboard("{Escape}");
        await app.updateComplete;
        const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
        await q.updateComplete;
        expect(q.open).toBe(true);
        expect(form.open).toBe(true);
      }
    });
  }
}

for (const succeeds of [true, false]) {
  it(`Device Home Page display writes remain exempt after ${succeeds ? "success" : "refusal"}`, async () => {
    history.replaceState(null, "", "/menus/menu/menu/view/home");
    const writes: unknown[] = [];
    const client = {
      listMenus: async () => [{ id: "menu", name: "Menu", active: true }],
      listLibraryProducts: async () => [],
      listCategories: async () => [],
      getMenuSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
      getMenuStatus: async () => ({ state: "unpublished", clashes: 0 }),
      getMenuStructure: async () => ({
        rootSectionId: "root",
        root: {
          id: "root",
          internalName: "Menu",
          names: {},
          image: null,
          color: null,
          members: [],
        },
        includable: [],
        includedBy: [],
        nodes: [],
      }),
      getMenuHome: async () => ({
        id: "home",
        shortcuts: [],
        order: "home_first",
      }),
      getMenuPreview: async () => {
        throw { code: "connection.failed" };
      },
      getMenuPublications: async () => ({ timeZone: "Europe/Madrid", live: null, editions: [] }),
      setHomeDisplay: async (...args: unknown[]) => {
        writes.push(args);
        if (!succeeds) throw { code: "server.internal" };
      },
    } as unknown as DashboardApi;
    Object.defineProperty(client, "background", { get: () => client });
    const { el: app } = await mountWidget<MenuDetailsLeaveApp>("menu-details-leave-test-app", {
      api: client,
    });
    const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
    const control = () =>
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-segmented-control"]>(
        'wt-segmented-control[name="home-order"]',
      );
    await expect.poll(control).not.toBeNull();
    await control()!.updateComplete;
    control()!.shadowRoot!.querySelectorAll("button")[1]!.click();
    await expect.poll(() => writes).toEqual([["menu", "menu_first"]]);
    await screen.updateComplete;
    expect(app.leave.coordinator.isDirty()).toBe(false);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    if (!succeeds) {
      await expect
        .poll(() => screen.shadowRoot!.querySelector('[data-test="home-error"]'))
        .not.toBeNull();
      expect(control()!.value).toBe("home_first");
    }
  });
}
