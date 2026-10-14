/// <reference types="@vitest/browser-playwright" />
import { afterEach, expect, it, vi } from "vitest";
import { cdp, commands, page } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { NodeRecoveryPanel } from "./node-recovery-panel.js";

afterEach(cleanupWidgets);
const pack = {
  version: 1,
  kind: "node-recovery-pack",
  createdAt: "2026-10-14T10:00:00.000Z",
  nodeRecovery: {
    nodeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "2026-10-14 · K7QF",
    secret: "synthetic-node-recovery-key-7c1d-4321",
  },
  modules: {
    "test-regime": {
      kind: "public-register-snapshot",
      fingerprint: "61fa".repeat(16),
      allocation: "P000042",
      signature: "signed-snapshot-test".repeat(4),
    },
  },
  warnings: [],
};

for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`${locale} ${theme} ${width}: input, refusal and downloads remain readable and accessible`, async () => {
        const oldLocale = currentLocale();
        try {
          setLocale(locale);
          await page.viewport(width, 1000);
          const fetcher = vi
            .fn()
            .mockImplementation(async () => new Response(JSON.stringify(pack)));
          const { el, host } = await mountWidget<NodeRecoveryPanel>(
            "dashboard-node-recovery",
            { api: new DashboardApi("", fetcher) },
            theme,
          );
          host.style.padding = "var(--wt-space-4)";
          await expectNoA11yViolations(el);
          const root = el.shadowRoot!;
          const label = root.querySelector<HTMLLabelElement>("label")!;
          expect(
            label.querySelector("span")!.getBoundingClientRect().top -
              label.getBoundingClientRect().top,
          ).toBeLessThan(10);
          root.querySelector<WtInput>("wt-input")!.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: "synthetic-node-recovery-key-7c1d-4321" },
            }),
          );
          const picker = root.querySelector<HTMLInputElement>("input[type=file]")!;
          const select = (content: string) => {
            const files = new DataTransfer();
            files.items.add(new File([content], "register.json"));
            picker.files = files.files;
            picker.dispatchEvent(new Event("change"));
          };
          select("not-json");
          await el.updateComplete;
          root.querySelector<WtButton>("wt-button")!.click();
          await vi.waitFor(() =>
            expect(root.querySelector("[data-test=file-error]")?.textContent).toBeTruthy(),
          );
          await expectNoA11yViolations(el);
          select('{"test-regime": {"register": "public"}}');
          await el.updateComplete;
          root.querySelector<WtButton>("wt-button")!.click();
          await vi.waitFor(() =>
            expect(root.querySelector("[data-test=print-pack]")).not.toBeNull(),
          );
          await expectNoA11yViolations(el);
          expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(width);
          expect(
            root.querySelector("[data-test=print-pack]")!.getBoundingClientRect().height,
          ).toBeGreaterThanOrEqual(44);
          expect(
            root.querySelector("[data-test=print-pack]")!.getBoundingClientRect().right,
          ).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `__screenshots__/w41s6-pack/${locale}-${theme}-${width}-panel.png`,
          });
          const html = await fetch(
            root.querySelector<HTMLAnchorElement>("[data-test=print-pack]")!.href,
          ).then((response) => response.text());
          await commands.writeFile(
            `src/screens/__screenshots__/w41s6-pack/${locale}-${theme}-${width}.html`,
            html,
          );
          const preview = document.createElement("iframe");
          preview.title = "Printable recovery pack";
          preview.style.width = "100%";
          preview.style.height = "1150px";
          preview.style.border = "0";
          const loaded = new Promise((resolve) =>
            preview.addEventListener("load", resolve, { once: true }),
          );
          preview.srcdoc = html;
          host.append(preview);
          await loaded;
          el.style.display = "none";
          const rendered = preview.contentDocument!;
          expect(rendered.querySelector("[data-key-name]")!.textContent).toBe("2026-10-14 · K7QF");
          expect(rendered.documentElement.scrollWidth).toBe(rendered.documentElement.clientWidth);
          expect(getComputedStyle(rendered.documentElement).color).toBe(
            theme === "light" ? "rgb(22, 24, 29)" : "rgb(236, 238, 242)",
          );
          await page.screenshot({
            path: `__screenshots__/w41s6-pack/${locale}-${theme}-${width}-print.png`,
          });
          await cdp().send("Emulation.setEmulatedMedia", { media: "print" });
          try {
            expect(getComputedStyle(rendered.body).color).toBe("rgb(0, 0, 0)");
            expect(getComputedStyle(rendered.documentElement).backgroundColor).toBe(
              "rgb(255, 255, 255)",
            );
          } finally {
            await cdp().send("Emulation.setEmulatedMedia", { media: "screen" });
          }
        } finally {
          setLocale(oldLocale);
        }
      });
    }
