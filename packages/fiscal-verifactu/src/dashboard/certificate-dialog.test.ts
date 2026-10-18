import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "lit";
import {
  currentLocale,
  registerCodeMessages,
  setLocale,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { CertificateCardView, InstallAnswerView, InstallBody } from "./client.js";
import type { AeatCertificateCard } from "./certificate-card.js";
import type { AeatCertificateDialog } from "./certificate-dialog.js";

// The dashboard host registers this code's sentence; a module's suite stands in for it.
const CONNECTION_FAILED =
  "This browser could not connect to Waitron. Check your connection and try again.";
registerCodeMessages({ "connection.failed": { en: CONNECTION_FAILED, es: CONNECTION_FAILED } });

const FIX = "Correct the highlighted fields to continue.";

function view(over: Partial<CertificateCardView> = {}): CertificateCardView {
  return {
    filing: true,
    revision: "rev-1",
    timeZone: "Europe/Madrid",
    installed: {
      kind: "representante",
      organisation: "BAR LUCÍA S.L.",
      taxId: "B12345678",
      taxIdMatches: true,
      issuer: "AC Representación (FNMT-RCM)",
      validFrom: "2025-10-03T08:00:00.000Z",
      validUntil: "2027-10-03T08:00:00.000Z",
      daysLeft: 350,
      stage: null,
      installedAt: "2025-11-14T09:12:00.000Z",
      source: "setup",
      installedByName: null,
      lastAcceptedAt: null,
    },
    ...over,
  };
}

type Reads = Array<() => Promise<CertificateCardView>>;
type Settle = { resolve(answer: InstallAnswerView): void; reject(reason: unknown): void };

const hosts: HTMLElement[] = [];
let locale = "";

beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  for (const h of hosts.splice(0)) {
    render(null, h);
    h.remove();
  }
  setLocale(locale);
});

async function open(options: {
  reads?: Reads;
  install?: (body: InstallBody) => Promise<InstallAnswerView>;
}) {
  const reads = options.reads ?? [async () => view()];
  const install = vi.fn(
    options.install ?? (async () => ({ outcome: "installed", reason: "installed" }) as const),
  );
  let readCount = 0;
  const request = vi.fn((_path: string, method: string, body?: unknown) => {
    if (method === "GET") {
      const read = reads[Math.min(readCount, reads.length - 1)]!;
      readCount += 1;
      return read();
    }
    return install(body as InstallBody);
  });
  const handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
    request: request as unknown as DashboardRequest,
  });
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(handle.render(false), host);
  const card = host.querySelector("dashboard-aeat-certificate-card") as AeatCertificateCard;
  await vi.waitFor(() =>
    expect(card.shadowRoot?.querySelector("[data-test=certificate-action]")).not.toBeNull(),
  );
  await userEvent.click(card.shadowRoot!.querySelector("[data-test=certificate-action]")!);
  await vi.waitFor(() =>
    expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).not.toBeNull(),
  );
  const dialog = card.shadowRoot!.querySelector(
    "dashboard-aeat-certificate-dialog",
  ) as AeatCertificateDialog;
  await dialog.updateComplete;
  return { card, dialog, install, request, reads: () => readCount };
}

const q = <T extends Element = HTMLElement>(dialog: AeatCertificateDialog, selector: string) =>
  dialog.shadowRoot!.querySelector<T>(selector)!;
const fileField = (d: AeatCertificateDialog) =>
  q<HTMLElementTagNameMap["wt-file-input"]>(d, "wt-file-input");
const passField = (d: AeatCertificateDialog) => q<HTMLElementTagNameMap["wt-input"]>(d, "wt-input");
const kindField = (d: AeatCertificateDialog) =>
  q<HTMLElementTagNameMap["wt-combobox"]>(d, "wt-combobox");
const actions = (d: AeatCertificateDialog) =>
  q<HTMLElementTagNameMap["wt-form-actions"]>(d, "wt-form-actions");
const save = (d: AeatCertificateDialog) =>
  q<HTMLElementTagNameMap["wt-button"]>(d, "[data-test=certificate-save]");

const BYTES = new Uint8Array([0x30, 0x82, 0x0d, 0xfb, 0x02, 0x01, 0x03, 0xff, 0x00, 0x7f]);
const BYTES_BASE64 = btoa(String.fromCharCode(...BYTES));

async function choose(dialog: AeatCertificateDialog, file: File) {
  const input = fileField(dialog).shadowRoot!.querySelector<HTMLInputElement>("input")!;
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await dialog.updateComplete;
}

const certificate = () => new File([BYTES], "bar-lucia-2026.p12");

async function type(dialog: AeatCertificateDialog, value: string) {
  passField(dialog).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await dialog.updateComplete;
}

async function press(dialog: AeatCertificateDialog) {
  await userEvent.click(save(dialog));
  await dialog.updateComplete;
}

async function filled(dialog: AeatCertificateDialog) {
  await choose(dialog, certificate());
  await type(dialog, " cert pass 9 ");
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function closed(dialog: AeatCertificateDialog): Promise<Event> {
  return new Promise((resolve) => dialog.addEventListener("wt-close", resolve, { once: true }));
}

describe("dashboard-aeat-certificate-dialog", () => {
  it("opens from the card with the three required fields, the type pre-set, and the guides under them", async () => {
    const { dialog } = await open({});
    const wtDialog = q(dialog, "wt-dialog");
    expect(wtDialog.getAttribute("heading")).toBe("Replace AEAT certificate");
    expect(text(dialog.shadowRoot!.querySelector("[data-test=certificate-intro]"))).toBe(
      "Waitron checks the new certificate with AEAT before it replaces the current one. Sales are not affected.",
    );
    const file = fileField(dialog);
    expect(file.getAttribute("name")).toBe("certificate-file");
    expect(file.accept).toBe(".pfx,.p12");
    expect(file.label).toBe("Certificate file (.pfx or .p12)");
    expect(file.required).toBe(true);
    const pass = passField(dialog);
    expect(pass.getAttribute("name")).toBe("certificate-passphrase");
    expect(pass.type).toBe("password");
    expect(pass.required).toBe(true);
    const kind = kindField(dialog);
    expect(kind.getAttribute("name")).toBe("certificate-kind");
    expect(kind.required).toBe(true);
    expect(kind.value).toBe("representante");
    expect(kind.options).toEqual([
      { value: "sello", label: "Company seal (sello)" },
      { value: "representante", label: "Representative (representante)" },
    ]);
    const guides = dialog.shadowRoot!.querySelector("wt-disclosure")!;
    expect(guides.querySelectorAll("[data-test=export-guide]")).toHaveLength(3);
    expect(kind.compareDocumentPosition(guides) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pre-sets the type to sello when no certificate is recorded", async () => {
    const { dialog } = await open({
      reads: [async () => view({ revision: null, installed: null })],
    });
    expect(kindField(dialog).value).toBe("sello");
  });

  it("keeps Save quiet and disabled until a file is chosen", async () => {
    const { dialog, install } = await open({});
    expect(save(dialog).disabled).toBe(true);
    expect(save(dialog).variant).toBe("secondary");
    expect(text(save(dialog))).toBe("Save");
    await type(dialog, "secret");
    kindField(dialog).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "sello" }, bubbles: true, composed: true }),
    );
    await dialog.updateComplete;
    expect(save(dialog).disabled).toBe(true);
    expect(save(dialog).variant).toBe("secondary");
    await choose(dialog, certificate());
    expect(save(dialog).disabled).toBe(false);
    expect(save(dialog).variant).toBe("primary");
    expect(install).not.toHaveBeenCalled();
  });

  it("marks an empty passphrase and the bottom on Save, sends nothing, and re-checks on every change", async () => {
    const { dialog, install } = await open({});
    await choose(dialog, certificate());
    await press(dialog);
    expect(passField(dialog).error).toBe("Enter the certificate passphrase.");
    expect(actions(dialog).error).toBe(FIX);
    expect(save(dialog).disabled).toBe(true);
    expect(install).not.toHaveBeenCalled();
    await type(dialog, "x");
    expect(passField(dialog).error).toBe("");
    expect(actions(dialog).error).toBe("");
    expect(save(dialog).disabled).toBe(false);
    await type(dialog, "");
    expect(passField(dialog).error).toBe("Enter the certificate passphrase.");
    expect(actions(dialog).error).toBe(FIX);
  });

  it("marks a file over 100 KiB under the file without a request, and sends one of exactly 100 KiB", async () => {
    const { dialog, install } = await open({
      install: async () => ({ outcome: "refused", reason: "unreadable", field: "file" }),
    });
    await choose(dialog, new File([new Uint8Array(100 * 1024 + 1)], "big.p12"));
    await type(dialog, "secret");
    await press(dialog);
    expect(fileField(dialog).error).toBe("This file is too large to be a certificate.");
    expect(actions(dialog).error).toBe(FIX);
    expect(install).not.toHaveBeenCalled();
    await choose(dialog, new File([new Uint8Array(100 * 1024)], "limit.p12"));
    expect(fileField(dialog).error).toBe("");
    await press(dialog);
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
  });

  it("sends the file's bytes, the passphrase exactly as typed, the type and the card's revision", async () => {
    const { dialog, install } = await open({
      install: async () => ({ outcome: "refused", reason: "same", field: "file" }),
    });
    await filled(dialog);
    kindField(dialog).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "representante" },
        bubbles: true,
        composed: true,
      }),
    );
    await press(dialog);
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(install.mock.calls[0]![0]).toEqual({
      pfxBase64: BYTES_BASE64,
      passphrase: " cert pass 9 ",
      certKind: "representante",
      expectedRevision: "rev-1",
    });
  });

  it("sends a null revision when nothing was installed, and the chosen type", async () => {
    const { dialog, install } = await open({
      reads: [async () => view({ revision: null, installed: null })],
      install: async () => ({ outcome: "refused", reason: "same", field: "file" }),
    });
    await filled(dialog);
    await press(dialog);
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(install.mock.calls[0]![0]).toMatchObject({ certKind: "sello", expectedRevision: null });
  });

  it("reads Checking with AEAT… and is disabled while the check runs", async () => {
    let settle!: (answer: InstallAnswerView) => void;
    const { dialog, install } = await open({
      install: () => new Promise((resolve) => (settle = resolve)),
    });
    await filled(dialog);
    await press(dialog);
    await vi.waitFor(() => expect(text(save(dialog))).toBe("Checking with AEAT…"));
    expect(save(dialog).disabled).toBe(true);
    expect(q<HTMLElementTagNameMap["wt-dialog"]>(dialog, "wt-dialog").dismissible).toBe(false);
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    settle({ outcome: "refused", reason: "same", field: "file" });
    await vi.waitFor(() => expect(text(save(dialog))).toBe("Save"));
    expect(save(dialog).disabled).toBe(false);
  });

  type Case = [string, InstallAnswerView, "file" | "passphrase" | "bottom", string];
  const cases: Case[] = [
    [
      "E2 wrong passphrase",
      { outcome: "refused", reason: "passphrase_wrong", field: "passphrase" },
      "passphrase",
      "This passphrase does not open the file.",
    ],
    [
      "E3 another taxpayer",
      {
        outcome: "refused",
        reason: "other_taxpayer",
        field: "file",
        details: { nif: "B87654321", taxpayerNif: "B12345678" },
      },
      "file",
      "This certificate is for tax ID B87654321, not B12345678.",
    ],
    [
      "E4 expired",
      { outcome: "refused", reason: "expired", field: "file", details: { date: "2026-10-01" } },
      "file",
      "This certificate expired on 1 Oct 2026.",
    ],
    [
      "not yet valid",
      {
        outcome: "refused",
        reason: "not_yet_valid",
        field: "file",
        details: { date: "2026-11-03" },
      },
      "file",
      "This certificate is valid only from 3 Nov 2026.",
    ],
    [
      "E6 old encryption",
      { outcome: "refused", reason: "old_encryption", field: "file" },
      "file",
      "This file uses an old encryption. Export it again with current encryption (AES).",
    ],
    [
      "unreadable",
      { outcome: "refused", reason: "unreadable", field: "file" },
      "file",
      "Waitron cannot read this file. Choose the .pfx or .p12 file.",
    ],
    [
      "no private key",
      { outcome: "refused", reason: "no_private_key", field: "file" },
      "file",
      "This file has no private key. Export it again with the private key.",
    ],
    [
      "the same certificate",
      { outcome: "refused", reason: "same", field: "file" },
      "file",
      "This certificate is already installed.",
    ],
    [
      "too large",
      { outcome: "refused", reason: "too_large", field: "file" },
      "file",
      "This file is too large to be a certificate.",
    ],
    [
      "unreachable",
      { outcome: "refused", reason: "unreachable" },
      "bottom",
      "Waitron could not reach AEAT. The current certificate is unchanged. Check the internet connection, then try again.",
    ],
    [
      "E5 closed",
      { outcome: "refused", reason: "closed" },
      "bottom",
      "AEAT closed the connection, so it may have refused this certificate. The current certificate is unchanged. Check the certificate type, then try again.",
    ],
    [
      "a SOAP fault",
      {
        outcome: "refused",
        reason: "aeat_fault",
        details: { faultCode: "env:Client", faultReason: "Codigo[4102]." },
      },
      "bottom",
      "AEAT answered with an error: env:Client Codigo[4102].. The current certificate is unchanged.",
    ],
    [
      "an HTTP error",
      { outcome: "refused", reason: "aeat_http", details: { status: 503 } },
      "bottom",
      "AEAT answered with HTTP error 503. The current certificate is unchanged. Try again later.",
    ],
    [
      "anything else",
      { outcome: "refused", reason: "check_failed" },
      "bottom",
      "The check with AEAT failed for an unexpected reason. The current certificate is unchanged. Try again; if it fails again, contact support.",
    ],
    [
      "a reason this copy does not know",
      { outcome: "refused", reason: "something_new" },
      "bottom",
      "The check with AEAT failed for an unexpected reason. The current certificate is unchanged. Try again; if it fails again, contact support.",
    ],
  ];

  it.each(cases)(
    "%s: puts its sentence where it belongs and leaves Save enabled",
    async (_name, answer, place, sentence) => {
      const { dialog } = await open({ install: async () => answer });
      await filled(dialog);
      await press(dialog);
      await vi.waitFor(() =>
        expect(
          place === "file"
            ? fileField(dialog).error
            : place === "passphrase"
              ? passField(dialog).error
              : actions(dialog).error,
        ).toBe(sentence),
      );
      if (place !== "file") expect(fileField(dialog).error).toBe("");
      if (place !== "passphrase") expect(passField(dialog).error).toBe("");
      if (place !== "bottom") expect(actions(dialog).error).toBe(FIX);
      expect(save(dialog).disabled).toBe(false);
      expect(save(dialog).variant).toBe("primary");
    },
  );

  it("keeps a field's refusal until that field changes, and a bottom one until Save is pressed again", async () => {
    const answers: InstallAnswerView[] = [
      { outcome: "refused", reason: "passphrase_wrong", field: "passphrase" },
      { outcome: "refused", reason: "closed" },
      { outcome: "refused", reason: "same", field: "file" },
    ];
    const { dialog } = await open({ install: async () => answers.shift()! });
    await filled(dialog);
    await press(dialog);
    await vi.waitFor(() =>
      expect(passField(dialog).error).toBe("This passphrase does not open the file."),
    );
    await choose(dialog, new File([BYTES], "other.p12"));
    expect(passField(dialog).error).toBe("This passphrase does not open the file.");
    await type(dialog, "cert pass 9");
    expect(passField(dialog).error).toBe("");
    expect(actions(dialog).error).toBe("");
    await press(dialog);
    await vi.waitFor(() => expect(actions(dialog).error).toContain("AEAT closed the connection"));
    await type(dialog, "cert pass 10");
    expect(actions(dialog).error).toContain("AEAT closed the connection");
    await press(dialog);
    await vi.waitFor(() =>
      expect(fileField(dialog).error).toBe("This certificate is already installed."),
    );
    expect(actions(dialog).error).toBe(FIX);
    await choose(dialog, certificate());
    expect(fileField(dialog).error).toBe("");
    expect(actions(dialog).error).toBe("");
  });

  const errors: Array<[string, "file" | "bottom", string]> = [
    [
      "fiscal.certificate_changed",
      "bottom",
      "Someone else installed a certificate meanwhile. Close this window to see it.",
    ],
    ["fiscal.certificate_too_large", "file", "This file is too large to be a certificate."],
    [
      "fiscal.certificate_not_used",
      "bottom",
      "This box does not send records to AEAT, so it needs no certificate.",
    ],
    [
      "fiscal.certificate_request_invalid",
      "bottom",
      "Waitron could not read this request. Choose the file again and try again.",
    ],
    ["connection.failed", "bottom", CONNECTION_FAILED],
  ];

  it.each(errors)(
    "a request refused with %s says so and leaves Save enabled",
    async (code, place, sentence) => {
      const { dialog } = await open({
        install: async () => Promise.reject({ code, params: {} }),
      });
      await filled(dialog);
      await press(dialog);
      if (place === "file") {
        await vi.waitFor(() => expect(fileField(dialog).error).toBe(sentence));
        expect(actions(dialog).error).toBe(FIX);
      } else {
        await vi.waitFor(() => expect(actions(dialog).error).toBe(sentence));
        expect(fileField(dialog).error).toBe("");
      }
      expect(save(dialog).disabled).toBe(false);
    },
  );

  it("says the request errors in Spanish", async () => {
    setLocale("es");
    const { dialog } = await open({
      install: async () => Promise.reject({ code: "fiscal.certificate_not_used" }),
    });
    await filled(dialog);
    await press(dialog);
    await vi.waitFor(() =>
      expect(actions(dialog).error).toBe(
        "Este equipo no envía registros a la AEAT, así que no necesita certificado.",
      ),
    );
    expect(text(save(dialog))).toBe("Guardar");
  });

  it("on installed closes, and the card shows the installed line and reads again", async () => {
    const renewed = view({ revision: "rev-2" });
    const { card, dialog, reads } = await open({
      reads: [async () => view(), async () => renewed],
      install: async () => ({
        outcome: "installed",
        reason: "installed",
        details: { checkedAt: "2026-10-18T11:05:00.000Z" },
      }),
    });
    await filled(dialog);
    const close = closed(dialog);
    await press(dialog);
    await close;
    await vi.waitFor(() => expect(reads()).toBe(2));
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).toBeNull();
    expect(text(card.shadowRoot!.querySelector("[data-test=certificate-installed]"))).toBe(
      "Installed. AEAT answered a check with this certificate at 13:05. The next filing will use it.",
    );
  });

  it("on installed then a failed re-read, the card shows a load failure and the dialog stays closed", async () => {
    const { card, dialog } = await open({
      reads: [async () => view(), async () => Promise.reject({ code: "connection.failed" })],
      install: async () => ({
        outcome: "installed",
        reason: "installed",
        details: { checkedAt: "2026-10-18T11:05:00.000Z" },
      }),
    });
    await filled(dialog);
    const close = closed(dialog);
    await press(dialog);
    await close;
    await vi.waitFor(() =>
      expect(text(card.shadowRoot!.querySelector("[data-test=certificate-load-error]"))).toBe(
        CONNECTION_FAILED,
      ),
    );
    expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).toBeNull();
    expect(card.shadowRoot!.querySelector("[data-test=certificate-installed]")).toBeNull();
  });

  it("closes on Cancel without a request, and opens again with an empty form", async () => {
    const { card, dialog, install } = await open({});
    const close = closed(dialog);
    await userEvent.click(q(dialog, "[data-test=certificate-cancel]"));
    await close;
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).toBeNull();
    expect(install).not.toHaveBeenCalled();
    await userEvent.click(card.shadowRoot!.querySelector("[data-test=certificate-action]")!);
    await vi.waitFor(() =>
      expect(card.shadowRoot!.querySelector("dashboard-aeat-certificate-dialog")).not.toBeNull(),
    );
    const again = card.shadowRoot!.querySelector(
      "dashboard-aeat-certificate-dialog",
    ) as AeatCertificateDialog;
    await again.updateComplete;
    expect(passField(again).value).toBe("");
    expect(save(again).disabled).toBe(true);
  });

  it("sends nothing when its disabled Save is clicked", async () => {
    const { dialog, install } = await open({});
    save(dialog).click();
    await choose(dialog, certificate());
    await press(dialog);
    expect(passField(dialog).error).toBe("Enter the certificate passphrase.");
    save(dialog).click();
    await dialog.updateComplete;
    expect(install).not.toHaveBeenCalled();
  });

  it("goes back to a quiet, disabled Save when the chosen file is taken away", async () => {
    const { dialog } = await open({});
    await choose(dialog, certificate());
    expect(save(dialog).disabled).toBe(false);
    const input = fileField(dialog).shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.files = new DataTransfer().files;
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await dialog.updateComplete;
    expect(save(dialog).disabled).toBe(true);
    expect(save(dialog).variant).toBe("secondary");
  });

  it.each([
    [
      "answers",
      (settle: Settle) =>
        settle.resolve({
          outcome: "installed",
          reason: "installed",
          details: { checkedAt: "2026-10-18T11:05:00.000Z" },
        }),
    ],
    ["fails", (settle: Settle) => settle.reject({ code: "connection.failed" })],
  ])("drops a request that %s after the dialog left the page", async (_name, finish) => {
    let settle!: Settle;
    const { card, dialog, install } = await open({
      install: () => new Promise((resolve, reject) => (settle = { resolve, reject })),
    });
    await filled(dialog);
    await press(dialog);
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    const installed = vi.fn();
    dialog.addEventListener("aeat-certificate-installed", installed);
    dialog.remove();
    finish(settle);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(installed).not.toHaveBeenCalled();
    expect(card.shadowRoot!.querySelector("[data-test=certificate-installed]")).toBeNull();
  });

  it("saves on Enter in the passphrase field", async () => {
    const { dialog, install } = await open({
      install: async () => ({ outcome: "refused", reason: "same", field: "file" }),
    });
    await filled(dialog);
    const inner = passField(dialog).shadowRoot!.querySelector("input")!;
    inner.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
  });

  it("shows and hides the passphrase", async () => {
    const { dialog } = await open({});
    const reveal = q<HTMLElementTagNameMap["wt-button"]>(dialog, "[data-test=reveal]");
    expect(reveal.slot).toBe("end");
    expect(reveal.getAttribute("aria-label")).toBe("Show certificate passphrase");
    await userEvent.click(reveal);
    await dialog.updateComplete;
    expect(passField(dialog).type).toBe("text");
    expect(reveal.getAttribute("aria-label")).toBe("Hide certificate passphrase");
    await userEvent.click(reveal);
    await dialog.updateComplete;
    expect(passField(dialog).type).toBe("password");
  });

  it("re-renders its words and the guides on a locale switch", async () => {
    const { dialog } = await open({});
    setLocale("es");
    await dialog.updateComplete;
    expect(q(dialog, "wt-dialog").getAttribute("heading")).toBe(
      "Sustituir el certificado de la AEAT",
    );
    expect(passField(dialog).label).toBe("Contraseña del certificado");
    expect(dialog.shadowRoot!.querySelector("wt-disclosure")!.getAttribute("heading")).not.toBe(
      "Get your certificate file",
    );
  });
});
