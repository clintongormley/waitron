import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import type {
  InitialSetupActions,
  InitialSetupNodeKey,
} from "@waitron/module/src/setup-contract.js";
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
/** Finds the part named `name` on the step, or inside its master key box. */
const control = (el: LitElement, name: string) => {
  const selector = `[data-test=${name}]`;
  return (
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(selector) ??
    el
      .shadowRoot!.querySelector("wt-master-key-box")
      ?.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(selector) ??
    null
  );
};
const text = (el: LitElement, name: string) => control(el, name)?.textContent?.trim();

/** Spies the browser's download and new-tab opening, so a test reads what each button hands over. */
function captureHandovers() {
  const downloads: { href: string; name: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download });
  });
  const opened = vi.spyOn(window, "open").mockImplementation(() => ({}) as Window);
  const copied: string[] = [];
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (value: string) => {
    copied.push(value);
  });
  return { downloads, opened, copied };
}

const staged = (masterKey = KEY): InitialSetupNodeKey => ({
  stage: { stageId: "stage", nodeId: "node", name: "Olivo key" },
  key: { nodeId: "node", name: "Olivo key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
  masterKey,
  masterKeyName: "2026-11-23 · QZJV",
});
const NEW_KEY = "2SZ5 ZYJ9 UN95 RXKV NF7B N8VU GYU4";

async function mount(
  locale: "en" | "es" = "en",
  stage: () => Promise<InitialSetupNodeKey> = async () => staged(),
) {
  const kept: unknown[] = [];
  const reissues: unknown[] = [];
  const instant = Date.parse("2026-10-18T12:30:00Z");
  const api: InitialSetupActions & { reissueNodeKey: () => Promise<InitialSetupNodeKey> } = {
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
    stageNodeKey: stage,
    async reissueNodeKey() {
      reissues.push(true);
      return staged(NEW_KEY);
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
  return { el, host, kept, reissues };
}

async function showKey(el: LitElement) {
  await userEvent.click(control(el, "prepare-pdf")!);
  await expect.poll(() => control(el, "master-key")).not.toBeNull();
}

it("a Live setup ends with the Recovery pack step: after the password, the key box with Download, Print and Copy, and nothing downloaded by itself", async () => {
  const { downloads, opened } = captureHandovers();
  const { el } = await mount();
  expect(text(el, "pack-heading")).toBe("Recovery pack");
  expect(text(el, "pack-lead")).toBe(
    "Download or print the recovery pack, then keep it somewhere safe, away from this box.",
  );
  expect(text(el, "pack-warning")).toBe("This is the only time the master key is shown.");
  expect(text(el, "prepare-pdf")).toBe("Show the master key");
  expect(control(el, "kept")).toBeNull();
  await showKey(el);
  expect(text(el, "master-key-name")).toBe("Master key · 2026-11-23 · QZJV");
  expect(text(el, "master-key")).toBe(KEY);
  expect(text(el, "download")).toBe("Download");
  expect(text(el, "print")).toBe("Print");
  expect(text(el, "copy")).toBe("Copy");
  expect(control(el, "prepare-pdf")).toBeNull();
  expect(el.shadowRoot!.querySelector('input[name="setup-pdf-kept"]')).toBeNull();
  expect(downloads).toEqual([]);
  expect(opened).not.toHaveBeenCalled();
  expect(control(el, "kept")).toBeNull();
  await userEvent.click(control(el, "download")!);
  expect(downloads).toHaveLength(1);
  expect(downloads[0]!.name).toBe("waitron-recovery-pack-1.pdf");
  const file = await readRecoveryPackPdf(
    new Uint8Array(await (await fetch(downloads[0]!.href)).arrayBuffer()),
  );
  expect(file.masterKey).toBe(KEY);
});

it.each(["download", "print"])(
  "Continue is not shown until Download or Print has been used, and keeps the pack once pressed: %s",
  async (used) => {
    captureHandovers();
    const { el, kept } = await mount();
    expect(control(el, "kept")).toBeNull();
    await showKey(el);
    expect(control(el, "kept")).toBeNull();
    await userEvent.click(control(el, used)!);
    await expect.poll(() => control(el, "kept")).not.toBeNull();
    expect(text(el, "kept")).toBe("Continue");
    expect(kept).toEqual([]);
    await userEvent.click(control(el, "kept")!);
    await expect.poll(() => kept).toHaveLength(1);
    await expect.poll(() => el.shadowRoot!.textContent).toContain("Recovery pack confirmed.");
  },
);

it("Copy alone leaves Continue hidden: the pack also holds the box key, which Copy leaves out", async () => {
  captureHandovers();
  const { el, kept } = await mount();
  await showKey(el);
  await userEvent.click(control(el, "copy")!);
  await expect.poll(() => text(el, "copied")).toBe("Copied.");
  expect(control(el, "kept")).toBeNull();
  expect(kept).toEqual([]);
});

it("a Print the browser blocks does not count: it says so where a refused Copy does, and Continue stays hidden", async () => {
  captureHandovers();
  vi.spyOn(window, "open").mockReturnValue(null);
  const { el, host } = await mount();
  await showKey(el);
  await userEvent.click(control(el, "print")!);
  await expect
    .poll(() => text(el, "print-failed"))
    .toBe("Print did not open. Use Download, or allow pop-ups and try again.");
  expect(control(el, "kept")).toBeNull();
  expect((await axe.run(host)).violations).toEqual([]);
});

it("says in Spanish when a Print is blocked", async () => {
  captureHandovers();
  vi.spyOn(window, "open").mockReturnValue(null);
  const { el } = await mount("es");
  await showKey(el);
  await userEvent.click(control(el, "print")!);
  await expect
    .poll(() => text(el, "print-failed"))
    .toBe(
      "No se abrió la impresión. Usa Descargar, o permite las ventanas emergentes y vuelve a intentarlo.",
    );
});

it("Copy puts the key on the clipboard exactly as printed, and Print opens the pack Download saves", async () => {
  const { copied, opened, downloads } = captureHandovers();
  const { el } = await mount();
  await showKey(el);
  expect(control(el, "copied")).toBeNull();
  await userEvent.click(control(el, "copy")!);
  await expect.poll(() => text(el, "copied")).toBe("Copied.");
  expect(copied).toEqual(["88DP 74BA YPVB RRM5 XFV2 WPQY B5M5"]);
  await userEvent.click(control(el, "download")!);
  await userEvent.click(control(el, "print")!);
  expect(opened).toHaveBeenCalledWith(downloads[0]!.href, "_blank");
  await userEvent.click(control(el, "download")!);
  expect(downloads).toHaveLength(2);
  expect(downloads[1]!.href).toBe(downloads[0]!.href);
});

it("a Copy the browser refuses says so under the key box, never Copied., and leaves Continue hidden", async () => {
  captureHandovers();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  const { el, host } = await mount();
  await showKey(el);
  await userEvent.click(control(el, "copy")!);
  await expect
    .poll(() => text(el, "copy-failed"))
    .toBe("Copy did not work. Use Download or Print.");
  expect(control(el, "copied")).toBeNull();
  expect(control(el, "kept")).toBeNull();
  expect((await axe.run(host)).violations).toEqual([]);
  await userEvent.click(control(el, "download")!);
  await expect.poll(() => control(el, "kept")).not.toBeNull();
});

it("offers no new keys while the box holds the key it made", async () => {
  captureHandovers();
  const { el, reissues } = await mount();
  expect(control(el, "replace-key")).toBeNull();
  await showKey(el);
  expect(control(el, "replace-key")).toBeNull();
  await userEvent.click(control(el, "download")!);
  await expect.poll(() => control(el, "kept")).not.toBeNull();
  expect(control(el, "replace-key")).toBeNull();
  expect(reissues).toEqual([]);
});

it.each(["password.invalid", "setup.attempt_conflict"])(
  "offers no new keys when showing the key is refused with %s, which is not the box saying it lost the key",
  async (code) => {
    const { el } = await mount("en", async () => {
      throw { code };
    });
    await userEvent.click(control(el, "prepare-pdf")!);
    await expect
      .poll(() => el.shadowRoot!.querySelector("wt-form-actions[data-failed=true]"))
      .not.toBeNull();
    expect(control(el, "replace-key")).toBeNull();
    expect(control(el, "key-lost")).toBeNull();
    expect(control(el, "prepare-pdf")).not.toBeNull();
  },
);

it.each([
  [
    "en",
    "The box no longer holds the master key it made. Make new keys to carry on.",
    "Make new keys",
  ],
  [
    "es",
    "El servidor ya no guarda la clave maestra que creó. Crea claves nuevas para seguir.",
    "Crear claves nuevas",
  ],
] as const)(
  "%s: a key the box lost when it restarted is replaced with new keys, which the step then shows once",
  async (locale, lost, replace) => {
    captureHandovers();
    const { el, host, reissues } = await mount(locale, async () => {
      throw { code: "setup.node_key_lost" };
    });
    await userEvent.click(control(el, "prepare-pdf")!);
    await expect.poll(() => text(el, "key-lost")).toBe(lost);
    expect(text(el, "replace-key")).toBe(replace);
    expect(
      el.shadowRoot!.querySelector("wt-form-actions[data-failed=false]"),
      "the lost-key sentence is the only message",
    ).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-form-actions[data-failed=true]")).toBeNull();
    expect(control(el, "prepare-pdf")).toBeNull();
    expect((await axe.run(host)).violations).toEqual([]);
    await userEvent.click(control(el, "replace-key")!);
    await expect.poll(() => text(el, "master-key")).toBe(NEW_KEY);
    expect(reissues).toHaveLength(1);
    expect(control(el, "replace-key")).toBeNull();
    expect(control(el, "key-lost")).toBeNull();
    expect(control(el, "kept")).toBeNull();
  },
);

it("shows the Recovery pack step in Spanish", async () => {
  captureHandovers();
  const { el } = await mount("es");
  expect(text(el, "pack-heading")).toBe("Paquete de recuperación");
  expect(text(el, "pack-lead")).toBe(
    "Descarga o imprime el paquete de recuperación y guárdalo en un lugar seguro, lejos de este servidor.",
  );
  expect(text(el, "pack-warning")).toBe("Esta es la única vez que se muestra la clave maestra.");
  expect(text(el, "prepare-pdf")).toBe("Mostrar la clave maestra");
  await showKey(el);
  expect(text(el, "master-key-name")).toBe("Clave maestra · 2026-11-23 · QZJV");
  expect(text(el, "download")).toBe("Descargar");
  expect(text(el, "print")).toBe("Imprimir");
  expect(text(el, "copy")).toBe("Copiar");
  await userEvent.click(control(el, "copy")!);
  await expect.poll(() => text(el, "copied")).toBe("Copiada.");
  await userEvent.click(control(el, "download")!);
  await expect.poll(() => text(el, "kept")).toBe("Continuar");
});

it("says in Spanish when a Copy is refused", async () => {
  captureHandovers();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  const { el } = await mount("es");
  await showKey(el);
  await userEvent.click(control(el, "copy")!);
  await expect
    .poll(() => text(el, "copy-failed"))
    .toBe("No se ha podido copiar. Usa Descargar o Imprimir.");
});
