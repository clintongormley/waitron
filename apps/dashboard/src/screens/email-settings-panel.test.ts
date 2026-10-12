import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, EmailSettingsView } from "../api/client.js";
import "./email-settings-panel.js";
import { setLocale } from "../i18n/t.js";
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Panel = HTMLElementTagNameMap["dashboard-email-settings-panel"];
const stored: EmailSettingsView = {
  mode: "smtp",
  editable: true,
  settings: {
    server: "smtp.example.test",
    port: 465,
    encryption: "tls",
    from: "invoices@example.test",
    hasAuthentication: true,
  },
};
const q = (el: Panel, selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector);
async function mount(settings: EmailSettingsView = stored) {
  const read = vi.fn().mockResolvedValue(settings);
  const client = {
    background: { getEmailSettings: read },
    getEmailSettings: read,
    saveEmailSettings: vi.fn().mockResolvedValue({ saved: true }),
    testEmailSettings: vi.fn().mockResolvedValue({ accepted: true }),
  } as unknown as DashboardApi;
  const mounted = await mountWidget<Panel>("dashboard-email-settings-panel", { api: client });
  await vi.waitFor(() => expect(q(mounted.el, "[data-test=summary]")).not.toBeNull());
  return { ...mounted, read, client };
}
it("shows the redacted gateway and opens a quiet credential editor", async () => {
  const { el } = await mount();
  expect(q(el, "[data-test=summary]")!.textContent).toContain("smtp.example.test");
  expect(q(el, "[data-test=summary]")!.textContent).toContain("invoices@example.test");
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-email-settings-form")!;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
      .disabled,
  ).toBe(true);
});
it("explains missing live invoice email and offers setup", async () => {
  const { el } = await mount({ mode: "unconfigured", editable: true, settings: null });
  expect(q(el, "[data-test=summary]")!.textContent).toContain("Invoices cannot be emailed");
  expect(q(el, "[data-test=change]")).not.toBeNull();
});
it.each(["local_capture", "smtp"] as const)(
  "offers no editor for a non-live %s venue",
  async (mode) => {
    const { el } = await mount(
      mode === "smtp" ? { ...stored, editable: false } : { mode, editable: false, settings: null },
    );
    expect(q(el, "[data-test=change]")).toBeNull();
    expect(q(el, "dashboard-email-settings-form")).toBeNull();
    expect(q(el, "[data-test=summary]")!.textContent).not.toBe("");
  },
);
it("closes a saved editor before a failed refresh and lets the summary retry", async () => {
  const { el, read } = await mount();
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-email-settings-form")!;
  read.mockRejectedValueOnce({ code: "connection.failed" });
  await form.updateComplete;
  for (const [name, value] of [
    ["user", "invoice-user"],
    ["password", "fresh-secret"],
  ]) {
    form
      .shadowRoot!.querySelector(`[data-test=${name}]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  }
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(q(el, "[role=alert]")).not.toBeNull());
  expect(q(el, "dashboard-email-settings-form")).toBeNull();
  q(el, "[data-test=retry]")!.click();
  await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
});
it("keeps newer input in the editor after an earlier draft was saved", async () => {
  const { el } = await mount();
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-email-settings-form")!;
  form.dispatchEvent(
    new CustomEvent("email-saved", { detail: { close: false }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(q(el, "dashboard-email-settings-form")).toBe(form);
});

it("loads mail settings only for a session allowed to manage the system", async () => {
  await import("./email-screen.js");
  const read = vi.fn().mockResolvedValue(stored);
  const client = {
    getEmailInbox: async () => ({ mode: "smtp", count: 0, messages: [] }),
    background: { getEmailSettings: read },
    getEmailSettings: read,
  } as unknown as DashboardApi;
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-email-screen"]>(
    "dashboard-email-screen",
    { api: client },
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-email-settings-panel")).toBeNull();
  expect(read).not.toHaveBeenCalled();
  el.canManage = true;
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-email-settings-panel")).not.toBeNull(),
  );
  expect(read).toHaveBeenCalledOnce();
});

it("closes an unchanged editor on Cancel and ignores that departed editor's later save", async () => {
  const { el } = await mount();
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const old = el.shadowRoot!.querySelector("dashboard-email-settings-form")!;
  await old.updateComplete;
  old.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await vi.waitFor(() => expect(q(el, "dashboard-email-settings-form")).toBeNull());
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const current = el.shadowRoot!.querySelector("dashboard-email-settings-form");
  old.dispatchEvent(
    new CustomEvent("email-saved", { detail: { close: true }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(q(el, "dashboard-email-settings-form")).toBe(current);
});
it.each(["resolve", "reject"] as const)(
  "ignores a departed settings read's late %s",
  async (settle) => {
    let resolve!: (value: EmailSettingsView) => void, reject!: (error: unknown) => void;
    const pending = new Promise<EmailSettingsView>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const read = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(stored);
    const client = { getEmailSettings: read } as unknown as DashboardApi;
    const { el, host } = await mountWidget<Panel>("dashboard-email-settings-panel", {
      api: client,
    });
    el.remove();
    await el.updateComplete;
    host.appendChild(el);
    await el.updateComplete;
    await vi.waitFor(() =>
      expect(q(el, "[data-test=summary]")!.textContent).toContain("smtp.example.test"),
    );
    if (settle === "resolve") resolve({ mode: "unconfigured", editable: true, settings: null });
    else reject({ code: "connection.failed" });
    await pending.catch(() => {});
    await el.updateComplete;
    expect(q(el, "[data-test=summary]")!.textContent).toContain("smtp.example.test");
    expect(q(el, "[role=alert]")).toBeNull();
  },
);

it("returns keyboard focus to Change when the inline editor closes", async () => {
  const { el } = await mount();
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-email-settings-form")!;
  await form.updateComplete;
  const cancel = form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!;
  cancel.focus();
  cancel.click();
  await vi.waitFor(() => expect(q(el, "dashboard-email-settings-form")).toBeNull());
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=change]")));
});

it("leaves the page's focus alone when the panel departs as Cancel closes its editor", async () => {
  const { el } = await mount();
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-email-settings-form")!;
  await form.updateComplete;
  const next = document.createElement("button");
  next.textContent = "Next page";
  el.parentElement!.appendChild(next);
  el.addEventListener(
    "email-cancel",
    () => {
      el.remove();
      next.focus();
    },
    { capture: true, once: true },
  );
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await vi.waitFor(() => expect(el.isConnected).toBe(false));
  await el.updateComplete;
  expect(document.activeElement).toBe(next);
});

it("ignores a detached Change control's click instead of opening a departed editor", async () => {
  const { el } = await mount();
  const change = q(el, "[data-test=change]")!;
  el.remove();
  change.click();
  await el.updateComplete;
  expect(q(el, "dashboard-email-settings-form")).toBeNull();
});

it("ignores a save notification from another child while the credential editor is open", async () => {
  const { el, read } = await mount();
  q(el, "[data-test=change]")!.click();
  await el.updateComplete;
  const form = q(el, "dashboard-email-settings-form");
  q(el, "[data-test=summary]")!.dispatchEvent(
    new CustomEvent("email-saved", {
      detail: { close: true },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(q(el, "dashboard-email-settings-form")).toBe(form);
  expect(read).toHaveBeenCalledOnce();
});
