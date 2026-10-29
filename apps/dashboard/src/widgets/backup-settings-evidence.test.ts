import { afterEach, expect, it, vi } from "vitest";
import type { WtButton, WtDialog } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { en, es, type StringKey } from "../i18n/strings.js";
import type { BackupLoadFailure, BackupSettingsEvidence, DashboardApi } from "../api/client.js";
import type { BackupSettingsEvidenceDialog } from "./backup-settings-evidence.js";

const modules = import.meta.glob<typeof import("./backup-settings-evidence.js")>(
  "./backup-settings-evidence.ts",
);
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

type Catalogue = Record<StringKey, string>;
type Api = Pick<DashboardApi, "getBackupSettingsEvidence">;

function words(catalogue: Catalogue, key: StringKey, values: Record<string, string> = {}) {
  return catalogue[key].replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function failure(overrides: Partial<BackupLoadFailure> = {}): BackupLoadFailure {
  return {
    at: "2026-10-29T10:00:00.000Z",
    code: "credentials.decrypt_failed",
    detail: { keyVersion: 2 },
    recordDigest: "digest-a",
    recordWrittenAt: "2026-10-29T09:00:00.000Z",
    ...overrides,
  };
}
function evidence(overrides: Partial<BackupSettingsEvidence> = {}): BackupSettingsEvidence {
  return {
    readAt: "2026-10-29T11:00:00.000Z",
    managedByEnvironment: false,
    failures: [failure()],
    lastCleanLoadAt: null,
    record: { keyVersion: 2, writtenAt: "2026-10-29T09:00:00.000Z", digest: "digest-a" },
    rewrittenSinceLastFailure: false,
    boxKeyNumbers: { current: 2 },
    now: { state: "unreadable", code: "credentials.decrypt_failed", detail: { keyVersion: 2 } },
    recoveryKey: { held: true, tooShort: false, fingerprint: "ABCD1234" },
    ...overrides,
  };
}
async function mount(api: Api, locale = "en-GB") {
  setLocale(locale);
  const load = modules["./backup-settings-evidence.ts"];
  expect(load, "evidence dialog exists").toBeTypeOf("function");
  await load!();
  const { el } = await mountWidget<BackupSettingsEvidenceDialog>(
    "dashboard-backup-settings-evidence",
    { api: api as DashboardApi, open: true },
  );
  return el;
}
function apiAnswering(...answers: (() => Promise<BackupSettingsEvidence>)[]) {
  const getBackupSettingsEvidence = vi.fn<() => Promise<BackupSettingsEvidence>>();
  for (const answer of answers) getBackupSettingsEvidence.mockImplementationOnce(answer);
  return { getBackupSettingsEvidence };
}
const q = (el: HTMLElement, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const qa = (el: HTMLElement, selector: string) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>(selector),
];
const text = (el: HTMLElement | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const button = (el: HTMLElement, name: string) => q(el, `[data-test=${name}]`) as WtButton | null;

const CAUSES: {
  name: string;
  failure: Pick<BackupLoadFailure, "code" | "detail">;
  boxKeyNumbers?: BackupSettingsEvidence["boxKeyNumbers"];
  expected: (c: Catalogue) => string;
}[] = [
  {
    name: "an unknown key number, one box key",
    failure: { code: "credentials.key_version_unknown", detail: { keyVersion: 7 } },
    boxKeyNumbers: { current: 3 },
    expected: (c) => words(c, "backup_evidence.cause.key_version_unknown", { n: "7", m: "3" }),
  },
  {
    name: "an unknown key number, two box keys",
    failure: { code: "credentials.key_version_unknown", detail: { keyVersion: 7 } },
    boxKeyNumbers: { current: 3, previous: 2 },
    expected: (c) =>
      words(c, "backup_evidence.cause.key_version_unknown_two", { n: "7", m: "3", p: "2" }),
  },
  {
    name: "a key that does not open the record",
    failure: { code: "credentials.decrypt_failed", detail: { keyVersion: 4 } },
    expected: (c) => words(c, "backup_evidence.cause.decrypt_failed", { n: "4" }),
  },
  {
    name: "a malformed payload",
    failure: { code: "credentials.malformed_payload", detail: null },
    expected: (c) => words(c, "backup_evidence.cause.malformed"),
  },
  {
    name: "an unusable credential",
    failure: { code: "server.credential_unusable", detail: null },
    expected: (c) => words(c, "backup_evidence.cause.malformed"),
  },
  {
    name: "settings whose schedule is invalid",
    failure: { code: "backup.archive_settings_invalid", detail: { reason: "schedule" } },
    expected: (c) =>
      words(c, "backup_evidence.cause.settings_invalid", {
        part: c["backup_evidence.part.schedule"],
      }),
  },
  {
    name: "settings invalid for no named reason",
    failure: { code: "backup.archive_settings_invalid", detail: null },
    expected: (c) =>
      words(c, "backup_evidence.cause.settings_invalid", {
        part: c["backup_evidence.part.contents"],
      }),
  },
  {
    name: "a missing recovery key",
    failure: { code: "backup.recovery_key_missing", detail: null },
    expected: (c) => words(c, "backup_evidence.cause.recovery_key_missing"),
  },
  {
    name: "a short recovery key",
    failure: { code: "backup.recovery_key_too_short", detail: { min: 20 } },
    expected: (c) => words(c, "backup_evidence.cause.recovery_key_too_short", { min: "20" }),
  },
  {
    name: "an invalid box setting",
    failure: {
      code: "server.config_invalid",
      detail: { variable: "WAITRON_BACKUP_STALE_AFTER_MS" },
    },
    expected: (c) =>
      words(c, "backup_evidence.cause.config_invalid", {
        variable: "WAITRON_BACKUP_STALE_AFTER_MS",
      }),
  },
  {
    name: "the unknown code",
    failure: { code: "unknown", detail: null },
    expected: (c) => words(c, "backup_evidence.cause.unknown", { code: "unknown" }),
  },
  {
    name: "any other code",
    failure: { code: "backup.something_new", detail: null },
    expected: (c) => words(c, "backup_evidence.cause.unknown", { code: "backup.something_new" }),
  },
];

for (const [locale, catalogue] of [
  ["en-GB", en],
  ["es-ES", es],
] as const)
  for (const cause of CAUSES)
    it(`words ${cause.name} from the strings file (${locale})`, async () => {
      const el = await mount(
        apiAnswering(async () =>
          evidence({
            failures: [failure(cause.failure)],
            ...(cause.boxKeyNumbers ? { boxKeyNumbers: cause.boxKeyNumbers } : {}),
          }),
        ),
        locale,
      );
      await expect.poll(() => text(q(el, "[data-test=failure-cause]"))).not.toBe("");
      expect(text(q(el, "[data-test=failure-cause]"))).toBe(cause.expected(catalogue));
      expect(el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.heading).toBe(
        catalogue["backup_evidence.heading"],
      );
    });

it("reads once on open, as an ordinary request, and lists each failure newest first", async () => {
  const api = apiAnswering(async () =>
    evidence({
      failures: [
        failure({ at: "2026-10-29T10:00:00.000Z", code: "credentials.malformed_payload" }),
        failure({ at: "2026-10-29T08:00:00.000Z", code: "backup.recovery_key_missing" }),
      ],
    }),
  );
  const el = await mount(api);
  await expect.poll(() => qa(el, "[data-test=failure-cause]").length).toBe(2);
  expect(api.getBackupSettingsEvidence).toHaveBeenCalledTimes(1);
  expect(api.getBackupSettingsEvidence).toHaveBeenCalledWith();
  expect(qa(el, "[data-test=failure-cause]").map(text)).toEqual([
    words(en, "backup_evidence.cause.malformed"),
    words(en, "backup_evidence.cause.recovery_key_missing"),
  ]);
});

it("says a failure happened again after a rewrite when two failures' records differ", async () => {
  const el = await mount(
    apiAnswering(async () =>
      evidence({
        failures: [
          failure({ recordDigest: "digest-b", recordWrittenAt: "2026-10-29T09:30:00.000Z" }),
          failure({ recordDigest: "digest-a", recordWrittenAt: "2026-10-29T07:00:00.000Z" }),
          failure({ recordDigest: "digest-a", recordWrittenAt: "2026-10-29T07:00:00.000Z" }),
        ],
      }),
    ),
  );
  await expect.poll(() => qa(el, "[data-test=failure]").length).toBe(3);
  const [newest, middle, oldest] = qa(el, "[data-test=failure]");
  expect(text(newest!.querySelector<HTMLElement>("[data-test=failure-again]"))).toBe(
    words(en, "backup_evidence.again_rewritten", {
      time: new Date("2026-10-29T09:30:00.000Z").toLocaleString("en-GB"),
    }),
  );
  expect(middle!.querySelector("[data-test=failure-again]")).toBeNull();
  expect(oldest!.querySelector("[data-test=failure-again]")).toBeNull();
});

it("says the record was rewritten since the last failure ahead of its facts", async () => {
  const el = await mount(apiAnswering(async () => evidence({ rewrittenSinceLastFailure: true })));
  await expect.poll(() => text(q(el, "[data-test=record-changed]"))).not.toBe("");
  expect(text(q(el, "[data-test=record-changed]"))).toBe(words(en, "backup_evidence.rewritten"));
  const now = q(el, "[data-test=record-now]")!;
  expect(now.firstElementChild?.getAttribute("data-test")).toBe("record-changed");
});

it("says a deleted record is no longer the record that failed, not that it was rewritten", async () => {
  const el = await mount(
    apiAnswering(async () =>
      evidence({ rewrittenSinceLastFailure: true, record: null, now: { state: "absent" } }),
    ),
  );
  await expect.poll(() => text(q(el, "[data-test=record-changed]"))).not.toBe("");
  expect(text(q(el, "[data-test=record-changed]"))).toBe(words(en, "backup_evidence.removed"));
  expect(text(q(el, "[data-test=record-now]"))).toContain(words(en, "backup_evidence.absent"));
});

it("shows a readable record's destinations, the folder's look and the bucket's access key ID", async () => {
  const el = await mount(
    apiAnswering(async () =>
      evidence({
        now: {
          state: "readable",
          destinations: [
            { kind: "folder", dir: "/mnt/usb", look: "missing" },
            {
              kind: "bucket",
              endpoint: "https://s3.example.test",
              region: "eu-west-1",
              bucket: "venue-backups",
              accessKeyId: "AKIAEXAMPLE",
              archiveFolder: "archives/venue-1",
            },
          ],
        },
      }),
    ),
  );
  await expect.poll(() => qa(el, "[data-test=destination]").length).toBe(2);
  const [folder, bucket] = qa(el, "[data-test=destination]").map(text);
  expect(folder).toContain("/mnt/usb");
  expect(folder).toContain(en["backup_evidence.look.missing"]);
  for (const value of [
    "https://s3.example.test",
    "eu-west-1",
    "venue-backups",
    "AKIAEXAMPLE",
    "archives/venue-1",
  ])
    expect(bucket).toContain(value);
});

it("says an unreadable record's destinations cannot be told, and shows none", async () => {
  const el = await mount(apiAnswering(async () => evidence()));
  await expect.poll(() => text(q(el, "[data-test=record-now]"))).not.toBe("");
  expect(text(q(el, "[data-test=record-now]"))).toContain(words(en, "backup_evidence.cannot_tell"));
  expect(qa(el, "[data-test=destination]")).toEqual([]);
});

const READABLE: BackupSettingsEvidence["now"] = {
  state: "readable",
  destinations: [{ kind: "folder", dir: "/mnt/usb", look: "folder" }],
};
for (const [name, overrides, shown] of [
  ["a readable record and a usable key", { now: READABLE }, true],
  ["a short key", { now: READABLE, recoveryKey: { held: true, tooShort: true } }, false],
  ["no key", { now: READABLE, recoveryKey: { held: false, tooShort: false } }, false],
  ["settings from the environment", { now: READABLE, managedByEnvironment: true }, false],
  ["an unreadable record", {}, false],
  ["no record", { now: { state: "absent" }, record: null }, false],
] as const)
  it(`${shown ? "says" : "does not say"} the settings read correctly now with ${name}`, async () => {
    const el = await mount(apiAnswering(async () => evidence(overrides)));
    await expect.poll(() => text(q(el, "[data-test=record-now]"))).not.toBe("");
    expect(text(q(el, "[data-test=reads-now]"))).toBe(
      shown ? words(en, "backup_evidence.reads_now") : "",
    );
  });

it("says the environment sets backups and shows no saved destination", async () => {
  const el = await mount(
    apiAnswering(async () =>
      evidence({ managedByEnvironment: true, now: { state: "readable", destinations: [] } }),
    ),
  );
  await expect.poll(() => text(q(el, "[data-test=record-now]"))).not.toBe("");
  expect(text(q(el, "[data-test=record-now]"))).toContain(words(en, "backup_evidence.managed"));
  expect(qa(el, "[data-test=destination]")).toEqual([]);
});

it("Read again replaces the facts, shows it is reading and keeps Stop available", async () => {
  const second = deferred<BackupSettingsEvidence>();
  const api = apiAnswering(
    async () => evidence({ failures: [failure({ code: "credentials.malformed_payload" })] }),
    () => second.promise,
  );
  const el = await mount(api);
  await expect
    .poll(() => text(q(el, "[data-test=failure-cause]")))
    .toBe(words(en, "backup_evidence.cause.malformed"));
  button(el, "evidence-read-again")!.click();
  await expect.poll(() => button(el, "evidence-read-again")!.loading).toBe(true);
  expect(button(el, "evidence-stop")!.disabled).toBe(false);
  expect(button(el, "evidence-stop")!.loading).toBe(false);
  second.resolve(
    evidence({ failures: [failure({ code: "backup.recovery_key_missing", detail: null })] }),
  );
  await expect
    .poll(() => qa(el, "[data-test=failure-cause]").map(text))
    .toEqual([words(en, "backup_evidence.cause.recovery_key_missing")]);
  expect(button(el, "evidence-read-again")!.loading).toBe(false);
  expect(api.getBackupSettingsEvidence).toHaveBeenCalledTimes(2);
});

it("a late answer after Stop does not redraw, even once the panel is open again", async () => {
  const first = deferred<BackupSettingsEvidence>();
  const second = deferred<BackupSettingsEvidence>();
  const api = apiAnswering(
    () => first.promise,
    () => second.promise,
  );
  const el = await mount(api);
  const closes: Event[] = [];
  el.addEventListener("evidence-close", (event) => closes.push(event));
  button(el, "evidence-stop")!.click();
  await expect.poll(() => el.open).toBe(false);
  expect(closes).toHaveLength(1);
  el.open = true;
  await el.updateComplete;
  expect(api.getBackupSettingsEvidence).toHaveBeenCalledTimes(2);
  first.resolve(evidence({ failures: [failure({ code: "credentials.malformed_payload" })] }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await el.updateComplete;
  expect(qa(el, "[data-test=failure-cause]")).toEqual([]);
  expect(button(el, "evidence-read-again")!.loading).toBe(true);
  second.resolve(
    evidence({ failures: [failure({ code: "backup.recovery_key_missing", detail: null })] }),
  );
  await expect
    .poll(() => qa(el, "[data-test=failure-cause]").map(text))
    .toEqual([words(en, "backup_evidence.cause.recovery_key_missing")]);
});

it("a refused read shows why, offers administrator sign-in and Stop, and shows no facts", async () => {
  const el = await mount(
    apiAnswering(() => Promise.reject({ code: "authorization.not_permitted", status: 403 })),
  );
  await expect.poll(() => button(el, "admin-sign-in")).not.toBeNull();
  expect(text(q(el, "[data-test=evidence-refused]"))).toBe(
    words(en, "backup_evidence.not_permitted"),
  );
  expect(text(button(el, "admin-sign-in"))).toBe(en["staff.sign_in_as_admin"]);
  expect(button(el, "evidence-stop")).not.toBeNull();
  expect(button(el, "evidence-read-again")).toBeNull();
  expect(q(el, "[data-test=record-now]")).toBeNull();
  expect(qa(el, "[data-test=failure]")).toEqual([]);
  const raised: Event[] = [];
  const listen = (event: Event) => raised.push(event);
  document.addEventListener("admin-sign-in", listen);
  try {
    button(el, "admin-sign-in")!.click();
    await expect.poll(() => raised.length).toBe(1);
  } finally {
    document.removeEventListener("admin-sign-in", listen);
  }
  expect(raised[0]!.bubbles).toBe(true);
  expect(raised[0]!.composed).toBe(true);
});

it("a failed read says the facts could not be read and keeps Read again and Stop", async () => {
  const api = apiAnswering(
    () => Promise.reject({ code: "server.internal", status: 500 }),
    async () => evidence(),
  );
  const el = await mount(api);
  await expect.poll(() => text(q(el, "[data-test=evidence-failed]"))).not.toBe("");
  expect(text(q(el, "[data-test=evidence-failed]"))).toBe(
    words(en, "backup_evidence.failed", { read_again: en["backup_evidence.read_again"] }),
  );
  expect(button(el, "evidence-read-again")!.disabled).toBe(false);
  expect(button(el, "evidence-read-again")!.loading).toBe(false);
  expect(button(el, "evidence-stop")!.disabled).toBe(false);
  expect(button(el, "admin-sign-in")).toBeNull();
  button(el, "evidence-read-again")!.click();
  await expect.poll(() => qa(el, "[data-test=failure]").length).toBe(1);
  expect(q(el, "[data-test=evidence-failed]")).toBeNull();
});

it("says what Turn on backups, Read again and Stop each do", async () => {
  const el = await mount(apiAnswering(async () => evidence()));
  await expect.poll(() => text(q(el, "[data-test=record-now]"))).not.toBe("");
  expect(text(q(el, "[data-test=evidence-choices]"))).toBe(
    `${words(en, "backup_evidence.turn_on", { apply: en["backup.apply"] })} ${words(
      en,
      "backup_evidence.choices",
      { read_again: en["backup_evidence.read_again"], stop: en["backup_evidence.stop"] },
    )}`,
  );
});
