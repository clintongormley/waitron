import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type {
  BackupLoadFailureDetail,
  BackupSettingsEvidence,
  DashboardApi,
} from "../api/client.js";
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

/** One cause-table row of the design, with the saved record as that failure would leave it. */
function row(
  code: string,
  detail: BackupLoadFailureDetail | null,
  readable: Partial<BackupSettingsEvidence> | null,
): BackupSettingsEvidence {
  return evidence({
    failures: [failure({ code, detail })],
    ...(readable ?? { now: { state: "unreadable", code, detail } }),
  });
}

/** The server's `ARCHIVE_SETTINGS_REASONS` other than `schedule`, which "settings-invalid" draws. */
const SETTINGS_REASONS = [
  "not_json",
  "fields",
  "revision",
  "enabled",
  "destinations",
  "destination",
  "bucket",
  "duplicate_id",
  "duplicate_dir",
  "buckets",
  "retention",
  "destinationTimeoutMs",
] as const;

/** What each state's read answers: an evidence answer, or a rejection, or a read that never ends. */
const ANSWERS: Record<string, () => Promise<BackupSettingsEvidence>> = {
  "key-version-unknown": async () =>
    evidence({
      failures: [failure({ code: "credentials.key_version_unknown", detail: { keyVersion: 7 } })],
      record: { keyVersion: 7, writtenAt: "2026-10-29T09:00:00.000Z", digest: "digest-a" },
      boxKeyNumbers: { current: 3, previous: 2 },
      now: {
        state: "unreadable",
        code: "credentials.key_version_unknown",
        detail: { keyVersion: 7 },
      },
    }),
  "key-version-unknown-one-key": async () =>
    evidence({
      failures: [failure({ code: "credentials.key_version_unknown", detail: { keyVersion: 7 } })],
      record: { keyVersion: 7, writtenAt: "2026-10-29T09:00:00.000Z", digest: "digest-a" },
      boxKeyNumbers: { current: 3 },
      now: {
        state: "unreadable",
        code: "credentials.key_version_unknown",
        detail: { keyVersion: 7 },
      },
    }),
  "decrypt-failed": async () => evidence(),
  malformed: async () => row("credentials.malformed_payload", null, null),
  "credential-unusable": async () => row("server.credential_unusable", null, null),
  "settings-invalid": async () =>
    row("backup.archive_settings_invalid", { reason: "schedule" }, null),
  ...Object.fromEntries(
    SETTINGS_REASONS.map((reason) => [
      `settings-invalid-${reason}`,
      async () => row("backup.archive_settings_invalid", { reason }, null),
    ]),
  ),
  "recovery-key-missing": async () =>
    row("backup.recovery_key_missing", null, {
      now: { state: "readable", destinations: [FOLDER] },
      recoveryKey: { held: false, tooShort: false },
    }),
  "recovery-key-too-short": async () =>
    row(
      "backup.recovery_key_too_short",
      { min: 20 },
      {
        now: { state: "readable", destinations: [FOLDER] },
        recoveryKey: { held: true, tooShort: true, fingerprint: "ABCD1234" },
      },
    ),
  "config-invalid": async () =>
    row(
      "server.config_invalid",
      { variable: "WAITRON_BACKUP_STALE_AFTER_MS" },
      {
        now: { state: "readable", destinations: [FOLDER] },
      },
    ),
  unknown: async () => row("backup.something_new", null, null),
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
  "record-deleted": async () =>
    evidence({ rewrittenSinceLastFailure: true, record: null, now: { state: "absent" } }),
  environment: async () =>
    evidence({ managedByEnvironment: true, now: { state: "readable", destinations: [] } }),
  reading: () => new Promise(() => {}),
  refused: () => Promise.reject({ code: "authorization.not_permitted", status: 403 }),
  failed: () => Promise.reject({ code: "server.internal", status: 500 }),
  stop: () => new Promise(() => {}),
};
/** The selector that shows each state has finished drawing. */
const READY: Record<string, string> = {
  reading: "[role=status]",
  stop: "[role=status]",
  refused: "[data-test=evidence-refused]",
  failed: "[data-test=evidence-failed]",
};

const cases = [1280, 390].flatMap((width) =>
  ["en-GB", "es-ES"].map((locale) => ({ width, locale })),
);

async function screenshot(native: HTMLDialogElement, name: string) {
  await page.screenshot({ element: native, path: `__screenshots__/look/${name}.png` });
}

describe.each(["light", "dark"] as const)(
  "backup settings evidence accessibility (%s)",
  (theme) => {
    describe.each(cases)("in $locale at $width px", ({ width, locale }) => {
      it.each(Object.keys(ANSWERS))("draws %s", async (state) => {
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
          .poll(() => root.querySelector(READY[state] ?? "[data-test=record-now]"), {
            message: state,
          })
          .toBeTruthy();
        const dialog = root.querySelector("wt-dialog")!;
        await dialog.updateComplete;
        const native = dialog.shadowRoot!.querySelector("dialog")!;
        // wt-dialog makes an overflowing body a tab stop on the frame after its content changes.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const name = `a1089-evidence-${locale}-${theme}-${width}-${state}`;
        expect(native.open, state).toBe(true);
        await expectNoA11yViolations(host);
        expect(native.getBoundingClientRect().right, state).toBeLessThanOrEqual(width);
        const body = root.querySelector<HTMLElement>(".body")!;
        expect(body.scrollWidth, state).toBeLessThanOrEqual(body.clientWidth + 1);
        expect(document.documentElement.scrollWidth, state).toBeLessThanOrEqual(width);
        const stop = root.querySelector<WtButton>("[data-test=evidence-stop]")!;
        if (state === "stop") {
          stop.focus();
          await expect.poll(() => stop.matches(":focus-within")).toBe(true);
        }
        await screenshot(native, name);
        if (width === 390) {
          const scroller = dialog.shadowRoot!.querySelector<HTMLElement>(".body")!;
          scroller.scrollTop = scroller.scrollHeight;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          await screenshot(native, `${name}-end`);
        }
        if (state === "stop") {
          stop.click();
          await expect.poll(() => el.open).toBe(false);
          await expect.poll(() => native.open).toBe(false);
        }
        host.remove();
      });
    });
  },
);
