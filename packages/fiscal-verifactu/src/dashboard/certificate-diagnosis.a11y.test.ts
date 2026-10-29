import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { AeatCertificateClient } from "./client.js";
import { evidence, permission, savedCard } from "../../test/diagnosis-browser-fixtures.js";
import type { CertificateDiagnosisRequest } from "../certificate-diagnosis-contract.js";
import "./certificate-diagnosis.js";
let locale = "";
const size = { width: window.innerWidth, height: window.innerHeight };
beforeEach(() => {
  locale = currentLocale();
});
afterEach(async () => {
  cleanup();
  setLocale(locale);
  await page.viewport(size.width, size.height);
});
describe.each(["light", "dark"] as const)("diagnosis accessibility %s", (theme) => {
  it.each(["en", "es"] as const)(
    "%s has named controls, evidence announcements, keyboard Stop and no violations",
    async (language) => {
      setLocale(language);
      for (const width of [1280, 390]) {
        await page.viewport(width, 900);
        for (const mode of [
          "initial",
          "reader",
          "busy",
          "unavailable",
          "http",
          "local",
          "success",
          "stale",
          "revision",
          "saved",
        ] as const) {
          await mountThemed("<div></div>", theme);
          const auth = permission(mode === "reader" ? ["fiscal.view"] : ["system.manage"]);
          const panel = document.createElement("dashboard-aeat-certificate-diagnosis");
          panel.savedCard = savedCard;
          panel.permissionContinuation = auth.hook;
          panel.client = new AeatCertificateClient((async (
            _p: string,
            _m: string,
            raw: unknown,
          ) => {
            const body = raw as CertificateDiagnosisRequest;
            if (mode === "unavailable") throw new Error("PRIVATE_FAULT");
            if (mode === "revision") throw { code: "fiscal.certificate_changed", params: {} };
            if (mode === "busy") return new Promise(() => {});
            if (mode === "saved")
              return evidence(body, {
                saved: { kind: "sello", installedAt: "2026-10-29T23:30:00.000Z" },
                association: "verified",
              });
            return evidence(
              body,
              body.operation === "check"
                ? mode === "http"
                  ? { category: "http-response", httpStatus: 403 }
                  : {}
                : mode === "local"
                  ? { category: "local-finding", localFinding: "passphrase_wrong" }
                  : {},
            );
          }) as DashboardRequest);
          host.append(panel);
          await panel.updateComplete;
          const q = (s: string) =>
            panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
              `[data-test=${s}]`,
            )!;
          if (!["initial", "reader"].includes(mode)) {
            await userEvent.click(q("diagnosis-confirm"));
            await userEvent.click(q("diagnosis-inspect"));
            await panel.updateComplete;
            if (mode === "success" || mode === "http") {
              await vi.waitFor(() => expect(q("diagnosis-check").disabled).toBe(false));
              await userEvent.click(q("diagnosis-check"));
              await vi.waitFor(() => expect(q("diagnosis-copy")).not.toBeNull());
            }
            if (mode === "stale") {
              await vi.waitFor(() => expect(q("diagnosis-copy")).not.toBeNull());
              auth.change();
              await panel.updateComplete;
              expect(q("diagnosis-copy")).toBeNull();
            }
            if (mode === "revision") {
              await vi.waitFor(() => expect(q("diagnosis-reload-card")).not.toBeNull());
              expect(q("diagnosis-inspect").disabled).toBe(true);
              expect(q("diagnosis-check").disabled).toBe(true);
            }
          }
          expect(panel.shadowRoot!.querySelector("[role=status][aria-live=polite]")).not.toBeNull();
          await expectNoA11yViolations(host);
          const native = panel
            .shadowRoot!.querySelector("wt-dialog")!
            .shadowRoot!.querySelector("dialog")!;
          expect(native.getBoundingClientRect().width).toBeLessThanOrEqual(width);
          expect(native.scrollWidth).toBeLessThanOrEqual(native.clientWidth);
          await page.screenshot({
            path: `__screenshots__/a1089-diagnosis-${language}-${theme}-${width}-${mode}.png`,
          });
          const closed = new Promise<void>((resolve) =>
            panel.addEventListener("wt-close", () => resolve(), { once: true }),
          );
          await userEvent.keyboard("{Escape}");
          await closed;
          expect(panel.candidate).toBeNull();
          panel.remove();
          cleanup();
        }
      }
    },
  );
});
