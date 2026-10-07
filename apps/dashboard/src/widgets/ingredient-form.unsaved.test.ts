import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, Ingredient, IngredientInput } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./ingredient-form.js";
import "../screens/recipe-screen.js";

const stored: Ingredient = {
  id: "salt",
  name: "Salt",
  active: true,
  allergens: null,
  dietaryOrigin: null,
};
class IngredientLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  ingredient: Ingredient | null = stored;
  api?: DashboardApi;
  override render() {
    return html`${
      this.api
        ? html`<dashboard-recipe-screen .api=${this.api}></dashboard-recipe-screen>`
        : html`<dashboard-ingredient-form
            .open=${true}
            .ingredient=${this.ingredient}
          ></dashboard-ingredient-form>`
    }${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("ingredient-leave-test-app", IngredientLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it("a busy ingredient ignores delivered name, active and allergen changes without dirtying its baseline", async () => {
  const { form } = await fixture();
  form.busy = true;
  await form.updateComplete;
  for (const [selector, type, detail] of [
    ["wt-input", "wt-change", { value: "Changed" }],
    ["[data-test=active]", "wt-change", { checked: false }],
    ["[data-test=allergens]", "wt-allergens-change", { value: {} }],
    ["[data-test=dietary-origin]", "origin-changed", { origin: "plant" }],
  ] as const) {
    form
      .shadowRoot!.querySelector(selector)!
      .dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  await form.updateComplete;
  expect(unloadProtected()).toBe(false);
  form.busy = false;
  await form.updateComplete;
  const sent: unknown[] = [];
  form.addEventListener("update-ingredient", (event) => sent.push((event as CustomEvent).detail));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(sent).toEqual([
    { id: "salt", patch: { name: "Salt", active: true, allergens: null, dietaryOrigin: null } },
  ]);
});
async function fixture(props: Partial<IngredientLeaveApp> = {}) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<IngredientLeaveApp>("ingredient-leave-test-app", props);
  const form = app.shadowRoot!.querySelector("dashboard-ingredient-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function name(form: HTMLElementTagNameMap["dashboard-ingredient-form"], value: string) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function question(app: IngredientLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function choose(app: IngredientLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await q.updateComplete;
}
async function escape(form: HTMLElementTagNameMap["dashboard-ingredient-form"]) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  field.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Escape}");
}
function unloadProtected(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const change of ["name", "active", "allergens", "origin"] as const) {
  it(`native Escape keeps edited ingredient ${change} until Discard`, async () => {
    const { app, form } = await fixture();
    let closed = 0;
    form.addEventListener("wt-close", () => closed++);
    const submitted: unknown[] = [];
    form.addEventListener("update-ingredient", (event) =>
      submitted.push((event as CustomEvent).detail),
    );
    if (change === "name") await name(form, "Sea salt");
    else {
      const [selector, type, detail] =
        change === "active"
          ? ["[data-test=active]", "wt-change", { checked: false }]
          : change === "allergens"
            ? ["[data-test=allergens]", "wt-allergens-change", { value: {} }]
            : ["[data-test=dietary-origin]", "origin-changed", { origin: "plant" }];
      form
        .shadowRoot!.querySelector(selector)!
        .dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
      await form.updateComplete;
    }
    expect(unloadProtected()).toBe(true);
    await escape(form);
    expect((await question(app)).open).toBe(true);
    expect(form.open).toBe(true);
    expect(closed).toBe(0);
    await choose(app, "keep");
    const focused = form.shadowRoot!.querySelector("wt-input")!;
    await expect
      .poll(() => focused.shadowRoot!.activeElement)
      .toBe(focused.shadowRoot!.querySelector("input"));
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    expect(submitted).toEqual([
      {
        id: "salt",
        patch: {
          name: change === "name" ? "Sea salt" : "Salt",
          active: change !== "active",
          allergens: change === "allergens" ? {} : null,
          dietaryOrigin: change === "origin" ? "plant" : null,
        },
      },
    ]);
    await escape(form);
    expect((await question(app)).open).toBe(true);
    await choose(app, "discard");
    await expect.poll(() => form.open).toBe(false);
    expect(closed).toBe(1);
    expect(submitted).toHaveLength(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(unloadProtected()).toBe(false);
  });
}
it("untouched and reverted ingredient Escape closes without asking", async () => {
  const { app, form } = await fixture();
  await name(form, "Changed");
  await name(form, "Salt");
  expect(unloadProtected()).toBe(false);
  await escape(form);
  await expect.poll(() => form.open).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("busy ingredient refuses Escape and reconnected entry gets a new baseline", async () => {
  const { app, form } = await fixture();
  await name(form, "Sea salt");
  form.busy = true;
  await form.updateComplete;
  await escape(form);
  expect(form.open).toBe(true);
  expect((await question(app)).open).toBe(false);
  form.busy = false;
  form.remove();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  await name(form, "Rock salt");
  await escape(form);
  expect((await question(app)).open).toBe(true);
});
it("a background copy of the same ingredient cannot reset the edited name", async () => {
  const { app, form } = await fixture();
  await name(form, "Sea salt");
  form.ingredient = { ...stored, name: "Refreshed salt" };
  await form.updateComplete;
  await escape(form);
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  const field = form.shadowRoot!.querySelector("wt-input")!;
  expect(field.value).toBe("Sea salt");
});
for (const edit of [false, true]) {
  for (const succeeds of [false, true]) {
    it(`Recipes ${edit ? "edit" : "create"} ${succeeds ? "clears the draft before failed refresh" : "refusal retains the draft"}`, async () => {
      let written = false;
      let dirtyDuringRefresh: boolean | undefined;
      const client = {
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
        listCatalogues: async () => [],
        listIngredients: async () => {
          if (written) {
            dirtyDuringRefresh = app.leave.coordinator.isDirty();
            throw { code: "connection.failed" };
          }
          return [stored];
        },
        createIngredient: vi.fn(async (body: IngredientInput) => {
          if (!succeeds) throw { code: "connection.failed" };
          written = true;
          return { ...stored, ...body };
        }),
        updateIngredient: vi.fn(async () => {
          if (!succeeds) throw { code: "connection.failed" };
          written = true;
        }),
      } as unknown as DashboardApi;
      Object.defineProperty(client, "background", { get: () => client });
      const { el: app } = await mountWidget<IngredientLeaveApp>("ingredient-leave-test-app", {
        api: client,
      });
      const screen = app.shadowRoot!.querySelector("dashboard-recipe-screen")!;
      await vi.waitFor(() =>
        expect(screen.shadowRoot!.querySelector("dashboard-ingredient-list")!.ingredients).toEqual([
          stored,
        ]),
      );
      if (edit)
        screen.shadowRoot!.querySelector("dashboard-ingredient-list")!.dispatchEvent(
          new CustomEvent("edit-ingredient", {
            detail: { id: "salt" },
            bubbles: true,
            composed: true,
          }),
        );
      else screen.shadowRoot!.querySelector<HTMLElement>("[data-test=new-ingredient]")!.click();
      await screen.updateComplete;
      const form = screen.shadowRoot!.querySelector("dashboard-ingredient-form")!;
      await form.updateComplete;
      await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      await name(form, "Sea salt");
      expect(app.leave.coordinator.isDirty()).toBe(true);
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
      if (edit)
        await vi.waitFor(() =>
          expect(client.updateIngredient).toHaveBeenCalledExactlyOnceWith("salt", {
            name: "Sea salt",
            active: true,
            allergens: null,
            dietaryOrigin: null,
          }),
        );
      else
        await vi.waitFor(() =>
          expect(client.createIngredient).toHaveBeenCalledExactlyOnceWith({ name: "Sea salt" }),
        );
      if (succeeds) {
        await expect.poll(() => dirtyDuringRefresh).toBe(false);
        await expect.poll(() => form.open).toBe(false);
        expect(app.leave.coordinator.isDirty()).toBe(false);
        expect((await question(app)).open).toBe(false);
      } else {
        await expect.poll(() => form.busy).toBe(false);
        await escape(form);
        expect((await question(app)).open).toBe(true);
        expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Sea salt");
      }
    });
  }
}
it("a write starting while Escape asks invalidates its old Discard answer", async () => {
  const { app, form } = await fixture();
  await name(form, "Sea salt");
  await escape(form);
  const old = await question(app);
  expect(old.open).toBe(true);
  form.busy = true;
  await form.updateComplete;
  expect((await question(app)).open).toBe(false);
  old.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await app.updateComplete;
  expect(form.open).toBe(true);
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Sea salt");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("departed ingredient controls cannot submit or replace retained entry", async () => {
  const { app, form } = await fixture();
  await name(form, "Sea salt");
  let submits = 0;
  form.addEventListener("update-ingredient", () => submits++);
  form.remove();
  form
    .shadowRoot!.querySelector("wt-input")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed" } }));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(submits).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Sea salt");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("untouched ingredient closes without a warning", async () => {
  const { app, form } = await fixture();
  await escape(form);
  await expect.poll(() => form.open).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("ingredient replacement aborts the old question without changing the replacement", async () => {
  const { app, form } = await fixture();
  await name(form, "Sea salt");
  await escape(form);
  expect((await question(app)).open).toBe(true);
  app.ingredient = { ...stored, id: "pepper", name: "Pepper" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect((await question(app)).open).toBe(false);
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("Pepper");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

for (const [selector, type, changed, reverted] of [
  ["[data-test=active]", "wt-change", { checked: false }, { checked: true }],
  ["[data-test=allergens]", "wt-allergens-change", { value: {} }, { value: null }],
  ["[data-test=dietary-origin]", "origin-changed", { origin: "plant" }, { origin: null }],
] as const) {
  it(`reverted ingredient ${selector} no longer protects unload or Escape`, async () => {
    const { app, form } = await fixture();
    const control = form.shadowRoot!.querySelector(selector)!;
    control.dispatchEvent(
      new CustomEvent(type, { detail: changed, bubbles: true, composed: true }),
    );
    await form.updateComplete;
    expect(unloadProtected()).toBe(true);
    control.dispatchEvent(
      new CustomEvent(type, { detail: reverted, bubbles: true, composed: true }),
    );
    await form.updateComplete;
    expect(unloadProtected()).toBe(false);
    await escape(form);
    await expect.poll(() => form.open).toBe(false);
    expect((await question(app)).open).toBe(false);
  });
}
it("an invalid raw ingredient name still asks before losing its value", async () => {
  const { app, form } = await fixture({ ingredient: null });
  await name(form, "   ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await form.updateComplete;
  expect(unloadProtected()).toBe(true);
  await escape(form);
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("   ");
});

it("a detached ingredient control cannot change the body submitted after reconnection", async () => {
  const { app, form } = await fixture();
  const origin = form.shadowRoot!.querySelector("[data-test=dietary-origin]")!;
  form.remove();
  origin.dispatchEvent(new CustomEvent("origin-changed", { detail: { origin: "animal" } }));
  expect(unloadProtected()).toBe(false);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  const sent: unknown[] = [];
  form.addEventListener("update-ingredient", (event) => sent.push((event as CustomEvent).detail));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(sent).toEqual([
    { id: "salt", patch: { name: "Salt", active: true, allergens: null, dietaryOrigin: null } },
  ]);
});
