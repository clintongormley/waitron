import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupZoneEditors,
  mountZoneEditor,
  editZoneName,
  zoneSave,
  zoneFields,
} from "../testing/zone-edit-fixture.js";
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupZoneEditors();
  setLocale("en");
});
it("Escape keeps the raw zone draft or discards it without a save", async () => {
  const { el, modal, app, writes } = await mountZoneEditor();
  await editZoneName(el, "Draft");
  const closing = modal.requestClose("escape");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await closing).toBe(false);
  expect(modal.open).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Draft");
  const discard = modal.requestClose("escape");
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await discard).toBe(true);
  expect(modal.open).toBe(false);
  expect(writes).toEqual([]);
});
it("pending Save blocks closing and retains a newer name after the submitted draft commits", async () => {
  let finish!: () => void;
  const { el, modal, app } = await mountZoneEditor((async (_path, method = "GET") => {
    if (method === "GET") return { tables: [] };
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as DashboardRequest);
  const written: string[] = [];
  el.addEventListener("written", (event) =>
    written.push((event as CustomEvent<{ zoneId: string }>).detail.zoneId),
  );
  await editZoneName(el, "Submitted");
  zoneSave(el).click();
  await expect.poll(() => !!finish).toBe(true);
  const closing = modal.requestClose("escape");
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(await closing).toBe(false);
  await editZoneName(el, "Later draft");
  finish();
  await expect.poll(() => zoneSave(el).disabled).toBe(false);
  expect(modal.open).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(written).toEqual(["z1"]);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Later draft");
});
it("a replacement snapshot cannot overwrite a dirty draft or redefine its original baseline", async () => {
  const { el, app, modal } = await mountZoneEditor();
  await editZoneName(el, "Draft");
  const view = structuredClone(el.model);
  view.zones[0]!.name = "Another session";
  view.salePolicies.zones[0]!.paidWhen = "ticket_then_pay";
  el.model = view;
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Draft");
  expect((await zoneFields(el)).value.paidWhen).toBeNull();
  await editZoneName(el, "Terrace");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(zoneSave(el).disabled).toBe(true);
  expect(await modal.requestClose("escape")).toBe(true);
});
it("reconnect registers the retained draft before adopting a fresh model", async () => {
  const { el, app } = await mountZoneEditor();
  await editZoneName(el, "Retained draft");
  el.remove();
  const view = structuredClone(el.model);
  view.zones[0]!.name = "Fresh name";
  el.model = view;
  app.shadowRoot!.append(el);
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Retained draft");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(zoneSave(el).disabled).toBe(false);
});
