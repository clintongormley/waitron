import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { LitElement } from "lit";
import "./recovery-key.js";
import { renderRecoveryPdf } from "../recovery-pdf.js";

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
          for (const state of ["empty", "invalid", "loaded"] as const) {
            const heading = document.createElement("h2");
            heading.textContent =
              locale === "en"
                ? {
                    empty: "Recovery key",
                    invalid: "Check the printed key",
                    loaded: "Saved recovery PDF",
                  }[state]
                : {
                    empty: "Clave de recuperación",
                    invalid: "Revisa la clave impresa",
                    loaded: "PDF de recuperación guardado",
                  }[state];
            host.append(heading);
            const el = document.createElement("vf-recovery-key");
            el.locale = locale;
            el.selection = {
              taxId: "B12345674",
              environment: "production",
              nodeId: "node-1",
              keyName: "Caja principal",
            };
            host.append(el);
            await el.updateComplete;
            if (state === "invalid") {
              for (const name of ["printed-recovery-key", "printed-recovery-check"]) {
                const field = el.shadowRoot!.querySelector<LitElement>(`[name="${name}"]`)!;
                await field.updateComplete;
                const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
                input.value = "wrong";
                input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
              }
              await el.updateComplete;
            }
            if (state === "loaded") {
              const bytes = await renderRecoveryPdf(
                {
                  kind: "waitron-recovery-document",
                  version: 1,
                  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
                  taxpayerName: "Olivo Restauración SL",
                  venueName: "Olivo Centro",
                  createdAt: "2026-10-17T12:30:00.000Z",
                  nodeKey: {
                    nodeId: "node-1",
                    name: "Caja principal",
                    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
                  },
                },
                locale,
              );
              const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
              const transfer = new DataTransfer();
              transfer.items.add(new File([bytes], "recovery.pdf"));
              picker.files = transfer.files;
              const reading = vi.spyOn(el, "importFile");
              picker.dispatchEvent(new Event("change"));
              await reading.mock.results[0]!.value;
              await el.updateComplete;
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
