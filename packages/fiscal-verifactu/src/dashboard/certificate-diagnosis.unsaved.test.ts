import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, applyTokens } from "@waitron/ui";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import { evidence, held, permission, savedCard } from "../../test/diagnosis-browser-fixtures.js";
import type { CertificateDiagnosisRequest } from "../certificate-diagnosis-contract.js";
import type { AeatCertificateDialog } from "./certificate-dialog.js";
const auth = permission();
const requests: { path: string; body: unknown }[] = [];
class DiagnosisLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
    permissionContinuation: auth.hook,
    request: (async (path: string, method: string, body: unknown) => {
      requests.push({ path, body });
      if (method === "GET") return savedCard;
      if (path.endsWith("diagnose")) return evidence(body as CertificateDiagnosisRequest);
      return { outcome: "refused", reason: "check_failed" };
    }) as DashboardRequest,
  });
  override render() {
    return html`${this.handle.render(false)}${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("diagnosis-leave-app", DiagnosisLeaveApp);
let app: DiagnosisLeaveApp;
let locale = "";
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
  requests.length = 0;
  app = new DiagnosisLeaveApp();
  applyTokens(app);
  document.body.append(app);
});
afterEach(() => {
  app.remove();
  setLocale(locale);
});
const query = <T extends Element = HTMLElement>(el: Element, s: string) =>
  el.shadowRoot!.querySelector<T>(s)!;
async function editor() {
  await app.updateComplete;
  const card = query(app, "dashboard-aeat-certificate-card");
  await vi.waitFor(() => expect(query(card, "[data-test=certificate-action]")).not.toBeNull());
  await userEvent.click(query(card, "[data-test=certificate-action]"));
  const dialog = query<AeatCertificateDialog>(card, "dashboard-aeat-certificate-dialog");
  await dialog.updateComplete;
  return dialog;
}
async function fill(dialog: AeatCertificateDialog) {
  const file = query<HTMLElementTagNameMap["wt-file-input"]>(dialog, "wt-file-input");
  await file.updateComplete;
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array([1, 2, 3])], "PRIVATE_FILE.p12"));
  const native = query<HTMLInputElement>(file, "input");
  native.files = data.files;
  native.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await dialog.updateComplete;
  const pass = query<HTMLElementTagNameMap["wt-input"]>(dialog, "wt-input");
  await pass.updateComplete;
  await userEvent.fill(query(pass, "input"), "PRIVATE_PASSPHRASE");
  await dialog.updateComplete;
}
async function diagnose(dialog: AeatCertificateDialog) {
  await userEvent.click(query(dialog, "[data-test=certificate-save]"));
  await vi.waitFor(() => expect(query(dialog, "[data-test=editor-diagnose]")).not.toBeNull());
  await userEvent.click(query(dialog, "[data-test=editor-diagnose]"));
  await dialog.updateComplete;
  const panel = query<HTMLElementTagNameMap["dashboard-aeat-certificate-diagnosis"]>(
    dialog,
    "dashboard-aeat-certificate-diagnosis",
  );
  await panel.updateComplete;
  return panel;
}
it("keeps the unsaved editor across diagnosis Stop, suspends Save/Enter, and saves separately", async () => {
  const dialog = await editor();
  await fill(dialog);
  const panel = await diagnose(dialog);
  expect(panel.source).toBe("candidate");
  expect(panel.candidate?.passphrase).toBe("PRIVATE_PASSPHRASE");
  expect(
    query<HTMLElementTagNameMap["wt-button"]>(dialog, "[data-test=certificate-save]").disabled,
  ).toBe(true);
  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await dialog.updateComplete;
  expect(
    requests.filter((r) => r.path === "/management-api/fiscal-certificate" && r.body),
  ).toHaveLength(1);
  await userEvent.click(query(panel, "[data-test=diagnosis-confirm]"));
  await userEvent.click(query(panel, "[data-test=diagnosis-inspect]"));
  await vi.waitFor(() =>
    expect(
      query<HTMLElementTagNameMap["wt-button"]>(panel, "[data-test=diagnosis-check]").disabled,
    ).toBe(false),
  );
  await userEvent.click(query(panel, "[data-test=diagnosis-check]"));
  await vi.waitFor(() => expect(panel.shadowRoot!.textContent).toContain("This query completed"));
  const closed = new Promise<void>((resolve) =>
    panel.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.click(query(panel, "[data-test=diagnosis-stop]"));
  await closed;
  await dialog.updateComplete;
  expect(query<HTMLElementTagNameMap["wt-input"]>(dialog, "wt-input").value).toBe(
    "PRIVATE_PASSPHRASE",
  );
  expect(
    query<HTMLElementTagNameMap["wt-file-input"]>(dialog, "wt-file-input").files[0]!.name,
  ).toBe("PRIVATE_FILE.p12");
  const installs = requests.filter(
    (r) => r.path === "/management-api/fiscal-certificate" && r.body,
  );
  expect(installs).toHaveLength(1);
  await userEvent.click(query(dialog, "[data-test=certificate-save]"));
  await vi.waitFor(() =>
    expect(
      requests.filter((r) => r.path === "/management-api/fiscal-certificate" && r.body),
    ).toHaveLength(2),
  );
  expect(requests.at(-1)!.body).toEqual({
    pfxBase64: "AQID",
    passphrase: "PRIVATE_PASSPHRASE",
    certKind: "sello",
    expectedRevision: "revision-1",
  });
  const proceed = vi.fn();
  const leaving = app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  await vi.waitFor(() =>
    expect(query<HTMLElementTagNameMap["wt-unsaved-changes"]>(app, "wt-unsaved-changes").open).toBe(
      true,
    ),
  );
  expect(proceed).not.toHaveBeenCalled();
  query(app, "wt-unsaved-changes").dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "keep" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await leaving).toBe("kept");
});
it("authentication epoch discards native editor secrets and its old draft snapshot", async () => {
  const dialog = await editor();
  await fill(dialog);
  const panel = await diagnose(dialog);
  auth.change();
  await dialog.updateComplete;
  await panel.updateComplete;
  const file = query<HTMLElementTagNameMap["wt-file-input"]>(dialog, "wt-file-input");
  const pass = query<HTMLElementTagNameMap["wt-input"]>(dialog, "wt-input");
  await file.updateComplete;
  await pass.updateComplete;
  expect(file.files).toEqual([]);
  expect(query<HTMLInputElement>(file, "input").files!.length).toBe(0);
  expect(pass.value).toBe("");
  expect(query<HTMLInputElement>(pass, "input").value).toBe("");
  expect(panel.candidate).toBeNull();
  expect(
    await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} }),
  ).toBe("proceeded");
  expect(requests.filter((r) => r.path.endsWith("diagnose"))).toHaveLength(0);
});

it.each(["account", "detach"] as const)(
  "a delayed editor file read never installs after %s",
  async (mode) => {
    const dialog = await editor();
    await fill(dialog);
    const file = query<HTMLElementTagNameMap["wt-file-input"]>(dialog, "wt-file-input").files[0]!;
    const bytes = held<ArrayBuffer>();
    vi.spyOn(file, "arrayBuffer").mockReturnValue(bytes.promise);
    await userEvent.click(query(dialog, "[data-test=certificate-save]"));
    if (mode === "account") auth.change();
    else dialog.remove();
    bytes.resolve(new Uint8Array([1, 2, 3]).buffer);
    await Promise.resolve();
    await Promise.resolve();
    await dialog.updateComplete;
    expect(
      requests.filter((r) => r.path === "/management-api/fiscal-certificate" && r.body),
    ).toHaveLength(0);
  },
);
