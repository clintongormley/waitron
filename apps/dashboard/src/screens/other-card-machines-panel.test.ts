import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import type { OtherCardMachinesView } from "../api/payments-api.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { OtherCardMachinesPanel } from "./other-card-machines-panel.js";
import "./other-card-machines-panel.js";

const stored: OtherCardMachinesView = {
  otherCardMachines: [
    { id: "m1", name: "Bar terminal", paysInto: "other" },
    { id: "m2", name: "Terrace", paysInto: "connected_account" },
  ],
  revision: 3,
};

function rig(view: OtherCardMachinesView = stored) {
  const liveData = new LiveData();
  const state = { view: structuredClone(view) };
  const api = {
    liveData,
    getOtherCardMachines: vi.fn(async () => structuredClone(state.view)),
    saveOtherCardMachines: vi.fn(
      async (edit: {
        otherCardMachines: { id?: string; name: string; paysInto: string }[];
        revision: number;
      }) => {
        state.view = {
          otherCardMachines: edit.otherCardMachines.map((machine, index) => ({
            ...machine,
            id: machine.id ?? `new-${index}`,
          })) as OtherCardMachinesView["otherCardMachines"],
          revision: edit.revision + 1,
        };
        return structuredClone(state.view);
      },
    ),
  };
  return { api, liveData, state };
}

async function mount(r = rig(), sumUpConnected = true) {
  setLocale("en");
  const { el } = await mountWidget<OtherCardMachinesPanel>("dashboard-other-card-machines", {
    api: r.api as unknown as DashboardApi,
    sumUpConnected,
  });
  await expect.element(page.getByRole("heading", { name: "Other card machines" })).toBeVisible();
  return { el, ...r };
}

const save = () => page.getByRole("button", { name: "Save", exact: true });
const row = (name: string) => page.getByRole("group", { name, exact: true });
const nameField = (group: ReturnType<typeof row>) => group.getByRole("textbox", { name: "Name" });

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it("lists the stored machines and keeps Save quiet until the list changes", async () => {
  await mount();
  await expect.element(nameField(row("Bar terminal"))).toHaveValue("Bar terminal");
  await expect.element(nameField(row("Terrace"))).toHaveValue("Terrace");
  await expect.element(save()).toBeDisabled();
  await nameField(row("Terrace")).fill("Terrace 2");
  await expect.element(save()).toBeEnabled();
  await nameField(row("Terrace 2")).fill("Terrace");
  await expect.element(save()).toBeDisabled();
});

it("says so when there are no machines yet", async () => {
  await mount(rig({ otherCardMachines: [], revision: 0 }));
  await expect.element(page.getByText("No other card machines yet.")).toBeVisible();
  await expect.element(save()).toBeDisabled();
});

it("saves an added, a renamed and a removed machine in one body", async () => {
  const { api } = await mount();
  await nameField(row("Bar terminal")).fill("Bar");
  await row("Terrace").getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Add a machine" }).click();
  const added = row("New machine");
  await nameField(added).fill("Spare");
  await save().click();
  await vi.waitFor(() => expect(api.saveOtherCardMachines).toHaveBeenCalledTimes(1));
  expect(api.saveOtherCardMachines).toHaveBeenCalledWith({
    otherCardMachines: [
      { id: "m1", name: "Bar", paysInto: "other" },
      { name: "Spare", paysInto: "other" },
    ],
    revision: 3,
  });
  await expect.element(save()).toBeDisabled();
  await expect.element(nameField(row("Spare"))).toHaveValue("Spare");
});

it("sends where a machine's payments go", async () => {
  const { api, el } = await mount();
  const combobox = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
    "wt-combobox[name='paysInto-0']",
  )!;
  expect(combobox.value).toBe("other");
  combobox.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "connected_account" },
      bubbles: true,
      composed: true,
    }),
  );
  await save().click();
  await vi.waitFor(() => expect(api.saveOtherCardMachines).toHaveBeenCalledTimes(1));
  expect(api.saveOtherCardMachines.mock.calls[0]![0].otherCardMachines[0]).toEqual({
    id: "m1",
    name: "Bar terminal",
    paysInto: "connected_account",
  });
});

it("notes a SumUp-account machine while SumUp is not connected", async () => {
  await mount(rig(), false);
  const note = "SumUp is not connected, so its payments are recorded as another bank's.";
  await expect.element(row("Terrace").getByText(note)).toBeVisible();
  await expect.element(row("Bar terminal").getByText(note)).not.toBeInTheDocument();
});

it("shows no note while SumUp is connected", async () => {
  await mount(rig(), true);
  await expect
    .element(page.getByText("SumUp is not connected", { exact: false }))
    .not.toBeInTheDocument();
});

it("checks blank and repeated names on Save and sends nothing", async () => {
  const { api } = await mount();
  await page.getByRole("button", { name: "Add a machine" }).click();
  await nameField(row("Terrace")).fill(" bar TERMINAL ");
  await save().click();
  await expect.element(page.getByText("Give this machine a name.")).toBeVisible();
  await expect.element(page.getByText("Another machine already has this name.")).toBeVisible();
  await expect.element(page.getByText("Correct the highlighted fields to continue.")).toBeVisible();
  await expect.element(save()).toBeDisabled();
  expect(api.saveOtherCardMachines).not.toHaveBeenCalled();
  await nameField(row("bar TERMINAL")).fill("Terrace");
  await nameField(row("New machine")).fill("Spare");
  await expect.element(save()).toBeEnabled();
  await expect
    .element(page.getByText("Correct the highlighted fields to continue."))
    .not.toBeInTheDocument();
});

it("puts a name refusal under that row's name", async () => {
  const r = rig();
  r.api.saveOtherCardMachines.mockRejectedValueOnce({
    code: "management.request_invalid",
    params: { field: "otherCardMachines.1.name" },
  });
  await mount(r);
  await nameField(row("Terrace")).fill("Terrace 2");
  await save().click();
  const refusal = "Use a name of up to 60 characters that no other machine has.";
  await expect.element(row("Terrace 2").getByText(refusal)).toBeVisible();
  await expect.element(row("Bar terminal").getByText(refusal)).not.toBeInTheDocument();
  await expect.element(page.getByText("Correct the highlighted fields to continue.")).toBeVisible();
  await expect.element(save()).toBeEnabled();
  await nameField(row("Terrace 2")).fill("Terrace 3");
  await expect.element(page.getByText(refusal)).not.toBeInTheDocument();
});

it("puts any other refusal at the bottom and keeps the draft", async () => {
  const r = rig();
  r.api.saveOtherCardMachines.mockRejectedValueOnce({
    code: "management.request_invalid",
    params: { field: "otherCardMachines.0.id" },
  });
  await mount(r);
  await nameField(row("Terrace")).fill("Terrace 2");
  await save().click();
  await expect.element(page.getByText("Check the form and try again")).toBeVisible();
  await expect.element(nameField(row("Terrace 2"))).toHaveValue("Terrace 2");
  await expect.element(save()).toBeEnabled();
});

it("takes a new revision from a live update without losing an edit in progress", async () => {
  const r = rig();
  const { api, liveData, state } = await mount(r);
  await nameField(row("Terrace")).fill("Terrace 2");
  state.view = { ...state.view, revision: 4 };
  liveData.invalidate([{ type: "settings.payments" }]);
  await vi.waitFor(() => expect(api.getOtherCardMachines).toHaveBeenCalledTimes(2));
  await expect.element(nameField(row("Terrace 2"))).toHaveValue("Terrace 2");
  await save().click();
  await vi.waitFor(() => expect(api.saveOtherCardMachines).toHaveBeenCalledTimes(1));
  expect(api.saveOtherCardMachines.mock.calls[0]![0].revision).toBe(4);
});

it("follows a live update while nothing is being edited", async () => {
  const { api, liveData, state } = await mount();
  state.view = {
    otherCardMachines: [{ id: "m1", name: "Bar", paysInto: "other" }],
    revision: 4,
  };
  liveData.invalidate([{ type: "settings.payments" }]);
  await vi.waitFor(() => expect(api.getOtherCardMachines).toHaveBeenCalledTimes(2));
  await expect.element(nameField(row("Bar"))).toHaveValue("Bar");
  await expect.element(page.getByRole("group", { name: "Terrace" })).not.toBeInTheDocument();
  await expect.element(save()).toBeDisabled();
});

it("keeps the edit and asks for a check when someone else changed the list", async () => {
  const r = rig();
  r.api.saveOtherCardMachines.mockImplementationOnce(async () => {
    r.state.view = {
      otherCardMachines: [
        { id: "m1", name: "Bar", paysInto: "other" },
        { id: "m3", name: "Patio", paysInto: "other" },
      ],
      revision: 5,
    };
    throw { code: "settings.out_of_date", params: { revision: 5 } };
  });
  const { api } = await mount(r);
  await page.getByRole("button", { name: "Add a machine" }).click();
  await nameField(row("New machine")).fill("Spare");
  await save().click();
  await expect
    .element(page.getByText("The list changed while you were editing. Check it and save again."))
    .toBeVisible();
  await expect.element(page.getByRole("group", { name: "Terrace" })).not.toBeInTheDocument();
  await expect.element(nameField(row("Spare"))).toHaveValue("Spare");
  await expect.element(nameField(row("Bar"))).toHaveValue("Bar");
  await save().click();
  await vi.waitFor(() => expect(api.saveOtherCardMachines).toHaveBeenCalledTimes(2));
  expect(api.saveOtherCardMachines.mock.calls[1]![0]).toEqual({
    otherCardMachines: [
      { id: "m1", name: "Bar", paysInto: "other" },
      { name: "Spare", paysInto: "other" },
      { id: "m3", name: "Patio", paysInto: "other" },
    ],
    revision: 5,
  });
});

it("shows Spanish wording", async () => {
  const r = rig();
  setLocale("es");
  await mountWidget<OtherCardMachinesPanel>("dashboard-other-card-machines", {
    api: r.api as unknown as DashboardApi,
    sumUpConnected: false,
  });
  await expect.element(page.getByRole("heading", { name: "Otros datáfonos" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Añadir un datáfono" })).toBeVisible();
});
