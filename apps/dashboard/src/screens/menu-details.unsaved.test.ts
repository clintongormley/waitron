import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi, SectionInput } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
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
    it(`${kind} ${succeeds ? "success commits before close and failed refresh" : "refusal retains its draft and warns"}`, async () => {
      history.replaceState(
        null,
        "",
        kind === "menu" ? "/manage/menus" : "/manage/menus/menu/menu/view/structure",
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
        listCatalogues: async () => {
          if (written) throw { code: "connection.failed" };
          return [{ id: "menu", name: "Menu", active: true, version: 1 }];
        },
        listLibraryProducts: async () => [],
        listCategories: async () => [],
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
        getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
        getMenuStatus: async () => ({ state: "unpublished", clashes: 0 }),
        getMenuStructure: async () => {
          if (written) throw { code: "connection.failed" };
          return { rootSectionId: "root", root, includable: [], includedBy: [], nodes: [] };
        },
        createCatalogue: async (name: string, details: Omit<SectionInput, "internalName">) =>
          write({ internalName: name, ...details }),
        createSectionIn: async (_id: string, input: SectionInput) => write(input),
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
      await vi.waitFor(() =>
        expect(inputs).toEqual([{ internalName: "Specials", names: {}, image: null, color: null }]),
      );
      if (succeeds) {
        await expect
          .poll(() => atCommit)
          .toEqual({
            submitted: { internalName: "Specials", names: {}, image: null, color: null },
            dirty: false,
            open: true,
          });
        await expect.poll(() => form.open).toBe(false);
        expect(app.leave.coordinator.isDirty()).toBe(false);
      } else {
        await expect.poll(() => form.busy).toBe(false);
        expect(atCommit).toBeUndefined();
        form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
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
    history.replaceState(null, "", "/manage/menus/menu/menu/view/home");
    const writes: unknown[] = [];
    const client = {
      listCatalogues: async () => [{ id: "menu", name: "Menu", active: true, version: 1 }],
      listLibraryProducts: async () => [],
      listCategories: async () => [],
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
        handheld: { columns: 3, tiles: "colours", order: "home_first" },
        till: { columns: 5, tiles: "colours", order: "home_first" },
      }),
      getMenuPreview: async () => {
        throw { code: "connection.failed" };
      },
      setHomeDisplay: async (...args: unknown[]) => {
        writes.push(args);
        if (!succeeds)
          throw {
            code: "menu.home_display_invalid",
            params: { device: "handheld", field: "tiles" },
          };
      },
    } as unknown as DashboardApi;
    Object.defineProperty(client, "background", { get: () => client });
    const { el: app } = await mountWidget<MenuDetailsLeaveApp>("menu-details-leave-test-app", {
      api: client,
    });
    const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
    await expect
      .poll(() => screen.shadowRoot!.querySelector('input[name="home-tiles"][value="thumbnails"]'))
      .not.toBeNull();
    screen
      .shadowRoot!.querySelector<HTMLInputElement>('input[name="home-tiles"][value="thumbnails"]')!
      .click();
    await expect.poll(() => writes).toEqual([["menu", "handheld", { tiles: "thumbnails" }]]);
    await screen.updateComplete;
    expect(app.leave.coordinator.isDirty()).toBe(false);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    if (!succeeds)
      await expect
        .poll(() =>
          screen.shadowRoot!.querySelector('input[value="colours"]')!.getAttribute("aria-invalid"),
        )
        .toBe("true");
  });
}
