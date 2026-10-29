import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "lit";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import { AeatCertificateClient } from "./client.js";
import { AeatCertificateDiagnosis } from "./certificate-diagnosis.js";
import { evidence, held, permission, savedCard } from "../../test/diagnosis-browser-fixtures.js";
import type {
  CertificateDiagnosisRequest,
  CertificateDiagnosisResult,
} from "../certificate-diagnosis-contract.js";
const hosts: HTMLElement[] = [];
let locale = "";
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  setLocale(locale);
  vi.restoreAllMocks();
});
export async function mountDiagnosis(
  over: Partial<AeatCertificateDiagnosis> = {},
  answer: (body: CertificateDiagnosisRequest) => Promise<unknown> = async (body) => evidence(body),
) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const request = vi.fn(async (_path: string, _method: string, body: unknown) =>
    answer(body as CertificateDiagnosisRequest),
  );
  const panel = new AeatCertificateDiagnosis();
  Object.assign(panel, {
    client: new AeatCertificateClient(request as DashboardRequest),
    savedCard,
    permissionContinuation: permission().hook,
    ...over,
  });
  host.append(panel);
  await panel.updateComplete;
  return { panel, request, host };
}
const q = (p: AeatCertificateDiagnosis, s: string) =>
  p.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${s}]`)!;
async function click(p: AeatCertificateDiagnosis, s: string) {
  await userEvent.click(q(p, s));
  await p.updateComplete;
}
it("opening is quiet, shows unread destination, and requires preview before a network check", async () => {
  const { panel, request } = await mountDiagnosis();
  expect(request).not.toHaveBeenCalled();
  expect(q(panel, "diagnosis-inspect").disabled).toBe(true);
  expect(panel.shadowRoot!.textContent).toContain("Not yet read");
  expect(q(panel, "diagnosis-check").disabled).toBe(true);
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() => expect(q(panel, "diagnosis-check").disabled).toBe(false));
  expect(request.mock.calls[0]![2]).toMatchObject({
    source: "installed",
    operation: "inspect",
    expectedRevision: "revision-1",
  });
  expect(panel.shadowRoot!.textContent).toContain("Preproduction");
  await click(panel, "diagnosis-check");
  await vi.waitFor(() => expect(panel.shadowRoot!.textContent).toContain("This query completed"));
  expect(request.mock.calls[1]![2]).toMatchObject({ source: "installed", operation: "check" });
  expect(q(panel, "diagnosis-check").disabled).toBe(false);
});
it.each(["en", "es"])(
  "renders observed HTTP separately from cause and explicit safe copy in %s",
  async (lang) => {
    setLocale(lang);
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { panel } = await mountDiagnosis({}, async (body) =>
      evidence(
        body,
        body.operation === "check" ? { category: "http-response", httpStatus: 403 } : {},
      ),
    );
    await click(panel, "diagnosis-confirm");
    await click(panel, "diagnosis-inspect");
    await vi.waitFor(() => expect(q(panel, "diagnosis-check").disabled).toBe(false));
    await click(panel, "diagnosis-check");
    const wanted =
      lang === "en"
        ? "The check received HTTP 403. The cause is not established. Nothing was changed."
        : "La comprobación recibió HTTP 403. No se ha determinado la causa. No se ha cambiado nada.";
    await vi.waitFor(() => expect(panel.shadowRoot!.textContent).toContain(wanted));
    expect(copy).not.toHaveBeenCalled();
    await click(panel, "diagnosis-copy");
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0]![0]).not.toMatch(/binding|revision|passphrase|PRIVATE/);
    expect(panel.shadowRoot!.textContent).toContain(
      lang === "en"
        ? "Repair is not available in this panel."
        : "La reparación no está disponible en este panel.",
    );
  },
);
it("offers real permission sign-in to a reader, with no request or replay", async () => {
  const auth = permission(["fiscal.view"]);
  const login = held<"signed-in" | "stopped">();
  auth.hook.signIn = vi.fn(() => login.promise);
  const { panel, request } = await mountDiagnosis({
    permissionContinuation: auth.hook,
    readOnly: true,
  });
  await click(panel, "diagnosis-sign-in");
  expect(auth.hook.signIn).toHaveBeenCalledOnce();
  auth.change(["system.manage"]);
  login.resolve("signed-in");
  await panel.updateComplete;
  expect(request).not.toHaveBeenCalled();
  expect(q(panel, "diagnosis-confirm")).not.toBeNull();
  expect(q(panel, "diagnosis-inspect").disabled).toBe(true);
});
it("without a continuation, a reader sees Stop without a fictional sign-in", async () => {
  const { panel, request } = await mountDiagnosis({
    permissionContinuation: undefined,
    readOnly: true,
  });
  expect(q(panel, "diagnosis-sign-in")).toBeNull();
  expect(q(panel, "diagnosis-edit").disabled).toBe(true);
  expect(q(panel, "diagnosis-inspect").disabled).toBe(true);
  expect(q(panel, "diagnosis-stop")).not.toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it("a non-filing box explains the limit and never sends a probe", async () => {
  const { panel, request } = await mountDiagnosis({ savedCard: { ...savedCard, filing: false } });
  expect(panel.shadowRoot!.textContent).toContain("does not send records to AEAT");
  await click(panel, "diagnosis-confirm");
  expect(q(panel, "diagnosis-inspect").disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});
it("transport loss gives no remote evidence and does not reveal exception text", async () => {
  const { panel } = await mountDiagnosis({}, async () => {
    throw new Error("PRIVATE_FAULT_TOKEN");
  });
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() =>
    expect(panel.shadowRoot!.textContent).toContain("The result is unavailable"),
  );
  expect(panel.shadowRoot!.textContent).not.toContain("PRIVATE_FAULT_TOKEN");
  expect(q(panel, "diagnosis-copy")).toBeNull();
});
it("account change clears native candidate controls and old copy/evidence", async () => {
  const auth = permission();
  const file = new File(["PRIVATE_BYTES"], "PRIVATE_FILE.p12");
  const { panel, request } = await mountDiagnosis({
    source: "candidate",
    permissionContinuation: auth.hook,
    candidate: { file, passphrase: "PRIVATE_PASS", certKind: "sello", sourceGeneration: 3 },
  });
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() => expect(q(panel, "diagnosis-copy")).not.toBeNull());
  auth.change();
  await panel.updateComplete;
  expect(panel.candidate).toBeNull();
  const field = panel.shadowRoot!.querySelector("wt-file-input")!;
  await field.updateComplete;
  expect(field.files).toEqual([]);
  expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.files!.length).toBe(0);
  const pass = panel.shadowRoot!.querySelector("wt-input")!;
  await pass.updateComplete;
  expect(pass.value).toBe("");
  expect(pass.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(q(panel, "diagnosis-copy")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(panel.shadowRoot!.textContent).not.toMatch(/PRIVATE_/);
});
it("the actual contribution exposes diagnosis on the reader card without invoking install", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const request = vi.fn(async () => savedCard);
  const auth = permission(["fiscal.view"]);
  const handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
    request: request as DashboardRequest,
    permissionContinuation: auth.hook,
  });
  render(handle.render(true), host);
  const card = host.querySelector("dashboard-aeat-certificate-card")!;
  await vi.waitFor(() =>
    expect(card.shadowRoot?.querySelector("[data-test=certificate-diagnose]")).not.toBeNull(),
  );
  await userEvent.click(card.shadowRoot!.querySelector("[data-test=certificate-diagnose]")!);
  await vi.waitFor(() =>
    expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-diagnosis")).not.toBeNull(),
  );
  const panel = card.shadowRoot!.querySelector("dashboard-aeat-certificate-diagnosis")!;
  expect(panel.permissionContinuation).toBe(auth.hook);
  expect(request).toHaveBeenCalledTimes(1);
});
it("Stop aborts pending transport and detach ignores its late settlement", async () => {
  const wait = held<CertificateDiagnosisResult>();
  const { panel, request } = await mountDiagnosis({}, () => wait.promise);
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  const signal = (
    request.mock.calls[0] as unknown as [string, string, unknown, { signal: AbortSignal }]
  )[3].signal;
  const closed = new Promise<void>((resolve) =>
    panel.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await click(panel, "diagnosis-stop");
  await closed;
  expect(signal.aborted).toBe(true);
  panel.remove();
  wait.resolve(evidence(request.mock.calls[0]![2] as CertificateDiagnosisRequest));
  await Promise.resolve();
  expect(panel.candidate).toBeNull();
});
it("busy Escape closes diagnosis while transport is held", async () => {
  const { panel } = await mountDiagnosis({}, () => new Promise(() => {}));
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  const dialog = panel.shadowRoot!.querySelector("wt-dialog")!;
  let closed = false;
  panel.addEventListener(
    "wt-close",
    () => {
      closed = true;
    },
    { once: true },
  );
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(closed).toBe(true), { timeout: 1000 });
  expect(dialog.open).toBe(false);
});
it("a fresh inspection with no saved record replaces the opening's saved facts", async () => {
  const installed = {
    kind: "sello" as const,
    organisation: null,
    taxId: null,
    taxIdMatches: null,
    issuer: null,
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    daysLeft: 30,
    stage: null,
    installedAt: "2025-01-02T00:00:00.000Z",
    source: "setup" as const,
    installedByName: null,
    lastAcceptedAt: null,
  };
  const { panel } = await mountDiagnosis({ savedCard: { ...savedCard, installed } });
  expect(panel.shadowRoot!.textContent).toContain("2025-01-02T00:00:00.000Z");
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() => expect(q(panel, "diagnosis-copy")).not.toBeNull());
  expect(panel.shadowRoot!.textContent).toContain("No saved installation record.");
  expect(panel.shadowRoot!.textContent).not.toContain("This saved record has not been verified");
  expect(panel.shadowRoot!.textContent).not.toContain("2025-01-02T00:00:00.000Z");
});
it.each([
  "local-finding",
  "name-lookup-failed",
  "connection-refused",
  "deadline-elapsed",
  "connection-closed",
  "tls-protocol-failed",
  "http-response",
  "soap-fault",
  "reply-unparseable",
  "reply-too-large",
  "unknown",
] as const)("%s evidence never stores or copies private input or faults", async (category) => {
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "error")];
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const file = new File(["PRIVATE_BYTES_719"], "PRIVATE_FILENAME_719.p12");
  const { panel, request } = await mountDiagnosis(
    {
      source: "candidate",
      candidate: {
        file,
        passphrase: "PRIVATE_PASSPHRASE_719",
        certKind: "representante",
        sourceGeneration: 0,
      },
    },
    async (body) =>
      evidence(body, {
        category,
        localFinding: category === "local-finding" ? "other_taxpayer" : null,
        kind: "representante",
        endpointLabel: "preproduction-representante",
      }),
  );
  const text = (el: Element): string =>
    [
      el.textContent,
      ...Array.from(el.querySelectorAll("*")).map((child) =>
        child.shadowRoot ? text(child.shadowRoot as unknown as Element) : "",
      ),
    ].join(" ");
  expect(text(panel.shadowRoot as unknown as Element)).not.toMatch(/PRIVATE_/);
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() => expect(q(panel, "diagnosis-copy")).not.toBeNull());
  await click(panel, "diagnosis-copy");
  expect(text(panel.shadowRoot as unknown as Element)).not.toMatch(/PRIVATE_/);
  expect(storage).not.toHaveBeenCalled();
  expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toMatch(/PRIVATE_/);
  expect(copy.mock.calls[0]![0]).not.toMatch(/PRIVATE_|binding|revision|taxId|fingerprint|subject/);
  const body = request.mock.calls[0]![2] as CertificateDiagnosisRequest;
  expect(body).toMatchObject({
    source: "candidate",
    certKind: "representante",
    passphrase: "PRIVATE_PASSPHRASE_719",
  });
  expect(JSON.stringify(body)).not.toContain("PRIVATE_FILENAME_719");
});

it("missing installed material offers the actual replacement editor and no network check", async () => {
  const { panel } = await mountDiagnosis({}, async (body) =>
    evidence(body, {
      category: "local-finding",
      localFinding: "missing",
      kind: null,
      endpointLabel: null,
    }),
  );
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() => expect(q(panel, "diagnosis-copy")).not.toBeNull());
  expect(q(panel, "diagnosis-check").disabled).toBe(true);
  expect(q(panel, "diagnosis-edit").textContent).toContain("Replace certificate");
});
it("native source/file/passphrase/type edits invalidate evidence without substituting installed material", async () => {
  const { panel, request } = await mountDiagnosis();
  const source =
    panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=diagnosis-source]",
    )!;
  await source.updateComplete;
  await userEvent.click(source.shadowRoot!.querySelector(".trigger")!);
  await userEvent.keyboard("{End}{Enter}");
  await panel.updateComplete;
  expect(panel.source).toBe("candidate");
  const picker =
    panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-file-input"]>("wt-file-input")!;
  await picker.updateComplete;
  const setFile = async (file: File | null) => {
    const input = picker.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    const data = new DataTransfer();
    if (file) data.items.add(file);
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
  };
  const file = new File([new Uint8Array([1, 2, 3])], "PRIVATE_FILE.p12");
  await setFile(file);
  const pass = panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!;
  await pass.updateComplete;
  await userEvent.fill(pass.shadowRoot!.querySelector("input")!, "PRIVATE_PASS");
  await panel.updateComplete;
  const kind = panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "[name=diagnosis-certificate-kind]",
  )!;
  await kind.updateComplete;
  await userEvent.click(kind.shadowRoot!.querySelector(".trigger")!);
  await userEvent.keyboard("{End}{Enter}");
  await panel.updateComplete;
  expect(panel.candidate?.certKind).toBe("representante");
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() => expect(q(panel, "diagnosis-copy")).not.toBeNull());
  expect(request.mock.calls[0]![2]).toMatchObject({
    source: "candidate",
    pfxBase64: "AQID",
    passphrase: "PRIVATE_PASS",
    certKind: "representante",
  });
  await userEvent.fill(pass.shadowRoot!.querySelector("input")!, "PRIVATE_PASS_CHANGED");
  await panel.updateComplete;
  expect(q(panel, "diagnosis-copy")).toBeNull();
  expect(q(panel, "diagnosis-inspect").disabled).toBe(true);
  expect(q(panel, "diagnosis-check").disabled).toBe(true);
  const generation = panel.candidate!.sourceGeneration;
  await userEvent.fill(pass.shadowRoot!.querySelector("input")!, "PRIVATE_PASS");
  await panel.updateComplete;
  expect(panel.candidate!.sourceGeneration).toBeGreaterThan(generation);
  await setFile(null);
  expect(panel.candidate).toBeNull();
  await click(panel, "diagnosis-confirm");
  expect(q(panel, "diagnosis-inspect").disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
it.each(["stopped", "refused"])(
  "a %s permission continuation never replays or keeps return intent",
  async (mode) => {
    const auth = permission(["fiscal.view"]);
    auth.hook.signIn = vi.fn(async () => {
      if (mode === "refused") throw new Error("PRIVATE_AUTH_ERROR");
      return "stopped" as const;
    });
    const { panel, request } = await mountDiagnosis({
      readOnly: true,
      permissionContinuation: auth.hook,
    });
    await click(panel, "diagnosis-sign-in");
    await vi.waitFor(() => expect(auth.hook.signIn).toHaveBeenCalledTimes(1));
    await panel.updateComplete;
    expect(request).not.toHaveBeenCalled();
    expect(panel.shadowRoot!.textContent).not.toContain("PRIVATE_AUTH_ERROR");
    expect(q(panel, "diagnosis-inspect").disabled).toBe(true);
  },
);
it("Stop aborts a held sign-in and another click does not submit twice", async () => {
  const auth = permission(["fiscal.view"]);
  const wait = held<"signed-in" | "stopped">();
  auth.hook.signIn = vi.fn(() => wait.promise);
  const { panel, request } = await mountDiagnosis({ permissionContinuation: auth.hook });
  await click(panel, "diagnosis-sign-in");
  await click(panel, "diagnosis-sign-in");
  expect(auth.hook.signIn).toHaveBeenCalledTimes(1);
  const args = vi.mocked(auth.hook.signIn).mock.calls[0]![0];
  const closed = new Promise<void>((resolve) =>
    panel.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await click(panel, "diagnosis-stop");
  await closed;
  expect(args.signal.aborted).toBe(true);
  panel.remove();
  wait.resolve("stopped");
  await Promise.resolve();
  expect(request).not.toHaveBeenCalled();
});
it.each(["success", "failure"])(
  "late clipboard %s cannot repaint after an account change",
  async (mode) => {
    const wait = held<void>();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockReturnValue(wait.promise);
    const auth = permission();
    const { panel } = await mountDiagnosis({ permissionContinuation: auth.hook });
    await click(panel, "diagnosis-confirm");
    await click(panel, "diagnosis-inspect");
    await vi.waitFor(() => expect(q(panel, "diagnosis-copy")).not.toBeNull());
    const stale = q(panel, "diagnosis-copy");
    await click(panel, "diagnosis-copy");
    auth.change();
    await panel.updateComplete;
    if (mode === "success") wait.resolve();
    else wait.reject(new Error("PRIVATE_CLIPBOARD"));
    await Promise.resolve();
    await panel.updateComplete;
    expect(panel.shadowRoot!.textContent).not.toMatch(
      /Evidence copied|PRIVATE_CLIPBOARD|could not copy/,
    );
    stale.click();
    expect(copy).toHaveBeenCalledTimes(1);
  },
);
it("clipboard refusal stays local, and language change rewords existing evidence without another request", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("PRIVATE_COPY_FAILURE"));
  const { panel, request } = await mountDiagnosis({}, async (body) =>
    evidence(body, {
      saved: { kind: "sello", installedAt: "2026-10-01T00:00:00.000Z" },
      association: "verified",
    }),
  );
  await click(panel, "diagnosis-confirm");
  await click(panel, "diagnosis-inspect");
  await vi.waitFor(() => expect(q(panel, "diagnosis-copy")).not.toBeNull());
  expect(panel.shadowRoot!.textContent).toContain("matches the saved installation");
  await click(panel, "diagnosis-copy");
  await vi.waitFor(() =>
    expect(panel.shadowRoot!.textContent).toContain("The browser could not copy"),
  );
  setLocale("es");
  await panel.updateComplete;
  expect(panel.shadowRoot!.textContent).toContain("Observado");
  expect(panel.shadowRoot!.textContent).not.toContain("PRIVATE_COPY_FAILURE");
  expect(request).toHaveBeenCalledTimes(1);
  const closed = new Promise<void>((resolve) =>
    panel.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await click(panel, "diagnosis-edit");
  await closed;
});
