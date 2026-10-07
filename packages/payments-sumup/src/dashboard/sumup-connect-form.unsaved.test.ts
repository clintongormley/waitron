import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { SumUpConnectForm } from "./sumup-connect-form.js";

class ConnectLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  request = vi.fn(async () => ({ merchantName: "Restaurant" })) as unknown as DashboardRequest;
  connected = vi.fn();
  override render() {
    return html`<sumup-connect-form
        .request=${this.request}
        .onConnected=${this.connected}
      ></sumup-connect-form>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("sumup-connect-leave-test", ConnectLeaveApp);
let app: ConnectLeaveApp;
afterEach(() => {
  app?.remove();
});
async function mount(request?: DashboardRequest) {
  app = document.createElement("sumup-connect-leave-test") as ConnectLeaveApp;
  if (request) app.request = request;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const form = app.shadowRoot!.querySelector("sumup-connect-form")!;
  await form.updateComplete;
  return form;
}
async function field(form: SumUpConnectForm, name: string, value: string) {
  form
    .shadowRoot!.querySelector(`[data-test=${name}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await form.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
function press(form: SumUpConnectForm) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

for (const name of ["api-key", "affiliate-app-id", "affiliate-key"]) {
  it(`protects exact ${name} through Keep and Discard and skips a reverted value`, async () => {
    const form = await mount();
    const proceed = vi.fn();
    expect(unload()).toBe(false);
    await field(form, name, "  changed  ");
    expect(unload()).toBe(true);
    let leave = app.leave.coordinator.request({ scopes: [form], reason: "cancel", proceed });
    let q = await question();
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    expect(await leave).toBe("kept");
    expect(proceed).not.toHaveBeenCalled();
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${name}]`)!
        .value,
    ).toBe("  changed  ");
    await field(form, name, "");
    expect(unload()).toBe(false);
    expect(await app.leave.coordinator.request({ scopes: [form], reason: "cancel", proceed })).toBe(
      "proceeded",
    );
    await field(form, name, " ");
    leave = app.leave.coordinator.request({ scopes: [form], reason: "cancel", proceed });
    q = await question();
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    expect(await leave).toBe("proceeded");
    expect(proceed).toHaveBeenCalledTimes(2);
    await form.updateComplete;
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${name}]`)!
        .value,
    ).toBe("");
    expect(unload()).toBe(false);
  });
}
it("commits accepted fields before the host refresh callback", async () => {
  const form = await mount();
  const observations: boolean[] = [];
  form.onConnected = () => {
    observations.push(unload());
  };
  await field(form, "api-key", " exact-key ");
  expect(unload()).toBe(true);
  press(form);
  await vi.waitFor(() => expect(observations).toEqual([false]));
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("keeps a refused credential draft protected", async () => {
  const form = await mount((async () => {
    throw { code: "payment.provider_credential_rejected" };
  }) as DashboardRequest);
  await field(form, "api-key", "key");
  press(form);
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("[data-test=connect]")!.hasAttribute("loading")).toBe(
      false,
    ),
  );
  expect(unload()).toBe(true);
  expect(app.connected).not.toHaveBeenCalled();
});
it("commits only the submitted snapshot when another input arrives during connect", async () => {
  const reply = pending<{ merchantName: string }>();
  const bodies: unknown[] = [];
  const form = await mount(((path: string, method: string, body: unknown) => {
    bodies.push({ path, method, body });
    return reply.promise;
  }) as DashboardRequest);
  try {
    await field(form, "api-key", "first");
    press(form);
    await form.updateComplete;
    await field(form, "api-key", "second");
    reply.resolve({ merchantName: "Restaurant" });
    await vi.waitFor(() =>
      expect(form.shadowRoot!.querySelector("[data-test=connect]")!.hasAttribute("loading")).toBe(
        false,
      ),
    );
    expect(app.connected).not.toHaveBeenCalled();
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=api-key]")!
        .value,
    ).toBe("second");
    expect(bodies).toEqual([
      {
        path: "/management-api/payments/providers/sumup/connect",
        method: "POST",
        body: { apiKey: "first" },
      },
    ]);
    expect(unload()).toBe(true);
  } finally {
    reply.resolve({ merchantName: "Restaurant" });
  }
});
it("clears secrets on disconnect and old input controls cannot edit a reconnected form", async () => {
  const form = await mount();
  await field(form, "api-key", "secret");
  const old = form.shadowRoot!.querySelector(`[data-test=api-key]`)!;
  form.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(form);
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=api-key]")!.value,
  ).toBe("");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "departed" } }));
  await form.updateComplete;
  expect(unload()).toBe(false);
});
for (const accepted of [true, false]) {
  it(`a departed ${accepted ? "accepted" : "refused"} reply leaves a reconnected opening alone`, async () => {
    const reply = pending<{ merchantName: string }>();
    const form = await mount((() => reply.promise) as DashboardRequest);
    try {
      await field(form, "api-key", "first");
      press(form);
      await form.updateComplete;
      form.remove();
      app.shadowRoot!.append(form);
      await form.updateComplete;
      await field(form, "api-key", "replacement");
      if (accepted) reply.resolve({ merchantName: "Departed" });
      else reply.reject({ code: "payment.provider_credential_rejected" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await form.updateComplete;
      expect(form.shadowRoot!.querySelector("[data-test=connected]")).toBeNull();
      expect(
        form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=api-key]")!
          .value,
      ).toBe("replacement");
      expect(
        form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
          .error,
      ).toBe("");
      expect(unload()).toBe(true);
    } finally {
      reply.resolve({ merchantName: "Departed" });
    }
  });
}

it("a departed submit control cannot submit a replacement opening", async () => {
  const form = await mount();
  const old = form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!;
  form.remove();
  app.shadowRoot!.append(form);
  await form.updateComplete;
  await field(form, "api-key", "replacement");
  old.click();
  await form.updateComplete;
  expect(app.request).not.toHaveBeenCalled();
  expect(unload()).toBe(true);
});
it("a containing owner asks for its contributed credential draft", async () => {
  const form = await mount();
  await field(form, "api-key", "secret");
  const proceed = vi.fn();
  const leave = app.leave.coordinator.request({ scopes: [app], reason: "navigation", proceed });
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await leave).toBe("kept");
  expect(proceed).not.toHaveBeenCalled();
});

it("an ambiguous merchant choice is dirty and Discard restores the visible empty choice", async () => {
  const form = await mount((async () => {
    throw {
      code: "payment.provider_merchant_ambiguous",
      params: {
        merchants: [
          { code: "A", name: "One" },
          { code: "B", name: "Two" },
        ],
      },
    };
  }) as DashboardRequest);
  await field(form, "api-key", "key");
  press(form);
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("[data-test=merchant]")).not.toBeNull(),
  );
  const merchant =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=merchant]")!;
  merchant.value = "B";
  merchant.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "B" } }));
  await field(form, "api-key", "");
  expect(unload()).toBe(true);
  const leave = app.leave.coordinator.request({ scopes: [form], reason: "cancel", proceed() {} });
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await leave).toBe("proceeded");
  await form.updateComplete;
  await merchant.updateComplete;
  expect(merchant.value).toBe("");
  expect(unload()).toBe(false);
});

it("an explicitly submitted connect is exempt while awaiting its answer and a refusal restores protection", async () => {
  const reply = pending<{ merchantName: string }>();
  const form = await mount((() => reply.promise) as DashboardRequest);
  try {
    await field(form, "api-key", "key");
    expect(unload()).toBe(true);
    press(form);
    await form.updateComplete;
    expect(unload()).toBe(false);
    expect(
      await app.leave.coordinator.request({ scopes: [form], reason: "navigation", proceed() {} }),
    ).toBe("proceeded");
    reply.reject({ code: "payment.provider_credential_rejected" });
    await vi.waitFor(() =>
      expect(form.shadowRoot!.querySelector("[data-test=connect]")!.hasAttribute("loading")).toBe(
        false,
      ),
    );
    expect(unload()).toBe(true);
  } finally {
    reply.resolve({ merchantName: "Restaurant" });
  }
});

it("an unchanged contributed form leaves directly without a warning", async () => {
  const form = await mount();
  const proceed = vi.fn();
  expect(unload()).toBe(false);
  expect(
    await app.leave.coordinator.request({ scopes: [app], reason: "navigation", proceed }),
  ).toBe("proceeded");
  expect(proceed).toHaveBeenCalledOnce();
  expect((await question()).open).toBe(false);
  expect(form.shadowRoot!.querySelector("[data-test=connect]")).not.toBeNull();
});
