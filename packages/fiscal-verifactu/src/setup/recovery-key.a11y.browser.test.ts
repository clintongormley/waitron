import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { chooseFiles } from "@waitron/ui/src/test-helpers.js";
import type { LitElement } from "lit";
import { encodeMasterKeyCode } from "@waitron/shared";
import { renderRecoveryPack } from "@waitron/recovery-pack";
import monoUrl from "../assets/register-noto-sans-mono.ttf?url";
import fontUrl from "../assets/register-noto-sans.ttf?url";
import "./recovery-key.js";

const masterKeyName = "2026-10-17 · K7QX";
async function pack(locale: "en" | "es", holds: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const madeAt = "2026-10-17T12:40:00.000Z";
  return renderRecoveryPack({
    locale,
    timeZone: "Europe/Madrid",
    loadFonts: async () => ({
      regular: new Uint8Array(await (await fetch(fontUrl)).arrayBuffer()),
      mono: new Uint8Array(await (await fetch(monoUrl)).arrayBuffer()),
    }),
    pack: { venueName: "Olivo Centro", madeAt, number: 3 },
    parts: [],
    file: {
      kind: "waitron-recovery-pack",
      version: 2,
      number: 3,
      madeAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: null,
      serverKeyName: null,
      serverKeyHeldBy: null,
      masterKey: holds ? encodeMasterKeyCode(new Uint8Array(16).fill(7)) : null,
      masterKeyName,
      masterKeyHeldBy: holds ? null : 1,
    },
  });
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  document.body.style.background = "";
  document.documentElement.style.background = "";
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en", "es"] as const)
    it(`${locale} ${theme} PDF and printed fields fit and remain accessible`, async () => {
      const original = [window.innerWidth, window.innerHeight];
      try {
        for (const width of [390, 1280]) {
          await page.viewport(width, 1000);
          const host = document.createElement("main");
          hosts.push(host);
          document.body.append(host);
          host.lang = locale;
          applyTokens(host);
          host.dataset.theme = theme;
          host.style.cssText =
            "background:var(--wt-color-surface-raised);color:var(--wt-color-text);font-family:var(--wt-font-family);padding:var(--wt-space-4)";
          document.body.style.background = getComputedStyle(host).backgroundColor;
          document.documentElement.style.background = getComputedStyle(host).backgroundColor;
          for (const state of ["empty", "invalid", "refused", "elsewhere", "loaded"] as const) {
            const heading = document.createElement("h2");
            heading.textContent =
              locale === "en"
                ? {
                    empty: "Recovery key",
                    invalid: "Check the printed key",
                    refused: "Choose another PDF",
                    elsewhere: "Choose the pack that holds the key",
                    loaded: "Saved recovery PDF",
                  }[state]
                : {
                    empty: "Clave de recuperación",
                    invalid: "Revisa la clave impresa",
                    refused: "Elige otro PDF",
                    elsewhere: "Elige el paquete que tiene la clave",
                    loaded: "PDF de recuperación guardado",
                  }[state];
            host.append(heading);
            const el = document.createElement("vf-recovery-key");
            el.locale = locale;
            el.selection = {
              taxId: "B12345674",
              environment: "production",
              nodeId: "node-1",
              keyName: masterKeyName,
            };
            host.append(el);
            await el.updateComplete;
            if (state === "invalid") {
              for (const name of ["printed-recovery-key"]) {
                const field = el.shadowRoot!.querySelector<LitElement>(`[name="${name}"]`)!;
                await field.updateComplete;
                const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
                input.value = "wrong";
                input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
              }
              await el.updateComplete;
            }
            if (state === "refused") {
              const reading = vi.spyOn(el, "importFile");
              chooseFiles(
                el.shadowRoot!.querySelector("wt-file-input")!,
                new File(["not a PDF"], "notes.pdf"),
              );
              await reading.mock.results[0]!.value;
              await el.updateComplete;
              expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).not.toBe(
                "",
              );
            }
            if (state === "elsewhere" || state === "loaded") {
              const reading = vi.spyOn(el, "importFile");
              chooseFiles(
                el.shadowRoot!.querySelector("wt-file-input")!,
                new File([await pack(locale, state === "loaded")], "recovery.pdf"),
              );
              await reading.mock.results[0]!.value;
              await el.updateComplete;
              expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!).toContain(
                state === "loaded"
                  ? locale === "en"
                    ? "Key loaded"
                    : "Clave cargada"
                  : locale === "en"
                    ? "recovery pack 1"
                    : "paquete de recuperación 1",
              );
            }
          }
          const result = await axe.run(host);
          expect(result.violations).toEqual([]);
          expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
          if (import.meta.env["VITE_RECOVERY_KEY_LOOK"] === "1")
            await page.screenshot({
              path: `__screenshots__/recovery-key-look/${theme}-${locale}-${width}.png`,
              fullPage: true,
            });
          host.remove();
        }
      } finally {
        await page.viewport(original[0]!, original[1]!);
      }
    });
