import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";
import type { RecoveryHourEntry } from "./recovery-hour.js";
import type { LitElement } from "lit";
const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  document.body.style.background = "";
  document.documentElement.style.background = "";
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en", "es"] as const)
    it(`${locale} ${theme} recovery hours fit and remain accessible in each state`, async () => {
      const original = [window.innerWidth, window.innerHeight];
      try {
        for (const width of [390, 1280]) {
          await page.viewport(width, 2000);
          const host = document.createElement("main");
          hosts.push(host);
          document.body.append(host);
          applyTokens(host);
          host.dataset.theme = theme;
          host.lang = locale;
          host.style.cssText =
            "background:var(--wt-color-surface-raised);color:var(--wt-color-text);font-family:var(--wt-font-family);padding:var(--wt-space-4)";
          document.body.style.background = getComputedStyle(host).backgroundColor;
          document.documentElement.style.background = getComputedStyle(host).backgroundColor;
          const binding = {
            module: "fiscal-verifactu",
            action: "restore",
            eventId: "recovery",
            sourceId: "digest",
            targetNodeId: "node-1",
          };
          const instant = Date.parse("2026-10-18T12:30:00Z");
          for (const state of [
            "empty",
            "invalid",
            "compared",
            "disagreement",
            "waiting",
            "selected",
            "refusal",
          ] as const) {
            const clock = {
              usable: [
                { source: "box", lowerMs: instant, upperMs: instant },
                {
                  source: "browser",
                  lowerMs: instant + (state === "disagreement" ? 180_000 : 0),
                  upperMs: instant + (state === "disagreement" ? 180_000 : 0),
                },
              ],
              unavailable: [{ source: "internet", result: "unavailable", reason: "tls" }],
              disagreement: state === "disagreement",
              requiresConfirmation: state === "disagreement",
              boundaryWait: false,
              releaseBlocked: false,
              rangeBlocked: false,
            };
            const el = FISCAL_SETUP.createRecovery!({
              locale,
              binding,
              selection: {
                sourceId: "selected-copy",
                taxId: "B12345674",
                environment: "production",
                nodeId: "node-1",
                keyName: "Caja principal",
                country: "ES",
                fiscalTerritory: "common",
                timeZone: "Atlantic/Canary",
              },
              prepare: async (request) => {
                const action = (request.proposal as { action: string }).action;
                if (state === "refusal")
                  throw {
                    code: "setup.request_invalid",
                    params: { field: "nodeRecoverySecret" },
                    status: 400,
                  };
                if (action === "clock-challenge") return { id: "challenge" };
                if (action === "compare-clocks") return { id: "comparison", clock };
                return state === "waiting"
                  ? {
                      status: "waiting",
                      targetMs: Date.parse("2026-10-18T13:00:00Z"),
                      remainingMs: 1_800_000,
                      requiresClockConfirmation: false,
                    }
                  : { status: "selected", identity: "06TH", binding, input: { selected: true } };
              },
            }) as RecoveryHourEntry;
            host.append(el);
            await el.updateComplete;
            if (state === "invalid") el.readCredentials();
            else if (state !== "empty") {
              const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
              await key.updateComplete;
              for (const [name, value] of [
                ["printed-recovery-key", "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c"],
              ]) {
                const field = key.shadowRoot!.querySelector<LitElement>(`[name="${name}"]`)!;
                await field.updateComplete;
                const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
                input.value = value!;
                input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
              }
              const codes = el.shadowRoot!.querySelector<LitElement>(
                '[name="recovery-installation-codes"]',
              )!;
              await codes.updateComplete;
              const codeInput = codes.shadowRoot!.querySelector<HTMLInputElement>("input")!;
              codeInput.value = "06RB";
              codeInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
              for (const name of ["recovery-old-box-stopped", "recovery-sole-operation"]) {
                const input = el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
                input.checked = true;
                input.dispatchEvent(new Event("change"));
              }
              const radio = el.shadowRoot!.querySelector<HTMLInputElement>(
                `[name="taxpayer-hour"][value="${state === "waiting" ? "unknown" : "no"}"]`,
              )!;
              radio.checked = true;
              radio.dispatchEvent(new Event("change"));
              await vi.waitFor(() =>
                expect(
                  (
                    el.shadowRoot!.querySelector("[data-test=compare]") as HTMLElement & {
                      disabled: boolean;
                    }
                  ).disabled,
                ).toBe(false),
              );
              el.shadowRoot!.querySelector<HTMLElement>("[data-test=compare]")!.click();
              if (state === "refusal")
                await vi.waitFor(() =>
                  expect(
                    (
                      el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
                        error: string;
                      }
                    ).error,
                  ).not.toBe(""),
                );
              else
                await vi.waitFor(() =>
                  expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
                );
              if (state === "waiting" || state === "selected") {
                el.shadowRoot!.querySelector<HTMLElement>("[data-test=select]")!.click();
                await vi.waitFor(() =>
                  expect(el.shadowRoot!.textContent).toContain(
                    state === "selected" ? "06TH" : "2026-10-18T13:00:00.000Z",
                  ),
                );
              }
            }
            await el.updateComplete;
            expect((await axe.run(host)).violations).toEqual([]);
            expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
            if (
              import.meta.env["VITE_RECOVERY_HOUR_LOOK"] === "1" &&
              (state === "disagreement" || (width === 390 && theme === "light" && locale === "en"))
            )
              await page.screenshot({
                path: `__screenshots__/recovery-hour-look/${theme}-${locale}-${width}-${state}.png`,
                element: host,
              });
            el.remove();
          }
          host.remove();
        }
      } finally {
        await page.viewport(original[0]!, original[1]!);
      }
    });
