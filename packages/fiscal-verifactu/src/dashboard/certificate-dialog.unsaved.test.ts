import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { CertificateCardView, InstallAnswerView } from "./client.js";
import type { AeatCertificateCard } from "./certificate-card.js";
import type { AeatCertificateDialog } from "./certificate-dialog.js";

const card: CertificateCardView = {
  filing: true,
  revision: "rev-1",
  timeZone: "Europe/Madrid",
  installed: null,
};

const install: () => Promise<InstallAnswerView> = async () => ({
  outcome: "installed",
  reason: "installed",
  details: { checkedAt: "2026-10-18T11:05:00.000Z" },
});

class CertificateLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly panel = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
    request: ((_path: string, method: string) =>
      method === "GET" ? Promise.resolve(card) : install()) as unknown as DashboardRequest,
  });
  override render() {
    return html`${this.panel.render(false)}
    ${this.leave.render({
      heading: "Unsaved changes",
      message: "Discard unsaved changes?",
      keepLabel: "Keep editing",
      discardLabel: "Discard changes",
    })}`;
  }
}
customElements.define("aeat-certificate-leave-test", CertificateLeaveApp);

let app: CertificateLeaveApp;
let locale = "";
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  app?.remove();
  setLocale(locale);
});

async function open() {
  app = document.createElement("aeat-certificate-leave-test") as CertificateLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector(
    "dashboard-aeat-certificate-card",
  ) as AeatCertificateCard;
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("[data-test=certificate-action]")).not.toBeNull(),
  );
  await userEvent.click(el.shadowRoot!.querySelector("[data-test=certificate-action]")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).not.toBeNull(),
  );
  const dialog = el.shadowRoot!.querySelector(
    "dashboard-aeat-certificate-dialog",
  ) as AeatCertificateDialog;
  await dialog.updateComplete;
  return { card: el, dialog };
}

async function choose(dialog: AeatCertificateDialog) {
  const input = dialog
    .shadowRoot!.querySelector("wt-file-input")!
    .shadowRoot!.querySelector<HTMLInputElement>("input")!;
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array([0x30, 0x82, 0x0d])], "bar-lucia-2026.p12"));
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await dialog.updateComplete;
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

function closed(dialog: AeatCertificateDialog): Promise<Event> {
  return new Promise((resolve) => dialog.addEventListener("wt-close", resolve, { once: true }));
}

const cancel = (dialog: AeatCertificateDialog) =>
  userEvent.click(dialog.shadowRoot!.querySelector("[data-test=certificate-cancel]")!);

it("asks before Cancel throws away a chosen file, and Keep leaves the dialog and its file", async () => {
  const { card, dialog } = await open();
  await choose(dialog);
  expect(unload()).toBe(true);
  await cancel(dialog);
  await vi.waitFor(async () => expect((await question()).open).toBe(true));
  const q = await question();
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(async () => expect((await question()).open).toBe(false));
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).toBe(dialog);
  expect(dialog.shadowRoot!.querySelector("wt-file-input")!.files).toHaveLength(1);

  const close = closed(dialog);
  await cancel(dialog);
  await vi.waitFor(async () => expect((await question()).open).toBe(true));
  (await question()).shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await close;
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).toBeNull();
  expect(unload()).toBe(false);
});

it("closes an untouched dialog at once", async () => {
  const { card, dialog } = await open();
  expect(unload()).toBe(false);
  const close = closed(dialog);
  await cancel(dialog);
  await close;
  expect((await question()).open).toBe(false);
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).toBeNull();
});

it("after a successful install nothing is asked", async () => {
  const { dialog } = await open();
  await choose(dialog);
  dialog
    .shadowRoot!.querySelector("wt-input")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "secret" }, bubbles: true, composed: true }),
    );
  await dialog.updateComplete;
  expect(unload()).toBe(true);
  const atInstall: boolean[] = [];
  dialog.addEventListener("aeat-certificate-installed", () => {
    atInstall.push(unload(), app.leave.coordinator.isDirty());
  });
  const close = closed(dialog);
  await userEvent.click(dialog.shadowRoot!.querySelector("[data-test=certificate-save]")!);
  await close;
  expect(atInstall).toEqual([false, false]);
  const proceed = vi.fn();
  expect(
    await app.leave.coordinator.request({ scopes: [app], reason: "navigation", proceed }),
  ).toBe("proceeded");
  expect(proceed).toHaveBeenCalledOnce();
  expect((await question()).open).toBe(false);
});
