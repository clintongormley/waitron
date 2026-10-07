import { afterEach, expect, test } from "vitest";
import * as ui from "./index.js";

test("exports the application leave controller for contributed forms", () => {
  expect(ui).toHaveProperty("LeaveController", expect.any(Function));
  expect(ui).toHaveProperty("leaveCoordinatorFor", expect.any(Function));
});

import { LitElement, html } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { userEvent } from "vitest/browser";
import { cleanup, mount } from "./test-helpers.js";

const copy = {
  heading: "Discard unsaved changes?",
  message: "Your changes have not been saved.",
  keepLabel: "Keep editing",
  discardLabel: "Discard changes",
};
class LeaveTestApp extends LitElement {
  readonly leave = new ui.LeaveController(this);
  rendererKey = 0;
  override render() {
    return html`<wt-input name="draft" label="Name"></wt-input
      >${keyed(this.rendererKey, this.leave.render(copy))}`;
  }
}
customElements.define("leave-test-app", LeaveTestApp);
afterEach(cleanup);

async function draft() {
  const app = (await mount("<leave-test-app></leave-test-app>")) as LeaveTestApp;
  const field = app.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  field.value = "Original";
  const coordinator: ui.LeaveCoordinator = app.leave.coordinator;
  const scope: ui.DraftScope<string> = coordinator.register({
    id: field,
    current: () => field.value,
    snapshot: (value) => value,
    equal: (a, b) => a === b,
    restore: (value) => {
      field.value = value;
    },
  });
  field.value = "Edited";
  scope.changed();
  return { app, field, scope };
}
async function question(app: LeaveTestApp) {
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes");
  expect(question, "application renders its one confirmation").not.toBeNull();
  await question!.updateComplete;
  await question!.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return question!;
}

test("descendants request the nearest application coordinator through shadow roots", async () => {
  const { app, field } = await draft();
  expect(ui.leaveCoordinatorFor(field)).toBe(app.leave.coordinator);
  const nested = document.createElement("leave-test-app") as LeaveTestApp;
  app.shadowRoot!.append(nested);
  await nested.updateComplete;
  expect(ui.leaveCoordinatorFor(nested.shadowRoot!.querySelector("wt-input")!)).toBe(
    nested.leave.coordinator,
  );
  expect(ui.leaveCoordinatorFor(document.createElement("div"))).toBeUndefined();
});

for (const decision of ["keep", "discard"] as const) {
  test(`${decision} answers the application question once and restores only on Discard`, async () => {
    const { app, field, scope } = await draft();
    let proceeded = 0;
    const pending = app.leave.coordinator.request({
      scopes: [scope.id],
      reason: "cancel",
      proceed() {
        proceeded++;
      },
    });
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(q.heading).toBe("Discard unsaved changes?");
    const button = q.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${decision}"]`)!;
    button.click();
    button.click();
    expect(await pending).toBe(decision === "keep" ? "kept" : "proceeded");
    expect(field.value).toBe(decision === "keep" ? "Edited" : "Original");
    expect(proceeded).toBe(decision === "keep" ? 0 : 1);
    await q.updateComplete;
    expect(q.open).toBe(false);
  });
}

test("a committed draft aborts its question and leaves the next question independent", async () => {
  const { app, field, scope } = await draft();
  let proceeded = 0;
  const ask = () =>
    app.leave.coordinator.request({
      scopes: [scope.id],
      reason: "cancel",
      proceed() {
        proceeded++;
      },
    });
  const first = ask();
  const q = await question(app);
  scope.commit("Edited");
  expect(await first).toBe("stale");
  await app.updateComplete;
  await q.updateComplete;
  expect(q.open).toBe(false);
  field.value = "New edit";
  scope.changed();
  const second = ask();
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  expect(await second).toBe("proceeded");
  expect(field.value).toBe("Edited");
  expect(proceeded).toBe(1);
});

test("disconnect aborts the pending question and reconnect supplies a fresh coordinator", async () => {
  const { app, scope, field } = await draft();
  const old = app.leave.coordinator;
  const pending = old.request({
    scopes: [scope.id],
    reason: "cancel",
    proceed() {
      throw new Error("stale leave");
    },
  });
  await question(app);
  const parent = app.parentElement!;
  app.remove();
  expect(await pending).toBe("stale");
  parent.append(app);
  await app.updateComplete;
  expect(ui.leaveCoordinatorFor(field)).not.toBe(old);
  expect(ui.leaveCoordinatorFor(field)?.isDirty()).toBe(false);
  expect(await old.request({ scopes: [], reason: "cancel", proceed() {} })).toBe("stale");
});

test("native Escape keeps the draft without leaking choice events outside the shell", async () => {
  const { app, field, scope } = await draft();
  let leaked = 0;
  const onChoice = () => {
    leaked++;
  };
  document.addEventListener("wt-unsaved-choice", onChoice);
  try {
    const pending = app.leave.coordinator.request({
      scopes: [scope.id],
      reason: "escape",
      proceed() {
        throw new Error("Escape discarded");
      },
    });
    const q = await question(app);
    await userEvent.keyboard("{Escape}");
    expect(await pending).toBe("kept");
    expect(field.value).toBe("Edited");
    expect(q.open).toBe(false);
    expect(leaked).toBe(0);
  } finally {
    document.removeEventListener("wt-unsaved-choice", onChoice);
  }
});

test("security reset drops drafts without restoring them and tolerates a detached shell", async () => {
  const { app, field, scope } = await draft();
  const coordinator = app.leave.coordinator;
  const pending = coordinator.request({
    scopes: [scope.id],
    reason: "cancel",
    proceed() {
      throw new Error("late security answer");
    },
  });
  const q = await question(app);
  app.leave.forceReset();
  expect(coordinator.isDirty()).toBe(false);
  expect(await pending).toBe("stale");
  await app.updateComplete;
  await q.updateComplete;
  expect(q.open).toBe(false);
  expect(field.value).toBe("Edited");
  app.remove();
  expect(() => app.leave.forceReset()).not.toThrow();
  expect(() => app.leave.coordinator).toThrow("connected application");
  expect(ui.leaveCoordinatorFor(field)).toBeUndefined();
});

test("a removed renderer cannot answer a later leave question", async () => {
  const { app, field, scope } = await draft();
  const old = app.leave.coordinator.request({ scopes: [scope.id], reason: "cancel", proceed() {} });
  const oldQuestion = await question(app);
  scope.commit("Edited");
  expect(await old).toBe("stale");
  app.rendererKey++;
  app.requestUpdate();
  await app.updateComplete;
  expect(oldQuestion.isConnected).toBe(false);
  field.value = "Another edit";
  scope.changed();
  let left = 0;
  const next = app.leave.coordinator.request({
    scopes: [scope.id],
    reason: "cancel",
    proceed() {
      left++;
    },
  });
  const current = await question(app);
  oldQuestion.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await Promise.resolve();
  expect(field.value).toBe("Another edit");
  expect(left).toBe(0);
  expect(current.open).toBe(true);
  current.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  expect(await next).toBe("kept");
});
