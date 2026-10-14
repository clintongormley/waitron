import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { chooseOption, chooseOptions, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { codeMessage, currentLocale, setLocale } from "@waitron/dashboard-kit";
import type { StaffPerson, StaffRole, StaffRoleInput, StaffingApi } from "./client.js";
import type { StaffRoleDialog } from "./staff-role-dialog.js";
import "./staff-role-dialog.js";

const ana: StaffPerson = { personId: "p-ana", displayName: "Ana", status: "active" };
const marc: StaffPerson = { personId: "p-marc", displayName: "Marc", status: "pending" };
const gone: StaffPerson = { personId: "p-gone", displayName: "Gone", status: "suspended" };
const held: StaffPerson = { personId: "p-held", displayName: "Held", status: "suspended" };
const waiter: StaffRole = {
  id: "role-1",
  name: "Waiter",
  colour: "green",
  position: 0,
  holderIds: ["p-held"],
  blockCount: 0,
  shiftCount: 0,
};

let el: StaffRoleDialog;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  el?.remove();
  setLocale(locale);
});

function fakeApi(people: Promise<StaffPerson[]> = Promise.resolve([ana, gone, held, marc])) {
  return {
    listPeople: vi.fn(() => people),
    createStaffRole: vi.fn(async (input: StaffRoleInput): Promise<StaffRole> => ({
      ...waiter,
      id: "role-new",
      holderIds: [],
      ...input,
    })),
    updateStaffRole: vi.fn(async (id: string, input: StaffRoleInput): Promise<StaffRole> => ({
      ...waiter,
      id,
      ...input,
    })),
    setHolders: vi.fn(async (id: string, personIds: string[]): Promise<StaffRole> => ({
      ...waiter,
      id,
      holderIds: personIds,
    })),
  };
}

async function mount(staffRole?: StaffRole, api = fakeApi()) {
  el = document.createElement("staff-role-dialog");
  el.api = api as unknown as StaffingApi;
  el.staffRole = staffRole;
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  await vi.waitFor(() => expect(api.listPeople).toHaveBeenCalled());
  await api.listPeople.mock.results[0]!.value.catch(() => undefined);
  await el.updateComplete;
  return api;
}

const field = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap[K]>(`${tag}[name=${name}]`)!;
const save = () =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-staff-role]")!;
const actions = () => el.shadowRoot!.querySelector("wt-form-actions")!;
async function bottom() {
  return (await formMessageOf(actions()))?.textContent?.trim() ?? "";
}
async function typeName(value: string) {
  field("wt-input", "name").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function press() {
  save().click();
  await el.updateComplete;
}
function closed() {
  return new Promise<void>((resolve) =>
    el.addEventListener("staff-role-close", () => resolve(), { once: true }),
  );
}

describe("staff-role dialog", () => {
  it("offers a required name, the six calendar colours and the venue's people", async () => {
    await mount();
    expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Add staff role");
    expect(field("wt-input", "name").required).toBe(true);
    expect(field("wt-input", "name").label).toBe("Name");
    const colour = field("wt-combobox", "colour");
    expect(colour.label).toBe("Colour");
    expect(colour.multiple).toBe(false);
    expect(colour.options.map((option) => [option.value, option.label])).toEqual([
      ["red", "Red"],
      ["amber", "Amber"],
      ["grey", "Grey"],
      ["blue", "Blue"],
      ["green", "Green"],
      ["purple", "Purple"],
    ]);
    expect(colour.value).toBe("blue");
    const people = field("wt-combobox", "people");
    expect(people.multiple).toBe(true);
    expect(people.label).toBe("People");
    expect(people.disabled).toBe(false);
    expect(people.options.map((option) => [option.value, option.label])).toEqual([
      ["p-ana", "Ana"],
      ["p-marc", "Marc"],
    ]);
    expect(people.countLabel(2)).toBe("2 people");
    expect(save().disabled).toBe(true);
    expect(save().variant).toBe("secondary");
  });

  it("opens an existing staff role with its values, keeping a suspended holder offered", async () => {
    await mount(waiter);
    expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Edit staff role");
    expect(field("wt-input", "name").value).toBe("Waiter");
    expect(field("wt-combobox", "colour").value).toBe("green");
    const people = field("wt-combobox", "people");
    expect(people.values).toEqual(["p-held"]);
    expect(people.options.map((option) => option.value)).toEqual(["p-ana", "p-held", "p-marc"]);
  });

  it("speaks Spanish when the screen does", async () => {
    setLocale("es");
    await mount();
    expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Añadir rol de personal");
    expect(field("wt-combobox", "colour").options[4]!.label).toBe("Verde");
  });

  it("marks a blank name and says so above the buttons, holding Save until it is fixed", async () => {
    const api = await mount();
    await chooseOption(field("wt-combobox", "colour"), "red");
    expect(save().disabled).toBe(false);
    expect(save().variant).toBe("primary");
    await press();
    expect(api.createStaffRole).not.toHaveBeenCalled();
    expect(field("wt-input", "name").error).toBe("Enter a name");
    expect(await bottom()).toBe("Correct the highlighted fields to continue.");
    expect(save().disabled).toBe(true);
    await typeName("   ");
    expect(save().disabled).toBe(true);
    await typeName("Runner");
    expect(field("wt-input", "name").error).toBe("");
    expect(await bottom()).toBe("");
    expect(save().disabled).toBe(false);
  });

  it("creates a staff role with its people: create, then set the holders, then close", async () => {
    const api = await mount();
    const saved = vi.fn();
    el.addEventListener("staff-role-saved", (event) => saved((event as CustomEvent).detail));
    await typeName("  Runner ");
    await chooseOptions(field("wt-combobox", "people"), ["p-marc", "p-ana"]);
    const close = closed();
    await press();
    await close;
    expect(api.createStaffRole).toHaveBeenCalledWith({ name: "Runner", colour: "blue" });
    expect(api.setHolders).toHaveBeenCalledWith("role-new", ["p-ana", "p-marc"]);
    expect(api.createStaffRole.mock.invocationCallOrder[0]!).toBeLessThan(
      api.setHolders.mock.invocationCallOrder[0]!,
    );
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "role-new", holderIds: ["p-ana", "p-marc"] }),
    );
    expect(el.open).toBe(false);
  });

  it("creates a staff role with nobody holding it without setting holders", async () => {
    const api = await mount();
    await typeName("Runner");
    const close = closed();
    await press();
    await close;
    expect(api.createStaffRole).toHaveBeenCalledTimes(1);
    expect(api.setHolders).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when the holders fail after a create, and Save sets only them", async () => {
    const api = await mount();
    api.setHolders.mockRejectedValueOnce({ code: "connection.failed" });
    const saved = vi.fn();
    el.addEventListener("staff-role-saved", saved);
    await typeName("Runner");
    await chooseOptions(field("wt-combobox", "people"), ["p-ana"]);
    await press();
    await vi.waitFor(async () =>
      expect(await bottom()).toBe(
        `The staff role is saved, but not its people. Save again to retry: ${codeMessage("connection.failed")}`,
      ),
    );
    expect(el.open).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Edit staff role");
    expect(save().disabled).toBe(false);
    expect(field("wt-input", "name").error).toBe("");

    const close = closed();
    await press();
    await close;
    expect(api.createStaffRole).toHaveBeenCalledTimes(1);
    expect(api.updateStaffRole).not.toHaveBeenCalled();
    expect(api.setHolders).toHaveBeenLastCalledWith("role-new", ["p-ana"]);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("updates only the details when only they change", async () => {
    const api = await mount(waiter);
    await chooseOption(field("wt-combobox", "colour"), "purple");
    const close = closed();
    await press();
    await close;
    expect(api.updateStaffRole).toHaveBeenCalledWith("role-1", {
      name: "Waiter",
      colour: "purple",
    });
    expect(api.setHolders).not.toHaveBeenCalled();
  });

  it("sets only the holders when only the people change", async () => {
    const api = await mount(waiter);
    await chooseOptions(field("wt-combobox", "people"), ["p-held", "p-ana"]);
    const close = closed();
    await press();
    await close;
    expect(api.updateStaffRole).not.toHaveBeenCalled();
    expect(api.setHolders).toHaveBeenCalledWith("role-1", ["p-ana", "p-held"]);
  });

  it("puts a taken name under Name until the name changes, leaving Save enabled", async () => {
    const api = await mount();
    api.createStaffRole.mockRejectedValueOnce({
      code: "staff_role.name_taken",
      params: { name: "Waiter" },
    });
    await typeName("Waiter");
    await press();
    await vi.waitFor(() =>
      expect(field("wt-input", "name").error).toBe("Another staff role has this name"),
    );
    expect(await bottom()).toBe("Correct the highlighted fields to continue.");
    expect(save().disabled).toBe(false);
    expect(el.open).toBe(true);
    await typeName("Waiter 2");
    expect(field("wt-input", "name").error).toBe("");
    expect(await bottom()).toBe("");
  });

  it("puts the server's refusal of the name under Name", async () => {
    const api = await mount(waiter);
    api.updateStaffRole.mockRejectedValueOnce({
      code: "staffing.invalid",
      params: { field: "name" },
    });
    await typeName("Head waiter");
    await press();
    await vi.waitFor(() => expect(field("wt-input", "name").error).toBe("Enter a name"));
  });

  it.each([
    ["a create", undefined, "createStaffRole"],
    ["an update", waiter, "updateStaffRole"],
  ] as const)(
    "puts %s's refusal of the colour under Colour until the colour changes, leaving Save enabled",
    async (_, staffRole, call) => {
      const api = await mount(staffRole);
      api[call].mockRejectedValueOnce({ code: "staffing.invalid", params: { field: "colour" } });
      await typeName("Head waiter");
      await press();
      await vi.waitFor(() =>
        expect(field("wt-combobox", "colour").error).toBe("Choose one of the colours"),
      );
      expect(field("wt-input", "name").error).toBe("");
      expect(await bottom()).toBe("Correct the highlighted fields to continue.");
      expect(save().disabled).toBe(false);
      await typeName("Head waiter 2");
      expect(field("wt-combobox", "colour").error).toBe("Choose one of the colours");
      await chooseOption(field("wt-combobox", "colour"), "purple");
      expect(field("wt-combobox", "colour").error).toBe("");
      expect(await bottom()).toBe("");
    },
  );

  it("puts a refusal of the people under People until they change, leaving Save enabled", async () => {
    const api = await mount(waiter);
    api.setHolders.mockRejectedValueOnce({
      code: "staffing.invalid",
      params: { field: "personIds" },
    });
    await chooseOptions(field("wt-combobox", "people"), ["p-held", "p-ana"]);
    await press();
    await vi.waitFor(() =>
      expect(field("wt-combobox", "people").error).toBe("Some of these people no longer exist"),
    );
    expect(await bottom()).toBe("Correct the highlighted fields to continue.");
    expect(save().disabled).toBe(false);
    expect(el.open).toBe(true);
    await chooseOptions(field("wt-combobox", "people"), ["p-held"]);
    expect(field("wt-combobox", "people").error).toBe("");
    expect(await bottom()).toBe("");
  });

  it("says in Spanish which field a refusal names", async () => {
    setLocale("es");
    const api = await mount(waiter);
    api.updateStaffRole.mockRejectedValueOnce({
      code: "staffing.invalid",
      params: { field: "colour" },
    });
    api.setHolders.mockRejectedValueOnce({
      code: "staffing.invalid",
      params: { field: "personIds" },
    });
    await typeName("Jefe de sala");
    await press();
    await vi.waitFor(() =>
      expect(field("wt-combobox", "colour").error).toBe("Elige uno de los colores"),
    );
    await chooseOption(field("wt-combobox", "colour"), "purple");
    await chooseOptions(field("wt-combobox", "people"), ["p-held", "p-ana"]);
    await press();
    await vi.waitFor(() =>
      expect(field("wt-combobox", "people").error).toBe("Algunas de estas personas ya no existen"),
    );
    expect(await bottom()).toBe("Corrige los campos marcados para continuar.");
  });

  it("says a refusal about no shown field above the buttons", async () => {
    const api = await mount(waiter);
    api.updateStaffRole.mockRejectedValueOnce({
      code: "staffing.invalid",
      params: { field: "position" },
    });
    await typeName("Head waiter");
    await press();
    await vi.waitFor(async () => expect(await bottom()).toBe("Some of the details are not valid"));
    expect(field("wt-input", "name").error).toBe("");
    expect(field("wt-combobox", "colour").error).toBe("");
    api.updateStaffRole.mockRejectedValueOnce({
      code: "staff_role.not_found",
      params: { staffRoleId: "role-1" },
    });
    await press();
    await vi.waitFor(async () =>
      expect(await bottom()).toBe("That staff role could not be found. It may have been deleted"),
    );
    expect(save().disabled).toBe(false);
  });

  it("ends each message with a full stop when it shows more than one above the buttons", async () => {
    const api = await mount(undefined, fakeApi(Promise.reject({ code: "connection.failed" })));
    api.createStaffRole.mockRejectedValueOnce({ code: "staff_role.not_found" });
    await typeName("Runner");
    await press();
    await vi.waitFor(async () =>
      expect(await bottom()).toBe(
        `Could not load the venue's people: ${codeMessage("connection.failed")}. That staff role could not be found. It may have been deleted.`,
      ),
    );
  });

  it("says in Spanish that the people were not saved, with the reason last", async () => {
    setLocale("es");
    const api = await mount();
    api.setHolders.mockRejectedValueOnce({ code: "connection.failed" });
    await typeName("Runner");
    await chooseOptions(field("wt-combobox", "people"), ["p-ana"]);
    await press();
    await vi.waitFor(async () =>
      expect(await bottom()).toBe(
        `El rol de personal está guardado, pero no sus personas. Guarda de nuevo para reintentarlo: ${codeMessage("connection.failed", "es")}`,
      ),
    );
  });

  it("keeps the id of a staff role created after the dialog was taken out, so Save does not create a second", async () => {
    const api = await mount();
    let settle!: (value: StaffRole) => void;
    api.createStaffRole.mockImplementationOnce(
      () => new Promise<StaffRole>((resolve) => (settle = resolve)),
    );
    await typeName("Runner");
    await chooseOptions(field("wt-combobox", "people"), ["p-ana"]);
    await press();
    await vi.waitFor(() => expect(api.createStaffRole).toHaveBeenCalled());
    el.remove();
    settle({ ...waiter, id: "role-new", name: "Runner", holderIds: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Edit staff role");
    const close = closed();
    await press();
    await close;
    expect(api.createStaffRole).toHaveBeenCalledTimes(1);
    expect(api.setHolders).toHaveBeenLastCalledWith("role-new", ["p-ana"]);
  });

  it("keeps Save busy across being taken out and put back before a create answers, then updates the created staff role", async () => {
    const api = await mount();
    let settle!: (value: StaffRole) => void;
    api.createStaffRole.mockImplementationOnce(
      () => new Promise<StaffRole>((resolve) => (settle = resolve)),
    );
    await typeName("Runner");
    await press();
    await vi.waitFor(() => expect(api.createStaffRole).toHaveBeenCalled());
    el.remove();
    document.body.append(el);
    await el.updateComplete;
    await typeName("Cook");
    expect(save().disabled).toBe(true);
    await press();
    expect(api.createStaffRole).toHaveBeenCalledTimes(1);
    settle({ ...waiter, id: "role-runner", name: "Runner", holderIds: [] });
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Edit staff role");
    const close = closed();
    await press();
    await close;
    expect(api.createStaffRole).toHaveBeenCalledTimes(1);
    expect(api.updateStaffRole).toHaveBeenCalledWith("role-runner", {
      name: "Cook",
      colour: "blue",
    });
  });

  it.each([
    ["for a new staff role", undefined, "createStaffRole"],
    ["on another staff role", waiter, "updateStaffRole"],
  ] as const)(
    "drops a late create's id when the dialog was closed and reopened %s",
    async (_, reopenedOn, expected) => {
      const api = await mount();
      let settle!: (value: StaffRole) => void;
      api.createStaffRole.mockImplementationOnce(
        () => new Promise<StaffRole>((resolve) => (settle = resolve)),
      );
      await typeName("Runner");
      await press();
      await vi.waitFor(() => expect(api.createStaffRole).toHaveBeenCalled());
      el.remove();
      el.open = false;
      document.body.append(el);
      await el.updateComplete;
      el.staffRole = reopenedOn;
      el.open = true;
      await el.updateComplete;
      settle({ ...waiter, id: "role-runner", name: "Runner", holderIds: [] });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await el.updateComplete;
      await typeName("Cook");
      const close = closed();
      await press();
      await close;
      if (expected === "createStaffRole") {
        expect(api.createStaffRole).toHaveBeenCalledTimes(2);
        expect(api.createStaffRole).toHaveBeenLastCalledWith({ name: "Cook", colour: "blue" });
        expect(api.updateStaffRole).not.toHaveBeenCalled();
      } else {
        expect(api.createStaffRole).toHaveBeenCalledTimes(1);
        expect(api.updateStaffRole).toHaveBeenCalledWith("role-1", {
          name: "Cook",
          colour: "green",
        });
      }
    },
  );

  it("says when the people cannot be loaded, and still saves the details", async () => {
    const api = await mount(
      waiter,
      fakeApi(Promise.reject({ code: "authorization.not_permitted" })),
    );
    expect(field("wt-combobox", "people").disabled).toBe(true);
    expect(await bottom()).toBe(
      `Could not load the venue's people: ${codeMessage("authorization.not_permitted")}`,
    );
    await typeName("Head waiter");
    const close = closed();
    await press();
    await close;
    expect(api.updateStaffRole).toHaveBeenCalledTimes(1);
    expect(api.setHolders).not.toHaveBeenCalled();
  });

  it("is busy while saving, so a second press sends nothing", async () => {
    const api = await mount();
    let finish!: (role: StaffRole) => void;
    api.createStaffRole.mockImplementationOnce(
      () => new Promise<StaffRole>((resolve) => (finish = resolve)),
    );
    await typeName("Runner");
    await press();
    expect(save().loading).toBe(true);
    expect(save().disabled).toBe(true);
    await press();
    expect(api.createStaffRole).toHaveBeenCalledTimes(1);
    const close = closed();
    finish({ ...waiter, id: "role-new", name: "Runner", holderIds: [] });
    await close;
  });

  it("closes from Cancel when nothing changed", async () => {
    await mount(waiter);
    const close = closed();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-staff-role]")!.click();
    await close;
    expect(el.open).toBe(false);
    expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  });

  it("submits on Enter", async () => {
    const api = await mount();
    await typeName("Runner");
    const close = closed();
    field("wt-input", "name")
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await close;
    expect(api.createStaffRole).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the create answers", "createStaffRole", "resolve"],
    ["the create is refused", "createStaffRole", "reject"],
    ["the holders answer", "setHolders", "resolve"],
    ["the holders are refused", "setHolders", "reject"],
  ] as const)(
    "drops a save whose answer comes after the dialog is taken out (%s)",
    async (_, call, outcome) => {
      const api = await mount();
      let settle!: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
      api[call].mockImplementationOnce(
        () => new Promise((resolve, reject) => (settle = { resolve, reject })) as never,
      );
      const saved = vi.fn();
      el.addEventListener("staff-role-saved", saved);
      await typeName("Runner");
      await chooseOptions(field("wt-combobox", "people"), ["p-ana"]);
      await press();
      await vi.waitFor(() => expect(api[call]).toHaveBeenCalled());
      el.remove();
      if (outcome === "resolve")
        settle.resolve({ ...waiter, id: "role-new", holderIds: ["p-ana"] });
      else settle.reject({ code: "staff_role.name_taken", params: { name: "Runner" } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(saved).not.toHaveBeenCalled();
      if (call === "createStaffRole") expect(api.setHolders).not.toHaveBeenCalled();
      document.body.append(el);
      await el.updateComplete;
      expect(el.open).toBe(true);
      expect(field("wt-input", "name").error).toBe("");
      expect(save().disabled).toBe(false);
    },
  );

  it.each(["answers", "fails"] as const)(
    "reads the people again when put back after a read that %s while it was out",
    async (outcome) => {
      let settle!: { resolve: (value: StaffPerson[]) => void; reject: (error: unknown) => void };
      const api = fakeApi();
      api.listPeople.mockImplementationOnce(
        () => new Promise<StaffPerson[]>((resolve, reject) => (settle = { resolve, reject })),
      );
      el = document.createElement("staff-role-dialog");
      el.api = api as unknown as StaffingApi;
      el.open = true;
      document.body.append(el);
      await el.updateComplete;
      el.remove();
      if (outcome === "answers") settle.resolve([marc]);
      else settle.reject({ code: "connection.failed" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      document.body.append(el);
      await vi.waitFor(() =>
        expect(field("wt-combobox", "people").options.map((option) => option.value)).toEqual([
          "p-ana",
          "p-marc",
        ]),
      );
      expect(api.listPeople).toHaveBeenCalledTimes(2);
      expect(await bottom()).toBe("");
    },
  );

  it("refuses a close asked for in the same turn a save starts, without asking", async () => {
    await mount(waiter);
    await typeName("Runner");
    save().click();
    expect(await el.shadowRoot!.querySelector("wt-modal")!.requestClose("escape")).toBe(false);
    expect(el.open).toBe(true);
  });

  it("starts again when opened for another staff role", async () => {
    await mount(waiter);
    await typeName("Changed");
    el.staffRole = { ...waiter, id: "role-2", name: "Cook", holderIds: [] };
    await el.updateComplete;
    expect(field("wt-input", "name").value).toBe("Cook");
    expect(save().disabled).toBe(true);
  });
});
