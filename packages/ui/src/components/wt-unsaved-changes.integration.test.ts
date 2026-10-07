import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  createLeaveCoordinator,
  type LeaveCoordinator,
  type LeaveDecision,
} from "@waitron/ui-core/unsaved-changes";
import { cleanup, host } from "../test-helpers.js";
import { mountThemed } from "../a11y-helpers.js";
import "../index.js";

const coordinators: LeaveCoordinator[] = [];
afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose();
  cleanup();
});

for (const theme of ["light", "dark"] as const)
  for (const language of ["en", "es"] as const)
    for (const width of [390, 1280]) {
      test(`${theme} ${language} ${width}: Escape asks above a retained draft and Keep restores its field`, async () => {
        await page.viewport(width, width === 390 ? 844 : 900);
        const editor = (await mountThemed(
          '<wt-modal heading="Edit product" size="standard"><wt-input label="Name" name="product-name" value="Original"></wt-input><wt-form-actions slot="footer"><wt-button slot="cancel">Cancel</wt-button><wt-button>Save</wt-button></wt-form-actions></wt-modal><wt-unsaved-changes></wt-unsaved-changes>',
          theme,
        )) as HTMLElementTagNameMap["wt-modal"];
        const field = editor.querySelector("wt-input")!;
        await field.updateComplete;
        const question = host.querySelector("wt-unsaved-changes")!;
        const copy =
          language === "en"
            ? [
                "Discard unsaved changes?",
                "Your changes have not been saved.",
                "Keep editing",
                "Discard changes",
              ]
            : [
                "¿Descartar los cambios sin guardar?",
                "Tus cambios no se han guardado.",
                "Seguir editando",
                "Descartar cambios",
              ];
        [question.heading, question.message, question.keepLabel, question.discardLabel] = copy as [
          string,
          string,
          string,
          string,
        ];
        const coordinator = createLeaveCoordinator(
          (_request, signal) =>
            new Promise<LeaveDecision>((resolve) => {
              question.addEventListener(
                "wt-unsaved-choice",
                (event) => resolve((event as CustomEvent).detail.decision),
                { once: true },
              );
              signal.addEventListener(
                "abort",
                () => {
                  question.open = false;
                  resolve("keep");
                },
                { once: true },
              );
              question.open = true;
            }),
          window,
        );
        coordinators.push(coordinator);
        const owner = coordinator.register({
          id: editor,
          current: () => field.value,
          snapshot: (value) => value,
          equal: (left, right) => left === right,
          restore: (value) => {
            field.value = value;
          },
        });
        editor.beforeClose = async (reason) =>
          (await coordinator.request({ scopes: [owner.id], reason, proceed() {} })) === "proceeded";
        editor.open = true;
        await editor.updateComplete;
        field.value = "Edited product";
        await field.updateComplete;
        owner.changed();
        field.focus();
        await userEvent.keyboard("{Escape}");
        await expect.element(page.getByRole("button", { name: copy[2] })).toBeVisible();
        expect(window.innerWidth).toBe(width);
        expect(editor.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        expect(field.shadowRoot!.querySelector("input")!.value).toBe("Edited product");
        await userEvent.click(page.getByRole("button", { name: copy[2] }));
        await expect.poll(() => question.open).toBe(false);
        expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input"));
        expect(editor.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        coordinator.dispose();
        await page.viewport(1280, 900);
      });
    }

async function nestedEditors() {
  const parent = (await mountThemed(
    '<wt-modal heading="Product" size="standard"><wt-input name="product-name" label="Name" value="Product"></wt-input><wt-modal heading="Variant" size="compact"><wt-input name="variant-name" label="Name" value="Variant"></wt-input></wt-modal></wt-modal><wt-unsaved-changes heading="Discard unsaved changes?" message="Your changes have not been saved." keepLabel="Keep editing" discardLabel="Discard changes"></wt-unsaved-changes>',
    "light",
  )) as HTMLElementTagNameMap["wt-modal"];
  const child = parent.querySelector("wt-modal")!;
  const question = host.querySelector("wt-unsaved-changes")!;
  const coordinator = createLeaveCoordinator(
    (_request, signal) =>
      new Promise<LeaveDecision>((resolve) => {
        const finish = (decision: LeaveDecision) => {
          question.removeEventListener("wt-unsaved-choice", choose);
          signal.removeEventListener("abort", abort);
          resolve(decision);
        };
        const choose = (event: Event) => finish((event as CustomEvent).detail.decision);
        const abort = () => {
          question.open = false;
          finish("keep");
        };
        question.addEventListener("wt-unsaved-choice", choose);
        signal.addEventListener("abort", abort, { once: true });
        question.open = true;
      }),
    window,
  );
  coordinators.push(coordinator);
  const parentField = parent.querySelector("wt-input")!;
  const childField = child.querySelector("wt-input")!;
  await parentField.updateComplete;
  await childField.updateComplete;
  const register = (id: object, field: HTMLElementTagNameMap["wt-input"], parentId?: object) =>
    coordinator.register({
      id,
      parent: parentId,
      current: () => field.value,
      snapshot: (value) => value,
      equal: (left, right) => left === right,
      restore: (value) => {
        field.value = value;
      },
    });
  const parentScope = register(parent, parentField);
  const childScope = register(child, childField, parent);
  for (const modal of [parent, child])
    modal.beforeClose = async (reason) =>
      (await coordinator.request({ scopes: [modal], reason, proceed() {} })) === "proceeded";
  parent.open = true;
  await parent.updateComplete;
  return { parent, child, question, coordinator, parentField, childField, parentScope, childScope };
}

test("discarding a dirty child restores only its values and the edited parent still asks", async () => {
  const scene = await nestedEditors();
  scene.parentField.value = "Parent edit";
  scene.parentScope.changed();
  scene.childField.value = "Child edit";
  scene.childScope.changed();
  scene.child.open = true;
  await scene.child.updateComplete;
  const leavingChild = scene.child.requestClose("cancel");
  await userEvent.click(page.getByRole("button", { name: "Discard changes" }));
  expect(await leavingChild).toBe(true);
  expect(scene.childField.value).toBe("Variant");
  expect(scene.parentField.value).toBe("Parent edit");
  expect(scene.parent.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(scene.coordinator.isDirty([scene.parent])).toBe(true);
  const leavingParent = scene.parent.requestClose("cancel");
  await userEvent.click(page.getByRole("button", { name: "Keep editing" }));
  expect(await leavingParent).toBe(false);
  expect(scene.parentField.value).toBe("Parent edit");
  expect(scene.parent.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

test("a submitted-value commit aborts its visible question without restoring an older draft", async () => {
  const scene = await nestedEditors();
  scene.parentField.value = "Saved product";
  scene.parentScope.changed();
  const leaving = scene.parent.requestClose("cancel");
  await expect.element(page.getByRole("button", { name: "Discard changes" })).toBeVisible();
  scene.parentScope.commit("Saved product");
  expect(await leaving).toBe(false);
  await expect.poll(() => scene.question.open).toBe(false);
  expect(scene.parentField.value).toBe("Saved product");
  expect(scene.coordinator.isDirty()).toBe(false);
  expect(scene.parent.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  scene.parent.closeAfter("saved");
  await scene.parent.updateComplete;
  expect(scene.parent.shadowRoot!.querySelector("dialog")!.open).toBe(false);
});
