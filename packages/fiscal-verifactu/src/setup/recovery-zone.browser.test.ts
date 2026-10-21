import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { LitElement } from "lit";
import type { RecoveryHourEntry } from "./recovery-hour.js";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";

const hosts: HTMLElement[] = [];
afterEach(() => hosts.splice(0).forEach((host) => host.remove()));
const instant = Date.parse("2026-10-18T12:30:00Z");

for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`${locale} ${theme} ${width} invalid-zone recovery shows UTC comparison and waiting evidence`, async () => {
        const original = [window.innerWidth, window.innerHeight];
        try {
          await page.viewport(width, 1700);
          const host = document.createElement("main");
          hosts.push(host);
          document.body.append(host);
          applyTokens(host);
          host.dataset.theme = theme;
          host.lang = locale;
          host.style.cssText =
            "background:var(--wt-color-surface-raised);color:var(--wt-color-text);font-family:var(--wt-font-family);padding:var(--wt-space-4)";
          const selection = {
            sourceId: "synthetic-copy",
            taxId: "B12345674",
            environment: "preproduction" as const,
            nodeId: "node-1",
            keyName: "Synthetic key",
            country: "ES",
            fiscalTerritory: "ES-common",
            timeZone: "Not/A_Zone",
          };
          const el = FISCAL_SETUP.createRecovery!({
            locale,
            selection,
            binding: {
              module: "fiscal-verifactu",
              action: "restore",
              eventId: "synthetic-event",
              sourceId: selection.sourceId,
              targetNodeId: selection.nodeId,
            },
            prepare: async ({ proposal }) => {
              const action = (proposal as { action: string }).action;
              if (action === "clock-challenge") return { id: "challenge" };
              if (action === "compare-clocks")
                return {
                  id: "comparison",
                  clock: {
                    usable: [
                      { source: "box", lowerMs: instant, upperMs: instant },
                      { source: "browser", lowerMs: instant, upperMs: instant },
                    ],
                    unavailable: [],
                    disagreement: false,
                    requiresConfirmation: false,
                    boundaryWait: false,
                    releaseBlocked: false,
                    rangeBlocked: false,
                  },
                };
              return {
                status: "waiting",
                targetMs: Date.parse("2026-10-18T13:00:00Z"),
                remainingMs: 1800000,
                requiresClockConfirmation: false,
              };
            },
          }) as RecoveryHourEntry;
          host.append(el);
          await el.updateComplete;
          const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
          await key.updateComplete;
          const keyField = key.shadowRoot!.querySelector<LitElement>(
            '[name="printed-recovery-key"]',
          )!;
          await keyField.updateComplete;
          const keyInput = keyField.shadowRoot!.querySelector<HTMLInputElement>("input")!;
          keyInput.value = "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c";
          keyInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          const codes = el.shadowRoot!.querySelector<LitElement>(
            '[name="recovery-installation-codes"]',
          )!;
          await codes.updateComplete;
          const codeInput = codes.shadowRoot!.querySelector<HTMLInputElement>("input")!;
          codeInput.value = "06RB";
          codeInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          for (const selector of [
            '[name="recovery-old-box-stopped"]',
            '[name="recovery-sole-operation"]',
            '[name="taxpayer-hour"][value="unknown"]',
          ]) {
            const input = el.shadowRoot!.querySelector<HTMLInputElement>(selector)!;
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const compare = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
            "[data-test=compare]",
          )!;
          await vi.waitFor(() => expect(compare.disabled).toBe(false));
          compare.click();
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
          );
          expect(el.shadowRoot!.textContent).toContain("12:30:00 UTC");
          expect(el.shadowRoot!.textContent).toContain("2026-10-18T12:30:00.000Z");
          expect(el.shadowRoot!.textContent).not.toContain("Not/A_Zone");
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=select]")!.click();
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(
              "2026-10-18T13:00:00.000Z",
            ),
          );
          expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(
            "13:00:00 UTC",
          );
          expect(selection.timeZone).toBe("Not/A_Zone");
          expect((await axe.run(host)).violations).toEqual([]);
          expect(host.scrollWidth).toBeLessThanOrEqual(width);
          if (import.meta.env["VITE_RECOVERY_HOUR_LOOK"] === "1")
            await page.screenshot({
              path: `__screenshots__/a696-recovery-zone/${locale}-${theme}-${width}.png`,
              element: host,
            });
          expect(el.readCredentials()).toBeNull();
        } finally {
          await page.viewport(original[0]!, original[1]!);
        }
      });
