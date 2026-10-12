import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget, reattachAfterDetachedUpdate } from "./test-helpers.js";
import "./email-settings-form.js";

import { setLocale } from "../i18n/t.js";
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Form = HTMLElementTagNameMap["dashboard-email-settings-form"];
export const stored = {
  server: "smtp.example.test",
  port: 465,
  encryption: "tls" as const,
  from: "invoices@example.test",
  hasAuthentication: true,
};
export function api() {
  return {
    saveEmailSettings: vi.fn().mockResolvedValue({ saved: true }),
    testEmailSettings: vi.fn().mockResolvedValue({ accepted: true }),
  } as unknown as DashboardApi;
}
export async function mount(settings: typeof stored | null = stored, client = api()) {
  const mounted = await mountWidget<Form>("dashboard-email-settings-form", {
    settings,
    api: client,
  });
  return { ...mounted, client };
}
export const button = (form: Form, key: string) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${key}]`)!;
export const field = (form: Form, key: string) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${key}]`)!;
export async function edit(form: Form, key: string, value: string) {
  field(form, key).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
}
export async function credentials(form: Form) {
  await edit(form, "user", "invoice-user");
  await edit(form, "password", "fresh-secret");
}

it("opens quiet with redacted server details and empty credentials", async () => {
  const { el, client } = await mount();
  expect(field(el, "server").value).toBe("smtp.example.test");
  expect(field(el, "from").value).toBe("invoices@example.test");
  expect(field(el, "user").value).toBe("");
  expect(field(el, "password").value).toBe("");
  expect(button(el, "save").variant).toBe("secondary");
  expect(button(el, "save").disabled).toBe(true);
  button(el, "save").click();
  await el.updateComplete;
  expect(client.saveEmailSettings).not.toHaveBeenCalled();
});
it("requires fresh authentication before changing an authenticated gateway", async () => {
  const { el, client } = await mount();
  await edit(el, "from", "changed@example.test");
  button(el, "save").click();
  await el.updateComplete;
  expect(field(el, "user").error).not.toBe("");
  expect(field(el, "password").error).not.toBe("");
  expect(button(el, "save").disabled).toBe(true);
  expect(client.saveEmailSettings).not.toHaveBeenCalled();
  await credentials(el);
  expect(button(el, "save").disabled).toBe(false);
});
it("submits fresh credentials and commits before telling the owner to close", async () => {
  const { el, client } = await mount();
  const saved = vi.fn();
  el.addEventListener("email-saved", saved);
  await credentials(el);
  button(el, "save").click();
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(client.saveEmailSettings).toHaveBeenCalledWith({
    server: "smtp.example.test",
    port: 465,
    encryption: "tls",
    user: "invoice-user",
    password: "fresh-secret",
    from: "invoices@example.test",
  });
  expect(button(el, "save").disabled).toBe(true);
  expect(button(el, "save").variant).toBe("secondary");
  expect(saved.mock.calls[0]![0].detail).toEqual({ close: true });
});
it("keeps a refused field editable and the changed save retryable", async () => {
  const client = api();
  vi.mocked(client.saveEmailSettings).mockRejectedValueOnce({
    code: "email.settings_invalid",
    params: { field: "from" },
  });
  const { el } = await mount(stored, client);
  await credentials(el);
  button(el, "save").click();
  await vi.waitFor(() => expect(field(el, "from").error).not.toBe(""));
  expect(button(el, "save").disabled).toBe(false);
  await edit(el, "from", "changed@example.test");
  expect(field(el, "from").error).toBe("");
  button(el, "save").click();
  await vi.waitFor(() => expect(button(el, "save").disabled).toBe(true));
  expect(client.saveEmailSettings).toHaveBeenCalledTimes(2);
});
it.each(["email.test_refused", "email.test_timeout"] as const)(
  "retains a %s draft and allows another test",
  async (code) => {
    const client = api();
    vi.mocked(client.testEmailSettings).mockResolvedValueOnce({ accepted: false, code });
    const { el } = await mount(stored, client);
    await credentials(el);
    button(el, "test").click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
    );
    expect(field(el, "password").value).toBe("fresh-secret");
    expect(button(el, "test").disabled).toBe(false);
    button(el, "test").click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=status]")).not.toBeNull());
  },
);
it("makes save quiet again when a change is undone", async () => {
  const { el } = await mount();
  await edit(el, "from", "changed@example.test");
  expect(button(el, "save").variant).toBe("primary");
  await edit(el, "from", "invoices@example.test");
  expect(button(el, "save").variant).toBe("secondary");
  expect(button(el, "save").disabled).toBe(true);
});
it("retains both the draft and its dirty baseline on reconnect", async () => {
  const { el } = await mount();
  await edit(el, "from", "changed@example.test");
  await reattachAfterDetachedUpdate(el);
  expect(field(el, "from").value).toBe("changed@example.test");
  expect(button(el, "save").variant).toBe("primary");
});

it("lets the owner explicitly remove authentication when changing to another gateway", async () => {
  const { el, client } = await mount();
  const authentication = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "[data-test=authentication]",
  );
  expect(authentication).not.toBeNull();
  authentication!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: false }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  button(el, "save").click();
  await vi.waitFor(() => expect(client.saveEmailSettings).toHaveBeenCalledOnce());
  expect(client.saveEmailSettings).toHaveBeenCalledWith({
    server: "smtp.example.test",
    port: 465,
    encryption: "tls",
    user: "",
    password: "",
    from: "invoices@example.test",
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("does not let a departed save commit the reconnected draft", async () => {
  const pending = deferred<{ saved: true }>(),
    client = api();
  vi.mocked(client.saveEmailSettings).mockReturnValue(pending.promise);
  const { el } = await mount(stored, client),
    saved = vi.fn();
  el.addEventListener("email-saved", saved);
  await credentials(el);
  button(el, "save").click();
  await reattachAfterDetachedUpdate(el);
  pending.resolve({ saved: true });
  await pending.promise;
  await el.updateComplete;
  expect(saved).not.toHaveBeenCalled();
  expect(button(el, "save").variant).toBe("primary");
});
it("commits the submitted draft while retaining input delivered during a save", async () => {
  const pending = deferred<{ saved: true }>(),
    client = api();
  vi.mocked(client.saveEmailSettings).mockReturnValue(pending.promise);
  const { el } = await mount(stored, client),
    saved = vi.fn();
  el.addEventListener("email-saved", saved);
  await credentials(el);
  button(el, "save").click();
  await edit(el, "from", "newer@example.test");
  pending.resolve({ saved: true });
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0]![0].detail).toEqual({ close: false });
  expect(field(el, "from").value).toBe("newer@example.test");
  expect(button(el, "save").variant).toBe("primary");
  await edit(el, "from", "invoices@example.test");
  expect(button(el, "save").variant).toBe("secondary");
});
it("does not accept a test reply after the draft changes", async () => {
  const pending = deferred<{ accepted: true }>(),
    client = api();
  vi.mocked(client.testEmailSettings).mockReturnValue(pending.promise);
  const { el } = await mount(stored, client);
  await credentials(el);
  button(el, "test").click();
  await edit(el, "from", "changed@example.test");
  pending.resolve({ accepted: true });
  await pending.promise;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[role=status]")).toBeNull();
  expect(button(el, "test").disabled).toBe(false);
});
it.each(["0", "65536", "2.5", "port"])(
  "refuses invalid port %s beside the field without sending",
  async (value) => {
    const { el, client } = await mount();
    await credentials(el);
    await edit(el, "port", value);
    button(el, "save").click();
    await el.updateComplete;
    expect(field(el, "port").error).not.toBe("");
    expect(button(el, "save").disabled).toBe(true);
    expect(client.saveEmailSettings).not.toHaveBeenCalled();
  },
);
it("opens a new gateway without errors and marks all missing values after a test", async () => {
  const { el, client } = await mount(null);
  expect(field(el, "server").error).toBe("");
  button(el, "test").click();
  await el.updateComplete;
  expect(field(el, "server").error).not.toBe("");
  expect(field(el, "from").error).not.toBe("");
  expect(field(el, "port").error).toBe("");
  expect(client.testEmailSettings).not.toHaveBeenCalled();
});
it("reveals the current password without changing Save's dirty state", async () => {
  const { el } = await mount();
  expect(field(el, "password").type).toBe("password");
  button(el, "reveal").click();
  await el.updateComplete;
  expect(field(el, "password").type).toBe("text");
  expect(button(el, "save").variant).toBe("secondary");
});

it("explains the SMTP refusal at the bottom in the screen language", async () => {
  const client = api();
  vi.mocked(client.testEmailSettings).mockResolvedValue({
    accepted: false,
    code: "email.test_refused",
  });
  const { el } = await mount(stored, client);
  await credentials(el);
  button(el, "test").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      "The mail server refused the test message. Check the settings and try again.",
    ),
  );
});

it("saves a valid draft through native Enter", async () => {
  const { el, client } = await mount();
  await credentials(el);
  const native = field(el, "from").shadowRoot!.querySelector("input")!;
  native.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await vi.waitFor(() => expect(client.saveEmailSettings).toHaveBeenCalledOnce());
});
it("saves a new gateway without authentication when the switch stays off", async () => {
  const { el, client } = await mount(null);
  await edit(el, "server", "smtp.example.test");
  await edit(el, "from", "invoices@example.test");
  button(el, "save").click();
  await vi.waitFor(() => expect(client.saveEmailSettings).toHaveBeenCalledOnce());
  expect(client.saveEmailSettings).toHaveBeenCalledWith({
    server: "smtp.example.test",
    port: 587,
    encryption: "starttls",
    user: "",
    password: "",
    from: "invoices@example.test",
  });
});

it("keeps a save without a named field retryable with the refusal at the bottom", async () => {
  const client = api();
  vi.mocked(client.saveEmailSettings).mockRejectedValueOnce({ code: "connection.failed" });
  const { el } = await mount(stored, client);
  await credentials(el);
  button(el, "save").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
  );
  expect(button(el, "save").disabled).toBe(false);
  expect(field(el, "from").error).toBe("");
});
it("rejects invalid encryption alongside the selection instead of sending", async () => {
  const { el, client } = await mount();
  await credentials(el);
  el.shadowRoot!.querySelector("[data-test=encryption]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "plaintext" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  button(el, "test").click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[data-test=encryption]")!
      .error,
  ).not.toBe("");
  expect(client.testEmailSettings).not.toHaveBeenCalled();
});
it("does not send a second save or cancel while a save is pending", async () => {
  const pending = deferred<{ saved: true }>(),
    client = api();
  vi.mocked(client.saveEmailSettings).mockReturnValue(pending.promise);
  const { el } = await mount(stored, client),
    cancel = vi.fn();
  el.addEventListener("email-cancel", cancel);
  await credentials(el);
  button(el, "save").click();
  await el.updateComplete;
  button(el, "save").click();
  button(el, "cancel").click();
  expect(client.saveEmailSettings).toHaveBeenCalledOnce();
  expect(cancel).not.toHaveBeenCalled();
  pending.resolve({ saved: true });
  await pending.promise;
});

it.each(["edit", "reconnect"] as const)("ignores a late refusal after %s", async (action) => {
  const pending = deferred<{ saved: true }>(),
    client = api();
  vi.mocked(client.saveEmailSettings).mockReturnValue(pending.promise);
  const { el } = await mount(stored, client);
  await credentials(el);
  button(el, "save").click();
  if (action === "edit") await edit(el, "from", "changed@example.test");
  else await reattachAfterDetachedUpdate(el);
  pending.reject({ code: "email.settings_invalid", params: { field: "from" } });
  await pending.promise.catch(() => {});
  await el.updateComplete;
  expect(field(el, "from").error).toBe("");
  expect(button(el, "save").variant).toBe("primary");
});

it("refuses a programmatic unchanged save even when all fields validate", async () => {
  const { el, client } = await mount({ ...stored, hasAuthentication: false });
  button(el, "save").click();
  await el.updateComplete;
  expect(client.saveEmailSettings).not.toHaveBeenCalled();
  expect(field(el, "server").error).toBe("");
});

it("explains a missing account recipient without marking a mail-server field", async () => {
  const client = api();
  vi.mocked(client.testEmailSettings).mockRejectedValue({
    code: "email.settings_invalid",
    params: { field: "recipient" },
  });
  const { el } = await mount(stored, client);
  await credentials(el);
  button(el, "test").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      "Check the mail server settings and your account email address, then try again.",
    ),
  );
  expect(field(el, "from").error).toBe("");
});
