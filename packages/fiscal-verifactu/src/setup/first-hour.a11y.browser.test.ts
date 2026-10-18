import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";
const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((h) => h.remove());
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en", "es"] as const)
    it(`${theme} ${locale} hour review and PDF controls fit and expose accessible names`, async () => {
      const previous = [innerWidth, innerHeight];
      try {
        for (const width of [390, 1280]) {
          await page.viewport(width, 2200);
          const host = document.createElement("main");
          document.body.append(host);
          hosts.push(host);
          applyTokens(host);
          host.dataset.theme = theme;
          host.lang = locale;
          host.style.cssText =
            "background:var(--wt-color-surface-raised);color:var(--wt-color-text);font-family:var(--wt-font-family);padding:var(--wt-space-4)";
          const instant = Date.parse("2026-10-18T12:30:00Z");
          let warning = false,
            waiting = false;
          const parent = FISCAL_SETUP.create({
            locale,
            request: {
              status: "claimed",
              environment: "production",
              venue: {
                country: "ES",
                taxId: "B12345674",
                legalName: "Olivo Restauración SL",
                seriesCode: "A",
                fullSeriesCode: "FF",
                rectificativeSeriesCode: "R",
                location: {
                  name: "Olivo Centro",
                  city: "Las Palmas",
                  fiscalTerritory: "ES-canary",
                  timeZone: "Atlantic/Canary",
                },
              },
            },
            api: {
              async preparation(value) {
                if ((value as { action: string }).action === "clock-challenge")
                  return { id: "challenge" };
                return {
                  id: "comparison",
                  clock: {
                    usable: [
                      { source: "box", lowerMs: instant, upperMs: instant },
                      {
                        source: "browser",
                        lowerMs: instant + (warning ? 180000 : 0),
                        upperMs: instant + (warning ? 180000 : 0),
                      },
                    ],
                    unavailable: [{ source: "internet", result: "unavailable", reason: "tls" }],
                    requiresConfirmation: warning,
                    disagreement: warning,
                    boundaryWait: false,
                    rangeBlocked: false,
                    releaseBlocked: false,
                  },
                };
              },
              async candidates() {
                return waiting
                  ? { status: "waiting", targetMs: instant + 1800000, remainingMs: 1800000 }
                  : {
                      kind: "waitron-hour-setup",
                      status: "selected",
                      identity: "06TH",
                      input: {
                        allocation: {
                          installationIdentity: "06TH",
                          series: [
                            { code: "A-06TH", purpose: "standard" },
                            { code: "FF-06TH", purpose: "full" },
                            { code: "R-06TH", purpose: "rectificative" },
                          ],
                        },
                      },
                    };
              },
              async request() {
                throw new Error("no resume in this fixture");
              },
              async importInput() {},
              async enrol() {},
              async confirm() {},
              async stageNodeKey() {
                return {
                  stage: { stageId: "stage", nodeId: "node", name: "Caja principal" },
                  key: {
                    nodeId: "node",
                    name: "Caja principal",
                    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
                  },
                };
              },
              async registerRecoveryDocument() {},
              async confirmRecoveryDocument() {},
            },
          }) as LitElement;
          host.append(parent);
          await parent.updateComplete;
          const el = parent.shadowRoot!.querySelector<LitElement>("vf-first-setup-hour")!;
          await el.updateComplete;
          const click = async (name: string) => {
            await userEvent.click(
              el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!,
            );
            await el.updateComplete;
          };
          const checked = async () => {
            await userEvent.click(
              el.shadowRoot!.querySelector<HTMLInputElement>(
                'input[name="setup-details-confirmed"]',
              )!,
            );
            const answer = el.shadowRoot!.querySelector<HTMLInputElement>(
              'input[name="taxpayer-hour"][value="no"]',
            )!;
            if (!answer.checked) await userEvent.click(answer);
          };
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
          );
          for (const state of ["review", "warning", "waiting", "pdf"] as const) {
            if (state === "warning") {
              warning = true;
              await click("compare");
              await vi.waitFor(() =>
                expect(
                  el.shadowRoot!.querySelector('[name="setup-clock-confirmed"]'),
                ).not.toBeNull(),
              );
            }
            if (state === "waiting") {
              warning = false;
              waiting = true;
              await click("compare");
              await vi.waitFor(() =>
                expect(el.shadowRoot!.querySelector('[name="setup-clock-confirmed"]')).toBeNull(),
              );
              await checked();
              await click("select");
              await vi.waitFor(() =>
                expect(el.shadowRoot!.querySelector("[data-test=hour-wait]")).not.toBeNull(),
              );
            }
            if (state === "pdf") {
              waiting = false;
              await click("compare");
              await vi.waitFor(() =>
                expect(el.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
              );
              await checked();
              await click("select");
              await vi.waitFor(() =>
                expect(el.shadowRoot!.querySelector("[data-test=prepare-pdf]")).not.toBeNull(),
              );
              await click("prepare-pdf");
              await vi.waitFor(() =>
                expect(el.shadowRoot!.querySelector("[data-test=download-pdf]")).not.toBeNull(),
              );
            }
            expect((await axe.run(host)).violations).toEqual([]);
            expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
            if (
              import.meta.env["VITE_FIRST_HOUR_LOOK"] === "1" &&
              (state === "warning" || state === "pdf")
            )
              await page.screenshot({
                path: `__screenshots__/first-hour-look/${theme}-${locale}-${width}-${state}.png`,
                element: host,
              });
          }
          host.remove();
        }
      } finally {
        await page.viewport(previous[0]!, previous[1]!);
      }
    });
