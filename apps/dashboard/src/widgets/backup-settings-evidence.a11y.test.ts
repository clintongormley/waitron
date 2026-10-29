import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { BackupSettingsEvidence, DashboardApi } from "../api/client.js";
import { evidence, failure } from "../testing/backup-settings-evidence-fixture.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { BackupSettingsEvidenceDialog } from "./backup-settings-evidence.js";
import "./backup-settings-evidence.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  await page.viewport(1280, 900);
});

const FOLDER = { kind: "folder", dir: "/media/waitron/usb-backups", look: "folder" } as const;
const BUCKET = {
  kind: "bucket",
  endpoint: "https://s3.eu-central-1.example-object-storage.test",
  region: "eu-central-1",
  bucket: "venue-backups-calle-mayor",
  accessKeyId: "AKIAEXAMPLEACCESSKEY01",
  archiveFolder: "archives/venue-calle-mayor/2026",
} as const;

/** What each state's read answers: an evidence answer, or a rejection, or a read that never ends. */
const ANSWERS: Record<string, () => Promise<BackupSettingsEvidence>> = {
  loaded: async () => evidence(),
  reading: () => new Promise(() => {}),
  refused: () => Promise.reject({ code: "authorization.not_permitted", status: 403 }),
  failed: () => Promise.reject({ code: "server.internal", status: 500 }),
  readable: async () => evidence({ now: { state: "readable", destinations: [FOLDER] } }),
  bucket: async () =>
    evidence({
      failures: [failure({ code: "backup.recovery_key_missing" })],
      now: { state: "readable", destinations: [FOLDER, BUCKET] },
      recoveryKey: { held: false, tooShort: false },
    }),
  rewritten: async () =>
    evidence({
      failures: [
        failure({ recordDigest: "digest-b", recordWrittenAt: "2026-10-29T09:30:00.000Z" }),
        failure({
          at: "2026-10-29T08:00:00.000Z",
          recordDigest: "digest-a",
          recordWrittenAt: "2026-10-29T07:00:00.000Z",
        }),
      ],
      record: { keyVersion: 2, writtenAt: "2026-10-29T10:30:00.000Z", digest: "digest-c" },
      rewrittenSinceLastFailure: true,
    }),
  environment: async () =>
    evidence({ managedByEnvironment: true, now: { state: "readable", destinations: [] } }),
};
/** The selector that shows each state has finished drawing. */
const READY: Record<string, string> = {
  reading: "[role=status]",
  refused: "[data-test=evidence-refused]",
  failed: "[data-test=evidence-failed]",
};

const wide = Object.keys(ANSWERS).map((state) => ({ state, locale: "en-GB", width: 1280 }));
// The states with the longest text, where a narrow screen is likeliest to overflow.
const narrow = ["loaded", "bucket", "rewritten"].map((state) => ({
  state,
  locale: "es-ES",
  width: 390,
}));

describe.each(["light", "dark"] as const)(
  "backup settings evidence accessibility (%s)",
  (theme) => {
    it.each([...wide, ...narrow])(
      "draws $state in $locale at $width px",
      async ({ state, locale, width }) => {
        await page.viewport(width, 900);
        expect(window.innerWidth).toBe(width);
        setLocale(locale);
        const api = { getBackupSettingsEvidence: ANSWERS[state] } as unknown as DashboardApi;
        const { el, host } = await mountWidget<BackupSettingsEvidenceDialog>(
          "dashboard-backup-settings-evidence",
          { api, open: true },
          theme,
        );
        const root = el.shadowRoot!;
        await expect
          .poll(() => root.querySelector(READY[state] ?? "[data-test=record-now]"))
          .toBeTruthy();
        const dialog = root.querySelector("wt-dialog")!;
        await dialog.updateComplete;
        const native = dialog.shadowRoot!.querySelector("dialog")!;
        // wt-dialog makes an overflowing body a tab stop on the frame after its content changes.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        expect(native.open).toBe(true);
        await expectNoA11yViolations(host);
        expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        const body = root.querySelector<HTMLElement>(".body")!;
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      },
    );
  },
);
