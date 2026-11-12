import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { LitElement } from "lit";
import type { RecoveryHourEntry } from "./recovery-hour.js";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";

const hosts: HTMLElement[] = [];
afterEach(() => hosts.splice(0).forEach((host) => host.remove()));
const instant = Date.parse("2026-10-18T12:30:00Z");

for (const [zoneIndex, savedZone] of ["Not/A_Zone", " Europe/Madrid", "Europe/Madrid "].entries())
  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`${locale} ${theme} ${width} saved-zone ${zoneIndex} recovery shows UTC comparison and the current waiting countdown`, async () => {
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
              timeZone: savedZone,
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
                      secondClock: true,
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
            for (const selector of [
              '[name="recovery-old-box-stopped"]',
              '[name="recovery-sole-operation"]',
              '[name="recovery-details-confirmed"]',
            ]) {
              const input = el.shadowRoot!.querySelector<HTMLInputElement>(selector)!;
              input.checked = true;
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }
            const proceed = () =>
              el.shadowRoot!.querySelector("[data-test=compare]") as HTMLElement & {
                disabled: boolean;
              };
            await vi.waitFor(() => expect(proceed().disabled).toBe(false));
            await userEvent.click(proceed());
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull(),
            );
            expect(el.shadowRoot!.textContent).not.toContain("12:30");
            expect(
              [...el.shadowRoot!.querySelectorAll("[data-test=venue-review] dd")].at(-1)
                ?.textContent,
            ).toBe("UTC");
            expect(el.shadowRoot!.textContent).not.toContain(savedZone);
            await vi.waitFor(() =>
              expect(
                el.shadowRoot!.querySelector('[data-test="remaining"]')?.textContent?.trim(),
              ).toBe("30:00"),
            );
            expect(selection.timeZone).toBe(savedZone);
            expect((await axe.run(host)).violations).toEqual([]);
            expect(host.scrollWidth).toBeLessThanOrEqual(width);
            if (import.meta.env["VITE_RECOVERY_HOUR_LOOK"] === "1")
              await page.screenshot({
                path: `__screenshots__/a696-recovery-zone/${zoneIndex}-${locale}-${theme}-${width}.png`,
                element: host,
              });
            expect(el.readCredentials()).toBeNull();
          } finally {
            await page.viewport(original[0]!, original[1]!);
          }
        });

for (const savedZone of ["Not/A_Zone", " Europe/Madrid", "Europe/Madrid "])
  it(`saved zone ${JSON.stringify(savedZone)}: the clock step after Proceed shows the times in UTC`, async () => {
    const host = document.createElement("main");
    hosts.push(host);
    document.body.append(host);
    applyTokens(host);
    const el = FISCAL_SETUP.createRecovery!({
      locale: "en",
      selection: {
        sourceId: "synthetic-copy",
        taxId: "B12345674",
        environment: "preproduction" as const,
        nodeId: "node-1",
        keyName: "Synthetic key",
        country: "ES",
        fiscalTerritory: "ES-common",
        timeZone: savedZone,
      },
      binding: {
        module: "fiscal-verifactu",
        action: "restore",
        eventId: "synthetic-event",
        sourceId: "synthetic-copy",
        targetNodeId: "node-1",
      },
      prepare: async ({ proposal }) => {
        const action = (proposal as { action: string }).action;
        if (action === "clock-challenge") return { id: "challenge" };
        return {
          id: "comparison",
          clock: {
            usable: [
              { source: "box", lowerMs: instant, upperMs: instant },
              { source: "browser", lowerMs: instant + 300_000, upperMs: instant + 300_000 },
            ],
            unavailable: [],
            secondClock: true,
            disagreement: true,
            releaseBlocked: false,
            rangeBlocked: false,
          },
        };
      },
    }) as RecoveryHourEntry;
    host.append(el);
    await el.updateComplete;
    const key = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
    await key.updateComplete;
    const keyField = key.shadowRoot!.querySelector<LitElement>('[name="printed-recovery-key"]')!;
    await keyField.updateComplete;
    const keyInput = keyField.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    keyInput.value = "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c";
    keyInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    for (const name of [
      "recovery-old-box-stopped",
      "recovery-sole-operation",
      "recovery-details-confirmed",
    ]) {
      const input = el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const proceed = () =>
      el.shadowRoot!.querySelector("[data-test=compare]") as HTMLElement & { disabled: boolean };
    await vi.waitFor(() => expect(proceed().disabled).toBe(false));
    await userEvent.click(proceed());
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=clock-times]")).not.toBeNull(),
    );
    expect(
      [...el.shadowRoot!.querySelectorAll("[data-test=clock-times] dd")].map((dd) =>
        dd.textContent?.trim(),
      ),
    ).toEqual(["18 October 2026 at 12:30", "18 October 2026 at 12:35"]);
  });
