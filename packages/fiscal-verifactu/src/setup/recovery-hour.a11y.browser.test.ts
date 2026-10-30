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
            "second-clock",
            "waiting",
            "later",
            "in-use",
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
              unavailable: [
                { source: "internet", result: "unavailable", reason: "tls" },
                ...(state === "second-clock"
                  ? [{ source: "browser", result: "unavailable", reason: "same_machine" }]
                  : []),
              ],
              secondClock: state !== "second-clock",
              disagreement: state === "disagreement",
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
                if (action === "compare-clocks")
                  return {
                    id: "comparison",
                    clock:
                      state === "second-clock"
                        ? { ...clock, usable: clock.usable.slice(0, 1) }
                        : clock,
                  };
                if (action === "preview") return { status: "preview" };
                if (state === "later" || state === "in-use")
                  throw {
                    code: "sif.allocation_invalid",
                    params: {
                      reason: state === "later" ? "minute_not_later" : "minute_in_use",
                      allowedFromMs: Date.parse("2026-10-18T20:04:00Z"),
                      ...(state === "in-use" ? { remainingMs: 240000, recheckInMs: 90000 } : {}),
                    },
                  };
                return state === "waiting"
                  ? {
                      status: "waiting",
                      targetMs: Date.parse("2026-10-18T13:00:00Z"),
                      remainingMs: 1_800_000,
                    }
                  : { status: "selected", identity: "0CSQW", binding, input: { selected: true } };
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
              for (const name of ["recovery-old-box-stopped", "recovery-sole-operation"]) {
                const input = el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
                input.checked = true;
                input.dispatchEvent(new Event("change"));
              }
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
              if (state !== "compared" && state !== "refusal") {
                el.shadowRoot!.querySelector<HTMLElement>("[data-test=select]")!.click();
                const shown: string = {
                  disagreement: "[data-test=clock-refused]",
                  "second-clock": "[data-test=clock-wait]",
                  waiting: "[data-test=remaining]",
                  later: "[data-test=minute-not-later]",
                  "in-use": "[data-test=minute-taken]",
                  selected: "[data-test=selected-hour]",
                }[state]!;
                await vi.waitFor(() => expect(el.shadowRoot!.querySelector(shown)).not.toBeNull());
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
