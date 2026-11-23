import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import type { InitialSetupActions } from "@waitron/module/src/setup-contract.js";
import { readRecoveryPackPdf } from "@waitron/recovery-pack";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";

const KEY = "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5";
const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
});
const context = {
  status: "claimed",
  environment: "production",
  venue: {
    legalName: "Olivo SL",
    country: "ES",
    taxId: "B12345674",
    seriesCode: "A",
    fullSeriesCode: "FF",
    correctiveSeriesCode: "R",
    name: "Olivo",
    city: "Madrid",
    fiscalTerritory: "ES-common",
    timeZone: "Europe/Madrid",
  },
};
const input = {
  allocation: {
    installationIdentity: "0CSQW",
    series: [
      { code: "A-0CSQW", purpose: "standard" },
      { code: "FF-0CSQW", purpose: "full" },
      { code: "R-0CSQW", purpose: "corrective" },
      { code: "RF-0CSQW", purpose: "full_corrective" },
    ],
  },
};
const control = (el: LitElement, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${name}]`);
const text = (el: LitElement, name: string) => control(el, name)?.textContent?.trim();

/** Spies the browser's download and new-tab opening, so a test reads what each button hands over. */
function captureHandovers() {
  const downloads: { href: string; name: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download });
  });
  const opened = vi.spyOn(window, "open").mockImplementation(() => null);
  const copied: string[] = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (value: string) => {
    copied.push(value);
  });
  return { downloads, opened, copied };
}

async function mount(locale: "en" | "es" = "en") {
  const kept: unknown[] = [];
  const instant = Date.parse("2026-10-18T12:30:00Z");
  const api: InitialSetupActions = {
    async preparation(value) {
      if ((value as { action: string }).action === "clock-challenge") return { id: "challenge" };
      return {
        id: "comparison",
        clock: {
          usable: ["box", "browser"].map((source) => ({
            source,
            lowerMs: instant,
            upperMs: instant,
          })),
          unavailable: [],
          secondClock: true,
          disagreement: false,
          releaseBlocked: false,
          rangeBlocked: false,
        },
      };
    },
    async candidates() {
      return { kind: "waitron-hour-setup", status: "selected", identity: "0CSQW", input };
    },
    async request() {
      throw new Error("No reselection");
    },
    async importInput() {},
    async enrol() {
      throw new Error("No enrolment");
    },
    async confirm() {
      throw new Error("No activation");
    },
    async stageNodeKey() {
      return {
        stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
        key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
        masterKey: KEY,
        masterKeyName: "2026-11-23 · QZJV",
      };
    },
    async registerRecoveryDocument() {},
    async confirmRecoveryDocument(value) {
      kept.push(value);
    },
  };
  const host = document.createElement("main");
  document.body.append(host);
  hosts.push(host);
  applyTokens(host);
  const parent = FISCAL_SETUP.create({ locale, request: context, api }) as LitElement;
  host.append(parent);
  await parent.updateComplete;
  const el = parent.shadowRoot!.querySelector<LitElement>("vf-first-setup-hour")!;
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull();
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!,
  );
  await expect.poll(() => control(el, "compare")?.disabled).toBe(false);
  await userEvent.click(control(el, "compare")!);
  await expect.poll(() => control(el, "selected-hour")).not.toBeNull();
  return { el, kept };
}

it("a Live setup ends with the Recovery pack step: the key box, then Download, Print and Copy", async () => {
  const { downloads } = captureHandovers();
  const { el } = await mount();
  expect(text(el, "pack-heading")).toBe("Recovery pack");
  expect(text(el, "pack-lead")).toBe(
    "Download, print or copy the master key, then keep it somewhere safe, away from this box.",
  );
  expect(text(el, "pack-warning")).toBe("This is the only time the master key is shown.");
  expect(text(el, "prepare-pdf")).toBe("Download");
  expect(control(el, "kept")).toBeNull();
  await userEvent.click(control(el, "prepare-pdf")!);
  await expect.poll(() => control(el, "master-key")).not.toBeNull();
  expect(text(el, "master-key-name")).toBe("Master key · 2026-11-23 · QZJV");
  expect(text(el, "master-key")).toBe(KEY);
  expect(text(el, "download-pdf")).toBe("Download");
  expect(text(el, "print-pdf")).toBe("Print");
  expect(text(el, "copy-key")).toBe("Copy");
  expect(el.shadowRoot!.querySelector('input[name="setup-pdf-kept"]')).toBeNull();
  expect(downloads).toHaveLength(1);
  expect(downloads[0]!.name).toBe("waitron-recovery-pack-1.pdf");
  const file = await readRecoveryPackPdf(
    new Uint8Array(await (await fetch(downloads[0]!.href)).arrayBuffer()),
  );
  expect(file.masterKey).toBe(KEY);
});

it("Continue is not shown until Download, Print or Copy has been used, and keeps the pack once pressed", async () => {
  captureHandovers();
  const { el, kept } = await mount();
  expect(control(el, "kept")).toBeNull();
  await userEvent.click(control(el, "prepare-pdf")!);
  await expect.poll(() => control(el, "kept")).not.toBeNull();
  expect(text(el, "kept")).toBe("Continue");
  expect(kept).toEqual([]);
  await userEvent.click(control(el, "kept")!);
  await expect.poll(() => kept).toHaveLength(1);
  await expect.poll(() => el.shadowRoot!.textContent).toContain("Recovery pack confirmed.");
});

it("Copy puts the key on the clipboard exactly as printed, and Print opens the pack in a new tab", async () => {
  const { copied, opened, downloads } = captureHandovers();
  const { el } = await mount();
  await userEvent.click(control(el, "prepare-pdf")!);
  await expect.poll(() => control(el, "copy-key")).not.toBeNull();
  expect(control(el, "copied")).toBeNull();
  await userEvent.click(control(el, "copy-key")!);
  await expect.poll(() => text(el, "copied")).toBe("Copied.");
  expect(copied).toEqual(["88DP 74BA YPVB RRM5 XFV2 WPQY B5M5"]);
  await userEvent.click(control(el, "print-pdf")!);
  expect(opened).toHaveBeenCalledWith(downloads[0]!.href, "_blank");
  await userEvent.click(control(el, "download-pdf")!);
  expect(downloads).toHaveLength(2);
  expect(downloads[1]!.href).toBe(downloads[0]!.href);
});

it("shows the Recovery pack step in Spanish", async () => {
  captureHandovers();
  const { el } = await mount("es");
  expect(text(el, "pack-heading")).toBe("Paquete de recuperación");
  expect(text(el, "pack-lead")).toBe(
    "Descarga, imprime o copia la clave maestra y guárdala en un lugar seguro, lejos de este servidor.",
  );
  expect(text(el, "pack-warning")).toBe("Esta es la única vez que se muestra la clave maestra.");
  expect(text(el, "prepare-pdf")).toBe("Descargar");
  await userEvent.click(control(el, "prepare-pdf")!);
  await expect.poll(() => control(el, "master-key")).not.toBeNull();
  expect(text(el, "master-key-name")).toBe("Clave maestra · 2026-11-23 · QZJV");
  expect(text(el, "print-pdf")).toBe("Imprimir");
  expect(text(el, "copy-key")).toBe("Copiar");
  await userEvent.click(control(el, "copy-key")!);
  await expect.poll(() => text(el, "copied")).toBe("Copiada.");
  expect(text(el, "kept")).toBe("Continuar");
});
