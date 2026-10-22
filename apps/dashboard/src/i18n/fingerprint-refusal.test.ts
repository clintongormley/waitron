import { page } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, AlertView } from "../api/client.js";
import { AlertsScreen } from "../screens/alerts-screen.js";
import { afterEach, expect, it, vi } from "vitest";
import { codeMessage } from "./codes.js";
import { setLocale } from "./t.js";
import { alertMessage } from "./alerts.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each([
  ["en", "Fingerprint check failed; ask a manager."],
  ["en-GB", "Fingerprint check failed; ask a manager."],
  ["es", "Ha fallado la comprobación de la huella; avisa a un responsable."],
  ["es-ES", "Ha fallado la comprobación de la huella; avisa a un responsable."],
])("explains a fingerprint refusal in %s without exposing context", (locale, sentence) => {
  expect(codeMessage("fiscal.fingerprint_mismatch", locale)).toBe(sentence);
  expect(codeMessage("unknown.fingerprint_test", locale)).not.toBe(sentence);
  expect(codeMessage("unknown.fingerprint_test", locale)).not.toContain("unknown.");
});

it.each([
  ["en", "Invoice action refused: fingerprint check failed."],
  ["en-GB", "Invoice action refused: fingerprint check failed."],
  ["es", "Operación de factura rechazada: ha fallado la comprobación de la huella."],
  ["es-ES", "Operación de factura rechazada: ha fallado la comprobación de la huella."],
])("explains the refusal incident in %s without internal context", (locale, sentence) => {
  expect(alertMessage("fiscal.fingerprint_mismatch", { internal: "hidden" }, locale)).toBe(
    sentence,
  );
  expect(alertMessage("unknown.fingerprint_test", {}, locale)).not.toBe(sentence);
});

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["light", "dark"] as const).flatMap((theme) =>
      [390, 1280].map((width) => ({ locale, theme, width })),
    ),
  ),
)("shows the incident at $width in $locale/$theme", async ({ locale, theme, width }) => {
  await page.viewport(width, 900);
  setLocale(locale);
  history.replaceState(null, "", "/manage/alerts");
  for (const key of ["waitron.alerts.open.table", "waitron.alerts.handled.table"]) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(`${key}:columns`);
  }
  const incident: AlertView = {
    key: "incident:fingerprint",
    kind: "event",
    code: "fiscal.fingerprint_mismatch",
    params: {},
    severity: "error",
    since: "2026-10-22T09:00:00Z",
    area: "fiscal",
  };
  const api = {
    liveData: new LiveData(),
    listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [incident] }),
    listHandledAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [] }),
  } as unknown as DashboardApi;
  try {
    const { el } = await mountWidget<AlertsScreen>("dashboard-alerts-screen", { api }, theme);
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector('[data-test="open-alerts-table"]')?.shadowRoot?.textContent,
      ).toContain(alertMessage(incident.code, {})),
    );
    const table = el.shadowRoot!.querySelector('[data-test="open-alerts-table"]')!;
    const message = table.shadowRoot!.querySelector<HTMLElement>('[part="alert-message"]')!;
    expect(message.textContent).not.toContain(incident.code);
    expect(message.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `__screenshots__/a1003-alert-${locale}-${theme}-${width}.png` });
  } finally {
    await page.viewport(1280, 900);
  }
});
