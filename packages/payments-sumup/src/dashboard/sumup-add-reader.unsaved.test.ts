import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { SumUpAddReader } from "./sumup-add-reader.js";
class ReaderLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  request = vi.fn(async () => ({
    id: "reader-one",
    status: "paired",
  })) as unknown as DashboardRequest;
  added = vi.fn();
  closed = vi.fn();
  override render() {
    return html`<sumup-add-reader
        .request=${this.request}
        .onAdded=${this.added}
        .onClose=${this.closed}
      ></sumup-add-reader>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("sumup-reader-leave-test", ReaderLeaveApp);
let app: ReaderLeaveApp;
afterEach(() => app?.remove());
async function mount(request?: DashboardRequest) {
  app = document.createElement("sumup-reader-leave-test") as ReaderLeaveApp;
  if (request) app.request = request;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const form = app.shadowRoot!.querySelector("sumup-add-reader")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return form;
}
async function field(form: SumUpAddReader, id: string, value: string) {
  form
    .shadowRoot!.querySelector(`[data-test=${id}]`)!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await form.updateComplete;
}
function value(form: SumUpAddReader, id: string) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${id}]`)!
    .value;
}
function native(form: SumUpAddReader) {
  return form.shadowRoot!.querySelector("wt-dialog")!.shadowRoot!.querySelector("dialog")!;
}
function dialogClosed(form: SumUpAddReader): Promise<unknown> {
  const dialog = form.shadowRoot!.querySelector("wt-dialog")!;
  return new Promise((resolve) => dialog.addEventListener("wt-close", resolve, { once: true }));
}
function cancel(form: SumUpAddReader) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}
function add(form: SumUpAddReader) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=pair]")!.click();
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
for (const id of ["reader-name", "pairing-code"])
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
      const closed = dialogClosed(form);
      cancel(form);
      await choice("discard");
      await closed;
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
  const closed = dialogClosed(form);
  cancel(form);
  await closed;
  await vi.waitFor(() => expect(app.closed).toHaveBeenCalledOnce());
  expect((await question()).open).toBe(false);
  expect(native(form).open).toBe(false);
});
it("accepted registration reports the exact submitted body and closes without a warning", async () => {
  const bodies: unknown[] = [];
  const form = await mount(((path: string, method: string, body: unknown) => {
    bodies.push({ path, method, body });
    return Promise.resolve({ id: "reader-one", status: "paired" });
  }) as DashboardRequest);
  const observed: boolean[] = [];
  form.onAdded = () => observed.push(unload());
  await field(form, "reader-name", " Bar ");
  await field(form, "pairing-code", " ABCD1234 ");
  expect(unload()).toBe(true);
  add(form);
  await vi.waitFor(() => expect(app.closed).toHaveBeenCalledOnce());
  expect(observed).toEqual([false]);
  expect(bodies).toEqual([
    {
      path: "/management-api/payments/readers",
      method: "POST",
      body: { providerId: "sumup", name: " Bar ", code: " ABCD1234 " },
    },
  ]);
  expect(native(form).open).toBe(false);
  expect(unload()).toBe(false);
});
it("a refused registration retains its draft and Cancel still asks", async () => {
  const form = await mount((async () => {
    throw { code: "payment.pairing_refused" };
  }) as DashboardRequest);
  await field(form, "reader-name", "Bar");
  await field(form, "pairing-code", "BADCODE");
  add(form);
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("[data-test=pair]")!.hasAttribute("loading")).toBe(false),
  );
  expect(unload()).toBe(true);
  cancel(form);
  await choice("keep");
  expect(value(form, "pairing-code")).toBe("BADCODE");
  expect(app.added).not.toHaveBeenCalled();
});
it("submitted registration is a direct-close exemption and still reports the reader once", async () => {
  const reply = deferred<{ id: string; status: string }>();
  const form = await mount((() => reply.promise) as DashboardRequest);
  try {
    await field(form, "reader-name", "Bar");
    await field(form, "pairing-code", "ABCD1234");
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
it("disconnect clears values and departed input, Pair, Cancel and close reports cannot affect a replacement", async () => {
  const form = await mount();
  await field(form, "reader-name", "Departing");
  await field(form, "pairing-code", "OLD_CODE");
  const oldField = form.shadowRoot!.querySelector("[data-test=reader-name]")!;
  const oldPair = form.shadowRoot!.querySelector<HTMLElement>("[data-test=pair]")!;
  const oldCancel = form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!;
  const oldDialog = form.shadowRoot!.querySelector("wt-dialog")!;
  form.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(form);
  await form.updateComplete;
  expect(value(form, "reader-name")).toBe("");
  expect(value(form, "pairing-code")).toBe("");
  await field(form, "reader-name", "Replacement");
  await field(form, "pairing-code", "NEW_CODE");
  oldField.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Obsolete" } }));
  oldPair.click();
  oldCancel.click();
  oldDialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await form.updateComplete;
  expect(value(form, "reader-name")).toBe("Replacement");
  expect(app.request).not.toHaveBeenCalled();
  expect(app.closed).not.toHaveBeenCalled();
  expect(native(form).open).toBe(true);
});
for (const result of ["paired", "processing", "refused"] as const)
  it(`a departed ${result} POST leaves a reconnected opening and its callbacks alone`, async () => {
    const reply = deferred<{ id: string; status: "paired" | "processing" }>();
    const oldAdded = vi.fn();
    const requests: unknown[] = [];
    const form = await mount(((path: string, method: string, body: unknown) => {
      requests.push({ path, method, body });
      return path === "/management-api/payments/readers" ? reply.promise : Promise.resolve();
    }) as DashboardRequest);
    form.onAdded = oldAdded;
    await field(form, "reader-name", "First");
    await field(form, "pairing-code", "OLD_CODE");
    add(form);
    await form.updateComplete;
    form.remove();
    form.onAdded = app.added;
    app.shadowRoot!.append(form);
    await form.updateComplete;
    expect(form.shadowRoot!.querySelector("[data-test=reader-name]")).not.toBeNull();
    await field(form, "reader-name", "Replacement");
    if (result === "refused") reply.reject({ code: "payment.pairing_refused" });
    else reply.resolve({ id: "old-reader", status: result });
    await vi.waitFor(() => {
      if (result === "paired") expect(oldAdded).toHaveBeenCalledOnce();
      if (result === "processing")
        expect(requests).toContainEqual({
          path: "/management-api/payments/readers/old-reader/unpair",
          method: "POST",
          body: undefined,
        });
    });
    await new Promise((r) => setTimeout(r, 30));
    await form.updateComplete;
    expect(native(form).open).toBe(true);
    expect(value(form, "reader-name")).toBe("Replacement");
    expect(app.closed).not.toHaveBeenCalled();
    expect(app.added).not.toHaveBeenCalled();
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe("");
    expect(unload()).toBe(true);
  });
it("an accepted notification reconnecting the form cannot close the new opening", async () => {
  const form = await mount();
  let notified = 0;
  form.onAdded = () => {
    notified++;
    form.remove();
    app.shadowRoot!.append(form);
  };
  await field(form, "reader-name", "First");
  await field(form, "pairing-code", "ABCD1234");
  add(form);
  await vi.waitFor(() => expect(notified).toBe(1));
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("[data-test=reader-name]")).not.toBeNull();
  expect(value(form, "reader-name")).toBe("");
  expect(native(form).open).toBe(true);
  expect(app.closed).not.toHaveBeenCalled();
});
it("a failed poll is exempt, while Try again retains the name and protects only new input", async () => {
  vi.useFakeTimers();
  try {
    const form = await mount((async (path: string) => {
      if (path === "/management-api/payments/readers") return { id: "r1", status: "processing" };
      if (path.endsWith("/status")) throw { code: "server.internal" };
      return undefined;
    }) as DashboardRequest);
    await field(form, "reader-name", "First");
    await field(form, "pairing-code", "ABCD1234");
    add(form);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await form.updateComplete;
    expect(form.shadowRoot!.querySelector("[data-test=pairing-failed]")).not.toBeNull();
    expect(unload()).toBe(false);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=try-again]")!.click();
    await form.updateComplete;
    expect(value(form, "reader-name")).toBe("First");
    expect(value(form, "pairing-code")).toBe("");
    expect(unload()).toBe(false);
    await field(form, "pairing-code", "NEW_CODE");
    expect(unload()).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
for (const oldResult of ["paired", "refused", "timeout"] as const)
  it(`a departed ${oldResult} poll cannot finish, fail or release the replacement poll`, async () => {
    vi.useFakeTimers();
    const oldPoll = deferred<{ online: boolean; pairingStatus: "paired" }>();
    const newPoll = deferred<{ online: boolean; pairingStatus: "processing" }>();
    const reads: string[] = [];
    let adds = 0;
    try {
      const form = await mount(((path: string, method: string) => {
        if (path === "/management-api/payments/readers")
          return Promise.resolve({ id: ++adds === 1 ? "old" : "new", status: "processing" });
        if (method === "GET") {
          reads.push(path);
          return path.includes("/old/") ? oldPoll.promise : newPoll.promise;
        }
        return Promise.resolve();
      }) as DashboardRequest);
      await field(form, "reader-name", "First");
      await field(form, "pairing-code", "OLD_CODE");
      add(form);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads).toEqual(["/management-api/payments/readers/old/status"]);
      form.remove();
      app.shadowRoot!.append(form);
      await form.updateComplete;
      await field(form, "reader-name", "Replacement");
      await field(form, "pairing-code", "NEW_CODE");
      add(form);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads).toEqual([
        "/management-api/payments/readers/old/status",
        "/management-api/payments/readers/new/status",
      ]);
      if (oldResult === "paired") oldPoll.resolve({ online: false, pairingStatus: "paired" });
      else
        oldPoll.reject({
          code: oldResult === "timeout" ? "connection.timed_out" : "server.internal",
        });
      await vi.advanceTimersByTimeAsync(2000);
      await form.updateComplete;
      expect(reads).toHaveLength(2);
      expect(form.shadowRoot!.querySelector("[data-test=pairing-progress]")).not.toBeNull();
      expect(form.shadowRoot!.querySelector("[data-test=pairing-failed]")).toBeNull();
      expect(form.shadowRoot!.querySelector("[data-test=pairing-timeout]")).toBeNull();
      expect(app.added).not.toHaveBeenCalled();
      expect(app.closed).not.toHaveBeenCalled();
      newPoll.resolve({ online: false, pairingStatus: "processing" });
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads).toHaveLength(3);
    } finally {
      app?.remove();
      oldPoll.resolve({ online: false, pairingStatus: "paired" });
      newPoll.resolve({ online: false, pairingStatus: "processing" });
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });
it("disconnect aborts a pending discard decision without closing the replacement", async () => {
  const form = await mount();
  await field(form, "pairing-code", "OLD_CODE");
  cancel(form);
  const oldQuestion = await question();
  expect(oldQuestion.open).toBe(true);
  form.remove();
  app.shadowRoot!.append(form);
  await form.updateComplete;
  await field(form, "pairing-code", "NEW_CODE");
  await oldQuestion.updateComplete;
  oldQuestion.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  expect(app.closed).not.toHaveBeenCalled();
  expect(native(form).open).toBe(true);
  expect(value(form, "pairing-code")).toBe("NEW_CODE");
  expect(unload()).toBe(true);
});
