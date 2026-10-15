import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import { ShiftEditDialog } from "./shift-edit-dialog.js";
let el: ShiftEditDialog;
afterEach(() => {
  el?.remove();
  setLocale("en");
});
it("quiets Save on undo and prevents a synthetic unchanged save", async () => {
  setLocale("en");
  el = new ShiftEditDialog();
  el.open = true;
  el.week = rotaWeek();
  el.shiftId = "filled";
  const client = rotaApi();
  el.api = client.api;
  document.body.append(el);
  applyTokens(el);
  await el.updateComplete;
  const save = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
  expect(save().disabled).toBe(true);
  expect(save().variant).toBe("secondary");
  save().click();
  await el.updateComplete;
  expect(client.request).not.toHaveBeenCalled();
  const change = async (value: string) => {
    el.shadowRoot!.querySelector("[name=endsAt]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value } }),
    );
    await el.updateComplete;
    await save().updateComplete;
  };
  await change("18:00");
  expect(save().variant).toBe("primary");
  expect(save().shadowRoot!.querySelector("button")!.disabled).toBe(false);
  await change("17:00");
  expect(save().variant).toBe("secondary");
  expect(save().shadowRoot!.querySelector("button")!.disabled).toBe(true);
});
