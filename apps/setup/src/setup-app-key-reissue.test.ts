import axe from "axe-core";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement } from "lit";
import { applyTokens, leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import type { FirstSetupState } from "./api/first-setup-types.js";
import { setLocale } from "./i18n/t.js";
import { wizardApi, venue, initial } from "../test/first-setup-browser.js";

const hosts: HTMLElement[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.remove());
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  setLocale("en-GB");
});
const control = <T extends HTMLElement = HTMLElement & { disabled: boolean }>(
  el: LitElement,
  name: string,
) => el.shadowRoot!.querySelector<T>(`[data-test=${name}]`)!;
async function screen(app: SetupApp, name: string) {
  await expect.poll(() => control(app, `screen-${name}`)).not.toBeNull();
  const el = control<LitElement>(app, `screen-${name}`);
  await el.updateComplete;
  return el;
}
function emit(app: SetupApp, type: string, detail?: unknown) {
  app
    .shadowRoot!.querySelector("main")!
    .dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`${locale} ${theme} ${width}: replaces a lost key through the actual wizard, password and new PDF-kept grant`, async () => {
        const previous = [innerWidth, innerHeight];
        try {
          await page.viewport(width, 1800);
          setLocale(locale);
          let retained: FirstSetupState = {
            ...structuredClone(initial),
            status: "claimed",
            environment: "production",
          };
          let replacement = 0;
          const instant = Date.parse("2026-10-18T12:30:00Z");
          const selected = {
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
          const { api, requests } = wizardApi({
            intercept(path, body) {
              if (path.endsWith("/preparation"))
                return Response.json({
                  state: retained,
                  preparation:
                    (body as { proposal: { action: string } }).proposal.action === "clock-challenge"
                      ? { id: "challenge" }
                      : {
                          id: "comparison",
                          clock: {
                            usable: ["box", "browser"].map((source) => ({
                              source,
                              lowerMs: instant,
                              upperMs: instant,
                            })),
                            unavailable: [],
                            disagreement: false,
                            requiresConfirmation: false,
                            boundaryWait: false,
                            releaseBlocked: false,
                            rangeBlocked: false,
                          },
                        },
                });
              if (path.endsWith("/candidates")) {
                retained = {
                  ...retained,
                  revision: 3,
                  status: "consumption-intent",
                  consumptionIntent: true,
                };
                return Response.json({ state: retained });
              }
              if (path.endsWith("/request"))
                return Response.json({
                  attemptId: initial.attemptId,
                  modules: [{ module: "fiscal-verifactu", request: selected }],
                });
              if (path.endsWith("/input")) {
                retained = { ...retained, revision: 4 };
                return Response.json({ state: retained });
              }
              if (path.endsWith("/reconfirm")) return Response.json({ reconfirmation: "proof" });
              if (path.endsWith("/node-key"))
                return Response.json(
                  { error: { code: "setup.attempt_conflict", params: {} } },
                  { status: 409 },
                );
              if (path.endsWith("/node-key-reissue")) {
                ++replacement;
                return Response.json({
                  stage: {
                    stageId: `replacement-${replacement}`,
                    nodeId: initial.nodeId,
                    name: `Key ${replacement}`,
                  },
                  key: {
                    nodeId: initial.nodeId,
                    name: `Key ${replacement}`,
                    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
                  },
                });
              }
              if (path.endsWith("/recovery-document") || path.endsWith("/recovery-document-kept"))
                return Response.json({ accepted: true });
            },
          });
          const host = document.createElement("div");
          document.body.append(host);
          hosts.push(host);
          applyTokens(host);
          host.dataset.theme = theme;
          host.lang = locale;
          const app = new SetupApp();
          app.api = api;
          app.browserLanguages = [locale];
          host.append(app);
          await screen(app, "mode");
          emit(app, "setup-patch", { patch: { mode: "live", venue } });
          emit(app, "setup-goto", { screen: "venue" });
          await screen(app, "venue");
          emit(app, "setup-advance");
          await screen(app, "cert");
          emit(app, "setup-goto", { screen: "review" });
          const shell = await screen(app, "first-setup");
          const module = shell.shadowRoot!.querySelector<LitElement>("vf-first-fiscal-screen")!;
          await module.updateComplete;
          const hour = module.shadowRoot!.querySelector<LitElement>("vf-first-setup-hour")!;
          await expect.poll(() => control(hour, "clock-readings")).not.toBeNull();
          const password = async () => {
            await expect.poll(() => control(shell, "owner-password")).not.toBeNull();
            await userEvent.fill(
              control(shell, "owner-password").shadowRoot!.querySelector<HTMLInputElement>(
                "input",
              )!,
              venue.admin.password,
            );
            await userEvent.click(control(shell, "reconfirm"));
          };
          await userEvent.click(
            hour.shadowRoot!.querySelector<HTMLInputElement>(
              'input[name="setup-details-confirmed"]',
            )!,
          );
          await userEvent.click(
            hour.shadowRoot!.querySelector<HTMLInputElement>(
              'input[name="taxpayer-hour"][value="no"]',
            )!,
          );
          await userEvent.click(control(hour, "select"));
          await password();
          await expect.poll(() => control(hour, "selected-hour")).not.toBeNull();
          await userEvent.click(control(hour, "prepare-pdf"));
          await password();
          await expect
            .poll(() => hour.shadowRoot!.querySelector("wt-form-actions[data-failed=true]"))
            .not.toBeNull();
          expect(requests.some((r) => r.path.endsWith("/node-key-reissue"))).toBe(false);
          expect(control(hour, "replace-key")).not.toBeNull();
          await userEvent.click(control(hour, "replace-key"));
          await expect.poll(() => control(shell, "owner-password")).not.toBeNull();
          expect(control(shell, "next").disabled).toBe(true);
          expect(innerWidth).toBe(width);
          expect((await axe.run(host)).violations).toEqual([]);
          await page.screenshot({
            path: `__screenshots__/a679-reissue/${locale}-${theme}-${width}-password.png`,
          });
          await password();
          await expect.poll(() => control(hour, "download-pdf")).not.toBeNull();
          const download = control<HTMLAnchorElement>(hour, "download-pdf");
          const bytes = new Uint8Array(await (await fetch(download.href)).arrayBuffer());
          expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
          expect(control(hour, "kept").disabled).toBe(true);
          expect(control(shell, "next").disabled).toBe(true);
          await userEvent.click(
            hour.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-pdf-kept"]')!,
          );
          await userEvent.click(control(hour, "kept"));
          await password();
          await expect.poll(() => control(shell, "next").disabled).toBe(false);
          expect(leaveCoordinatorFor(hour)!.isDirty([shell])).toBe(false);
          expect((await axe.run(host)).violations).toEqual([]);
          await page.screenshot({
            path: `__screenshots__/a679-reissue/${locale}-${theme}-${width}-kept.png`,
          });
          await userEvent.click(control(hour, "replace-key"));
          await expect.poll(() => control(shell, "owner-password")).not.toBeNull();
          expect(control(shell, "next").disabled).toBe(true);
          expect(
            leaveCoordinatorFor(hour)!.isDirty([shell]),
            "a replacement PDF needs fresh kept consent before leaving",
          ).toBe(true);
          expect(control(hour, "download-pdf")).toBeNull();
          await password();
          await expect.poll(() => control(hour, "download-pdf")).not.toBeNull();
          expect(
            hour.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-pdf-kept"]')!
              .checked,
          ).toBe(false);
          expect(control(shell, "next").disabled).toBe(true);
          expect(
            requests.filter((r) => r.path.endsWith("/node-key-reissue")).map((r) => r.body),
          ).toEqual([{ password: venue.admin.password }, { password: venue.admin.password }]);
          expect(
            requests
              .filter((r) => r.path.endsWith("/recovery-document"))
              .map((r) => (r.body as { stageId: string }).stageId),
          ).toEqual(["replacement-1", "replacement-2"]);
          expect(
            requests
              .filter((r) => r.path.endsWith("/recovery-document-kept"))
              .map((r) => (r.body as { stageId: string }).stageId),
          ).toEqual(["replacement-1"]);
          expect(requests.filter((r) => r.path.endsWith("/candidates"))).toHaveLength(1);
          expect(requests.filter((r) => r.path.endsWith("/input"))).toHaveLength(1);
          expect(requests.filter((r) => r.path.endsWith("/provision"))).toEqual([]);
          expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(
            venue.admin.password,
          );
          expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(
            "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
          );
        } finally {
          await page.viewport(previous[0]!, previous[1]!);
        }
      });
