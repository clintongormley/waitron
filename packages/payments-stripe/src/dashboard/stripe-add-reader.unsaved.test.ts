import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { StripeAddReader } from "./stripe-add-reader.js";
class ReaderLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  request = vi.fn(async () => ({
    id: "reader-one",
    status: "paired",
  })) as unknown as DashboardRequest;
  added = vi.fn();
  closed = vi.fn();
  override render() {
    return html`<stripe-add-reader
        .request=${this.request}
        .onAdded=${this.added}
        .onClose=${this.closed}
      ></stripe-add-reader>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("stripe-reader-leave-test", ReaderLeaveApp);
let app: ReaderLeaveApp;
afterEach(() => app?.remove());
async function mount(request?: DashboardRequest) {
  app = document.createElement("stripe-reader-leave-test") as ReaderLeaveApp;
  if (request) app.request = request;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const form = app.shadowRoot!.querySelector("stripe-add-reader")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return form;
}
async function field(form: StripeAddReader, id: string, value: string) {
  form
    .shadowRoot!.querySelector(`[data-test=${id}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await form.updateComplete;
}
function value(form: StripeAddReader, id: string) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${id}]`)!
    .value;
}
function native(form: StripeAddReader) {
  return form.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector("dialog")!;
}
function cancel(form: StripeAddReader) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}
function add(form: StripeAddReader) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choice(which: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${which}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
for (const id of ["reader-name", "reader-id"])
  for (const route of ["cancel", "escape"]) {
    it(`protects exact ${id} through ${route}, Keep and Discard`, async () => {
      const form = await mount();
      await field(form, id, "  edited  ");
      expect(unload()).toBe(true);
      if (route === "cancel") cancel(form);
      else await userEvent.keyboard("{Escape}");
      expect((await question()).open).toBe(true);
      expect(native(form).open).toBe(true);
      expect(app.closed).not.toHaveBeenCalled();
      await choice("keep");
      expect(value(form, id)).toBe("  edited  ");
      expect(native(form).open).toBe(true);
      cancel(form);
      await choice("discard");
      await vi.waitFor(() => expect(app.closed).toHaveBeenCalledOnce());
      expect(native(form).open).toBe(false);
      expect(app.request).not.toHaveBeenCalled();
      expect(unload()).toBe(false);
    });
  }
it("clean and reverted reader values close directly", async () => {
  const form = await mount();
  await field(form, "reader-name", "changed");
  await field(form, "reader-name", "");
  expect(unload()).toBe(false);
  cancel(form);
  await vi.waitFor(() => expect(app.closed).toHaveBeenCalledOnce());
  expect((await question()).open).toBe(false);
  expect(native(form).open).toBe(false);
});
it("accepted registration commits before the host refresh notification", async () => {
  const bodies: unknown[] = [];
  const form = await mount(((path: string, method: string, body: unknown) => {
    bodies.push({ path, method, body });
    return Promise.resolve({ id: "reader-one", status: "paired" });
  }) as DashboardRequest);
  const observed: boolean[] = [];
  form.onAdded = () => observed.push(unload());
  await field(form, "reader-name", " Bar ");
  await field(form, "reader-id", " tmr_one ");
  expect(unload()).toBe(true);
  add(form);
  await vi.waitFor(() => expect(app.closed).toHaveBeenCalledOnce());
  expect(observed).toEqual([false]);
  expect(bodies).toEqual([
    {
      path: "/management-api/payments/readers",
      method: "POST",
      body: { providerId: "stripe", name: " Bar ", reference: " tmr_one " },
    },
  ]);
  expect(native(form).open).toBe(false);
  expect(unload()).toBe(false);
});
it("a refused registration retains its draft and Cancel still asks", async () => {
  const form = await mount((async () => {
    throw { code: "reader.not_found" };
  }) as DashboardRequest);
  await field(form, "reader-name", "Bar");
  await field(form, "reader-id", "tmr_bad");
  add(form);
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("[data-test=add]")!.hasAttribute("loading")).toBe(false),
  );
  expect(unload()).toBe(true);
  cancel(form);
  await choice("keep");
  expect(value(form, "reader-id")).toBe("tmr_bad");
  expect(app.added).not.toHaveBeenCalled();
});
it("newer delivered input stays dirty after a registration succeeds", async () => {
  const reply = deferred<{ id: string; status: string }>();
  const form = await mount((() => reply.promise) as DashboardRequest);
  try {
    await field(form, "reader-name", "First");
    await field(form, "reader-id", "tmr_one");
    add(form);
    await form.updateComplete;
    await field(form, "reader-name", "Second");
    reply.resolve({ id: "reader-one", status: "paired" });
    await vi.waitFor(() => expect(app.added).toHaveBeenCalledOnce());
    expect(value(form, "reader-name")).toBe("Second");
    expect(native(form).open).toBe(true);
    expect(unload()).toBe(true);
    expect(app.closed).not.toHaveBeenCalled();
  } finally {
    reply.resolve({ id: "reader-one", status: "paired" });
  }
});
it("submitted registration is a direct-close exemption and still reports the reader once", async () => {
  const reply = deferred<{ id: string; status: string }>();
  const form = await mount((() => reply.promise) as DashboardRequest);
  try {
    await field(form, "reader-name", "Bar");
    await field(form, "reader-id", "tmr_one");
    add(form);
    await form.updateComplete;
    expect(unload()).toBe(false);
    cancel(form);
    await vi.waitFor(() => expect(app.closed).toHaveBeenCalledOnce());
    expect((await question()).open).toBe(false);
    reply.resolve({ id: "reader-one", status: "paired" });
    await vi.waitFor(() => expect(app.added).toHaveBeenCalledOnce());
    expect(app.closed).toHaveBeenCalledOnce();
    expect(unload()).toBe(false);
  } finally {
    reply.resolve({ id: "reader-one", status: "paired" });
  }
});
it("disconnect clears fields and old field/submit controls cannot change a reconnected form", async () => {
  const form = await mount();
  await field(form, "reader-name", "Secret");
  const old = form.shadowRoot!.querySelector("[data-test=reader-name]")!;
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!;
  form.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(form);
  await form.updateComplete;
  expect(value(form, "reader-name")).toBe("");
  await field(form, "reader-name", "Replacement");
  await field(form, "reader-id", "tmr_new");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed" } }));
  submit.click();
  await form.updateComplete;
  expect(value(form, "reader-name")).toBe("Replacement");
  expect(app.request).not.toHaveBeenCalled();
});
for (const accepted of [true, false])
  it(`a departed ${accepted ? "accepted" : "refused"} reply leaves a reconnected reader opening alone`, async () => {
    const reply = deferred<{ id: string; status: string }>();
    const form = await mount((() => reply.promise) as DashboardRequest);
    try {
      await field(form, "reader-name", "First");
      await field(form, "reader-id", "tmr_one");
      add(form);
      await form.updateComplete;
      form.remove();
      app.shadowRoot!.append(form);
      await form.updateComplete;
      await field(form, "reader-name", "Replacement");
      if (accepted) reply.resolve({ id: "reader-one", status: "paired" });
      else reply.reject({ code: "reader.not_found" });
      await new Promise((r) => setTimeout(r, 30));
      await form.updateComplete;
      expect(native(form).open).toBe(true);
      expect(value(form, "reader-name")).toBe("Replacement");
      expect(app.closed).not.toHaveBeenCalled();
      expect(
        form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
          .error,
      ).toBe("");
      expect(unload()).toBe(true);
    } finally {
      reply.resolve({ id: "reader-one", status: "paired" });
    }
  });
it("a refresh notification that reconnects the form does not close the replacement", async () => {
  const form = await mount();
  form.onAdded = () => {
    form.remove();
    app.shadowRoot!.append(form);
  };
  await field(form, "reader-name", "Bar");
  await field(form, "reader-id", "tmr_one");
  add(form);
  await new Promise((r) => setTimeout(r, 30));
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  expect(native(form).open).toBe(true);
  expect(app.closed).not.toHaveBeenCalled();
  expect(value(form, "reader-name")).toBe("");
  expect(unload()).toBe(false);
});
it("a departed native close report and Cancel control do not close a reconnected form", async () => {
  const form = await mount();
  const old = form.shadowRoot!.querySelector("wt-dialog")!;
  const button = form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!;
  form.remove();
  app.shadowRoot!.append(form);
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  await field(form, "reader-name", "Replacement");
  old.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  button.click();
  await form.updateComplete;
  expect(app.closed).not.toHaveBeenCalled();
  expect(native(form).open).toBe(true);
  expect((await question()).open).toBe(false);
  expect(value(form, "reader-name")).toBe("Replacement");
});
