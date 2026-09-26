import { LiveData } from "@waitron/dashboard-kit";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { alertMessage } from "../i18n/alerts.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { DashboardApi, StreamSettingsView, StreamStatusView } from "../api/client.js";
import type { StreamSettingsPanel } from "./stream-settings-panel.js";
import "./stream-settings-panel.js";

afterEach(cleanupWidgets);

const OFF: StreamSettingsView = {
  isPrimary: true,
  configured: false,
  bucket: null,
  status: { state: "off" },
  recoveryKeySet: false,
  keyFingerprint: null,
};
const STREAMING = {
  state: "streaming",
  generation: "gen-0-n-20260923T101500Z",
  reason: null,
  stateSince: "2026-09-23T10:15:30.000Z",
  bucketProblem: null,
  lastConfirmedUploadAt: "2026-09-23T10:16:00.000Z",
  lagMs: 0,
} as const;
const ON: StreamSettingsView = {
  isPrimary: true,
  configured: true,
  bucket: {
    endpoint: null,
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "",
    accessKeyId: "AKIAEXAMPLE",
  },
  status: STREAMING,
  recoveryKeySet: true,
  keyFingerprint: "ab12cd34",
};
// A realistic kit is one long token with no spaces — the width case below depends on that.
const KIT = `WAITRON-RECOVERY-KIT-1:${"eyJ2ZXJzaW9uIjoxLCJ2ZW51ZUlkIjoi".repeat(12)}`;
const NEW_KIT = `WAITRON-RECOVERY-KIT-1:${"bmV3LWtleS1uZXcta2V5LW5ldy1rZXkt".repeat(12)}`;

function stubApi(overrides: Partial<DashboardApi> = {}, settings = OFF): DashboardApi {
  const getStreamSettings = vi.fn().mockResolvedValue(settings);
  return {
    getStreamSettings,
    // As on the server, a later read of the settings answers what Save returned.
    saveStreamSettings: vi.fn(() => {
      getStreamSettings.mockResolvedValue(ON);
      return Promise.resolve(ON);
    }),
    testStreamBucket: vi.fn().mockResolvedValue({ ok: true }),
    turnOffStream: vi.fn().mockResolvedValue(OFF),
    getRecoveryKit: vi.fn().mockResolvedValue({ kit: KIT, keyFingerprint: "ab12cd34" }),
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
}

/** A background client beside `api`, as the real one has, whose kit read is its own mock. */
function withBackground(api: DashboardApi): DashboardApi & { background: DashboardApi } {
  const background = {
    ...api,
    getRecoveryKit: vi.fn().mockResolvedValue({ kit: KIT, keyFingerprint: "ffee0011" }),
  } as unknown as DashboardApi;
  return Object.assign(api, { background });
}

/** What a later automatic read of the settings brings: the box's settings as they now are. */
async function refresh(
  el: StreamSettingsPanel,
  api: DashboardApi,
  next: StreamSettingsView | { code: string },
): Promise<void> {
  if ("code" in next) vi.mocked(api.getStreamSettings).mockRejectedValue(next);
  else vi.mocked(api.getStreamSettings).mockResolvedValue(next);
  api.liveData.invalidate([{ type: "backup_status" }]);
  await flush(el);
}

function withStatus(status: StreamStatusView): StreamSettingsView {
  return { ...ON, status };
}

async function flush(el: StreamSettingsPanel): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

async function mount(api: DashboardApi, props: Partial<StreamSettingsPanel> = {}) {
  const mounted = await mountWidget<StreamSettingsPanel>("dashboard-stream-settings", {
    api,
    ...props,
  });
  await flush(mounted.el);
  return mounted;
}

const q = (el: StreamSettingsPanel, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const field = (el: StreamSettingsPanel, name: string) =>
  q(el, `wt-input[name=${name}]`) as HTMLElement & { error: string; value: string; type: string };
const text = (el: StreamSettingsPanel, sel: string) => q(el, sel)?.textContent?.trim();
const summaryErrors = (el: StreamSettingsPanel) =>
  (q(el, "wt-form-error-summary") as HTMLElement & { errors: string[] }).errors;
const focusedName = (el: StreamSettingsPanel) =>
  el.shadowRoot!.activeElement?.getAttribute("name") ?? null;

function type(el: StreamSettingsPanel, name: string, value: string): void {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function fillRequired(el: StreamSettingsPanel): void {
  type(el, "bucket-region", "eu-west-1");
  type(el, "bucket-name", "venue-copy");
  type(el, "bucket-access-key-id", "AKIAEXAMPLE");
  type(el, "bucket-secret-access-key", "not-a-real-secret-0123456789");
}

async function press(el: StreamSettingsPanel, button: string): Promise<void> {
  q(el, `[data-test=${button}]`)!.click();
  await flush(el);
}

describe("stream-settings-panel: the bucket form", () => {
  it("offers the bucket form with every field named and the required ones marked", async () => {
    const { el } = await mount(stubApi());
    const inputs = [...el.shadowRoot!.querySelectorAll("wt-input")];
    expect(inputs.map((i) => i.getAttribute("name"))).toEqual([
      "bucket-endpoint",
      "bucket-region",
      "bucket-name",
      "bucket-prefix",
      "bucket-access-key-id",
      "bucket-secret-access-key",
    ]);
    const required = inputs
      .filter((i) => (i as HTMLElement & { required: boolean }).required)
      .map((i) => i.getAttribute("name"));
    expect(required).toEqual([
      "bucket-region",
      "bucket-name",
      "bucket-access-key-id",
      "bucket-secret-access-key",
    ]);
  });

  it("explains every missing field beside it and in one summary, focuses the first, and sends nothing", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await press(el, "save");
    expect(api.saveStreamSettings).not.toHaveBeenCalled();
    expect(summaryErrors(el)).toEqual([
      t("stream.form.region_required"),
      t("stream.form.bucket_required"),
      t("stream.form.access_key_id_required"),
      t("stream.form.secret_access_key_required"),
    ]);
    expect(field(el, "bucket-region").error).toBe(t("stream.form.region_required"));
    expect(field(el, "bucket-endpoint").error).toBe("");
    expect(focusedName(el)).toBe("bucket-region");
  });

  it("refuses an endpoint that is not a web address, beside the field", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    fillRequired(el);
    type(el, "bucket-endpoint", "s3.example.net");
    await press(el, "save");
    expect(api.saveStreamSettings).not.toHaveBeenCalled();
    expect(field(el, "bucket-endpoint").error).toBe(t("stream.form.endpoint_invalid"));
    expect(focusedName(el)).toBe("bucket-endpoint");
  });

  it("Test sends the typed bucket and says it passed", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    fillRequired(el);
    type(el, "bucket-endpoint", " https://s3.example.net ");
    await press(el, "test");
    expect(api.testStreamBucket).toHaveBeenCalledWith({
      endpoint: "https://s3.example.net",
      region: "eu-west-1",
      bucket: "venue-copy",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "not-a-real-secret-0123456789",
    });
    expect(text(el, "[data-test=test-passed]")).toBe(t("stream.form.test_passed"));
  });

  it("Test checks the fields first, as Save does", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    await press(el, "test");
    expect(api.testStreamBucket).not.toHaveBeenCalled();
    expect(summaryErrors(el)).toHaveLength(4);
  });

  it("a failed Test shows the localised refusal and the failed check in words", async () => {
    const api = stubApi({
      testStreamBucket: vi.fn().mockRejectedValue({
        code: "backup.stream_test_failed",
        params: { reason: "create_only_ignored" },
        status: 422,
      }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "test");
    const alert = q(el, "[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("backup.stream_test_failed"));
    expect(alert.textContent).toContain(t("stream.probe.create_only_ignored"));
    expect(alert.textContent).not.toContain("create_only_ignored");
    expect(q(el, "[data-test=test-passed]")).toBeNull();
  });

  it("a failed Test with a check it has no sentence for shows the refusal alone, never the reason's text", async () => {
    const api = stubApi({
      testStreamBucket: vi.fn().mockRejectedValue({
        code: "backup.stream_test_failed",
        params: { reason: "<b>made_up</b>" },
      }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "test");
    expect(text(el, "[role=alert]")).toBe(codeMessage("backup.stream_test_failed"));
  });

  it("puts a refused bucket name beside the bucket field, in the summary, and focuses it", async () => {
    const api = stubApi({
      saveStreamSettings: vi.fn().mockRejectedValue({
        code: "backup.stream_config_unsafe",
        params: { field: "bucket" },
      }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(field(el, "bucket-name").error).toBe(t("stream.field.bucket_characters"));
    expect(summaryErrors(el)).toEqual([t("stream.field.bucket_characters")]);
    expect(focusedName(el)).toBe("bucket-name");
    expect(q(el, "p[role=alert]")).toBeNull();
    // What was typed stays, so the owner can correct it.
    expect(field(el, "bucket-name").value).toBe("venue-copy");
  });

  it.each([
    ["backup.stream_config_unsafe", "prefix", "bucket-prefix", "stream.field.prefix_folders"],
    [
      "backup.stream_config_unsafe",
      "accessKeyId",
      "bucket-access-key-id",
      "stream.field.key_characters",
    ],
    [
      "backup.stream_config_unsafe",
      "secretAccessKey",
      "bucket-secret-access-key",
      "stream.field.key_characters",
    ],
    ["backup.stream_config_unsafe", "region", "bucket-region", "stream.field.check"],
    ["backup.request_invalid", "prefix", "bucket-prefix", "stream.field.check"],
    ["backup.request_invalid", "endpoint", "bucket-endpoint", "stream.field.check"],
  ] as const)("puts %s naming %s beside its field", async (code, named, name, key) => {
    const api = stubApi({
      testStreamBucket: vi.fn().mockRejectedValue({ code, params: { field: named } }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "test");
    expect(field(el, name).error).toBe(t(key as StringKey));
    expect(focusedName(el)).toBe(name);
  });

  it("shows a refusal naming something the form does not hold as one alert, with no field marked", async () => {
    const api = stubApi({
      saveStreamSettings: vi.fn().mockRejectedValue({
        code: "backup.stream_config_unsafe",
        params: { field: "replicaUrl" },
      }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(text(el, "[role=alert]")).toBe(codeMessage("backup.stream_config_unsafe"));
    expect(summaryErrors(el)).toEqual([]);
    expect(field(el, "bucket-name").error).toBe("");
  });

  it("explains, in this panel's words, a Save refused because the environment sets the backups", async () => {
    const api = stubApi({
      saveStreamSettings: vi.fn().mockRejectedValue({ code: "backup.managed_by_environment" }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(text(el, "[role=alert]")).toBe(t("stream.error.managed_by_environment"));
  });

  it("sends the corrected value once a refused field is fixed", async () => {
    const api = stubApi();
    const save = vi
      .mocked(api.saveStreamSettings)
      .mockRejectedValueOnce({ code: "backup.stream_config_unsafe", params: { field: "bucket" } });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    type(el, "bucket-name", "venue.copy");
    await press(el, "save");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: "venue.copy" }));
    expect(q(el, "[data-test=kit]")).not.toBeNull();
  });

  it("submits Save when Enter is pressed in a field", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    fillRequired(el);
    await el.updateComplete;
    const input = field(el, "bucket-region").shadowRoot!.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await flush(el);
    expect(api.saveStreamSettings).toHaveBeenCalledOnce();
  });

  it("shows and hides the secret access key", async () => {
    const { el } = await mount(stubApi());
    expect(field(el, "bucket-secret-access-key").type).toBe("password");
    await press(el, "toggle-secret");
    expect(field(el, "bucket-secret-access-key").type).toBe("text");
    expect(q(el, "[data-test=toggle-secret]")!.getAttribute("aria-label")).toBe(
      t("stream.form.hide_secret"),
    );
    expect(text(el, "[data-test=toggle-secret]")).toBe("");
    await press(el, "toggle-secret");
    expect(field(el, "bucket-secret-access-key").type).toBe("password");
  });

  it("takes back the passed message once a field is changed after Test", async () => {
    const { el } = await mount(stubApi());
    fillRequired(el);
    await press(el, "test");
    expect(q(el, "[data-test=test-passed]")).not.toBeNull();
    type(el, "bucket-name", "another-bucket");
    await flush(el);
    expect(q(el, "[data-test=test-passed]")).toBeNull();
  });

  it.each([
    ["changed", "untested-bucket", false],
    ["retyped with the same value", "venue-copy", true],
  ] as const)(
    "says Test passed only for the settings it tested, when a field is %s while Test runs",
    async (_n, bucket, passed) => {
      let finish!: (value: { ok: true }) => void;
      const api = stubApi({
        testStreamBucket: vi.fn(() => new Promise<{ ok: true }>((r) => (finish = r))),
      });
      const { el } = await mount(api);
      fillRequired(el);
      await press(el, "test");
      type(el, "bucket-name", bucket);
      await flush(el);
      finish({ ok: true });
      await flush(el);
      expect(q(el, "[data-test=test-passed]") !== null).toBe(passed);
    },
  );

  it("asks a password manager for a new secret, never a saved one", async () => {
    const { el } = await mount(stubApi());
    const inner = field(el, "bucket-secret-access-key").shadowRoot!.querySelector("input")!;
    expect(inner.autocomplete).toBe("new-password");
  });
});

describe("stream-settings-panel: once set up", () => {
  it("Save switches the copy on and immediately offers the kit with its warning, a copy button and a real download", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(api.saveStreamSettings).toHaveBeenCalled();
    expect(api.getRecoveryKit).toHaveBeenCalled();
    expect(text(el, "[data-test=kit]")).toBe(KIT);
    expect(text(el, "[data-test=kit-warning]")).toBe(t("stream.kit.warning"));
    const download = q(el, "[data-test=download-kit]") as HTMLAnchorElement;
    expect(download.href.startsWith("blob:")).toBe(true);
    expect(download.getAttribute("download")).toBe("waitron-recovery-kit-ab12cd34.txt");
    expect(q(el, "[data-test=copy-kit]")).not.toBeNull();
    // The secret is not kept once saved: changing the bucket later starts with it blank and the
    // rest of the settings filled in from the server.
    await press(el, "change");
    expect(field(el, "bucket-secret-access-key").value).toBe("");
    expect(field(el, "bucket-region").value).toBe("eu-west-1");
  });

  it("puts the kit file's heading and note above the kit", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    try {
      const { el } = await mount(stubApi({}, ON));
      await press(el, "show-kit");
      const blob = createObjectURL.mock.calls.at(-1)![0] as Blob;
      expect(await blob.text()).toBe(
        `${t("stream.kit.file_heading")}\n${t("stream.kit.file_note")}\n\n${KIT}\n`,
      );
    } finally {
      createObjectURL.mockRestore();
    }
  });

  it("copies the kit, and a refused clipboard leaves the kit on screen with nothing unhandled", async () => {
    const { el } = await mount(stubApi({}, ON));
    await press(el, "show-kit");
    // A plain function, not a vi spy: a spy observes the promise it returns, which would mark the
    // refusal handled and hide a missing catch.
    const copied: string[] = [];
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: (value: string) => {
        copied.push(value);
        return Promise.reject(new DOMException("denied", "NotAllowedError"));
      },
    });
    const unhandled: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      q(el, "[data-test=copy-kit]")!.click();
      expect(copied).toEqual([KIT]);
      // Rejections are reported in the order they went unhandled, so once this marker arrives any
      // unhandled clipboard refusal from the click above has been reported too.
      const marker = new Error("marker");
      void Promise.reject(marker);
      await vi.waitFor(() => expect(unhandled).toContain(marker));
      expect(unhandled).toEqual([marker]);
      expect(text(el, "[data-test=kit]")).toBe(KIT);
      expect(q(el, "[role=alert]")).toBeNull();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      delete (navigator.clipboard as unknown as Record<string, unknown>)["writeText"];
    }
  });

  it("shows how current the copy is when it is on, and the kit on request", async () => {
    const { el } = await mount(stubApi({}, ON));
    expect(text(el, "[data-test=stream-state]")).toBe(t("stream.state.streaming"));
    expect(text(el, "[data-test=stream-lag]")).toBe(t("stream.status.lag_none"));
    expect(text(el, "[data-test=stream-last]")).toBe(
      new Date(STREAMING.lastConfirmedUploadAt).toLocaleString(),
    );
    expect(q(el, "[data-test=kit]")).toBeNull();
    await press(el, "show-kit");
    expect(text(el, "[data-test=kit]")).toBe(KIT);
    expect(q(el, "[data-test=show-kit]")).toBeNull();
  });

  it.each([
    [17 * 60_000, t("stream.status.lag_minutes").replace("{minutes}", "17")],
    [30_000, t("stream.status.lag_under_minute")],
  ])("reports %i ms of waiting changes as %s", async (lagMs, shown) => {
    const { el } = await mount(stubApi({}, withStatus({ ...STREAMING, lagMs })));
    expect(text(el, "[data-test=stream-lag]")).toBe(shown);
  });

  it("says no copy has been confirmed yet", async () => {
    const { el } = await mount(
      stubApi({}, withStatus({ ...STREAMING, state: "opening", lastConfirmedUploadAt: null })),
    );
    expect(text(el, "[data-test=stream-state]")).toBe(t("stream.state.opening"));
    expect(text(el, "[data-test=stream-last]")).toBe(t("stream.status.never"));
  });

  it.each([
    ["paused", "side_file_limit", "stream.state.paused"],
    ["refused", "pointer_changed", "stream.state.another_server"],
    ["refused", "pointer_newer_term", "stream.state.another_server"],
    ["refused", "config_unsafe", "stream.state.unusable"],
    ["off", "supervisor_failed", "stream.state.not_running"],
    ["off", "stopped", "stream.state.not_running"],
  ] as const)("words a supervisor that is %s for %s as %s", async (state, reason, key) => {
    const { el } = await mount(stubApi({}, withStatus({ ...STREAMING, state, reason })));
    expect(text(el, "[data-test=stream-state]")).toBe(t(key));
    expect(q(el, "[data-test=stream-lag]")).not.toBeNull();
  });

  it("does not say another server is writing when the settings are what stopped the copy", async () => {
    const { el } = await mount(
      stubApi({}, withStatus({ ...STREAMING, state: "refused", reason: "config_unsafe" })),
    );
    expect(text(el, "[data-test=stream-state]")).not.toBe(t("stream.state.another_server"));
  });

  it.each([
    [
      "set up but not started",
      { state: "off", reason: "no_membership", stateSince: STREAMING.stateSince },
    ],
    ["plainly off", { state: "off" }],
  ] as const)(
    "says a copy that is %s is not running, with no lag or last-copy rows",
    async (_n, status) => {
      const { el } = await mount(stubApi({}, withStatus(status)));
      expect(text(el, "[data-test=stream-state]")).toBe(t("stream.state.not_running"));
      expect(q(el, "[data-test=stream-lag]")).toBeNull();
      expect(q(el, "[data-test=stream-last]")).toBeNull();
      expect(q(el, "[data-test=bucket-problem]")).toBeNull();
    },
  );

  it("names the bucket check that is failing, in words", async () => {
    const bucketProblem = { reason: "access_denied", since: STREAMING.stateSince };
    const { el } = await mount(stubApi({}, withStatus({ ...STREAMING, bucketProblem })));
    expect(text(el, "[data-test=bucket-problem]")).toBe(t("stream.probe.access_denied"));
  });

  it("falls back to the bucket alert's sentence for a failing check it has no words for, never the reason's text", async () => {
    const bucketProblem = { reason: "<i>made_up</i>", since: STREAMING.stateSince };
    const { el } = await mount(stubApi({}, withStatus({ ...STREAMING, bucketProblem })));
    expect(text(el, "[data-test=bucket-problem]")).toBe(
      alertMessage("backup.stream_bucket_unusable", {}),
    );
  });

  it("re-issues the kit when the recovery key changes, with the keep-the-old-kit banner", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    expect(q(el, "[data-test=kit-reissued]")).toBeNull();
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(api.getRecoveryKit).toHaveBeenCalledOnce();
    expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
  });

  it("does not re-issue on the first fingerprint it is given", async () => {
    const api = stubApi({}, { ...ON, keyFingerprint: null });
    const { el } = await mount(api);
    await refresh(el, api, ON);
    await refresh(el, api, ON);
    expect(api.getRecoveryKit).not.toHaveBeenCalled();
    expect(q(el, "[data-test=kit-reissued]")).toBeNull();
  });

  it("does not fetch a kit when the key changes on a box with no bucket copy", async () => {
    const held = { ...OFF, recoveryKeySet: true, keyFingerprint: "ab12cd34" };
    const api = stubApi({}, held);
    const { el } = await mount(api);
    await refresh(el, api, { ...held, keyFingerprint: "ffee0011" });
    expect(api.getRecoveryKit).not.toHaveBeenCalled();
  });

  it("re-issues the kit through the background client, so an unattended screen stays passive", async () => {
    const api = withBackground(stubApi({}, ON));
    const { el } = await mount(api);
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(api.background.getRecoveryKit).toHaveBeenCalledOnce();
    expect(api.getRecoveryKit).not.toHaveBeenCalled();
    expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
  });

  it("says why an automatic re-issue failed, keeps the banner off the old kit, and a later read that fetches it takes the alert away", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "show-kit");
    vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(text(el, "[data-test=read-failure]")).toBe(codeMessage("connection.failed"));
    expect(q(el, "[data-test=refusal]")).toBeNull();
    expect(q(el, "[data-test=kit-reissued]")).toBeNull();
    expect(text(el, "[data-test=kit]")).toBe(KIT);
    vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(q(el, "[role=alert]")).toBeNull();
    expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
  });

  it("tries a failed automatic re-issue again on each later read until it succeeds, and then stops", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(api.getRecoveryKit).toHaveBeenCalledTimes(2);
    vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(api.getRecoveryKit).toHaveBeenCalledTimes(3);
  });

  it("does not start a second re-issue while one is still being fetched", async () => {
    type Kit = { kit: string; keyFingerprint: string };
    let finish!: (value: Kit) => void;
    const api = stubApi({ getRecoveryKit: vi.fn(() => new Promise<Kit>((r) => (finish = r))) }, ON);
    const { el } = await mount(api);
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(api.getRecoveryKit).toHaveBeenCalledOnce();
    finish({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    await flush(el);
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
  });

  it("takes the banner away when a second key change's re-issue fails, so the first new kit is not offered as the one to download", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
    vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
    await refresh(el, api, { ...ON, keyFingerprint: "99887766" });
    expect(text(el, "[data-test=read-failure]")).toBe(codeMessage("connection.failed"));
    expect(q(el, "[data-test=kit-reissued]")).toBeNull();
  });

  it("keeps a failed re-issue's alert in place while a later read tries again, and takes it away once the kit arrives", async () => {
    type Kit = { kit: string; keyFingerprint: string };
    const changed = { ...ON, keyFingerprint: "ffee0011" };
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
    await refresh(el, api, changed);
    const alert = q(el, "[data-test=read-failure]");
    expect(alert).not.toBeNull();
    let fail!: (error: unknown) => void;
    vi.mocked(api.getRecoveryKit).mockImplementation(
      () => new Promise<Kit>((_, reject) => (fail = reject)),
    );
    await refresh(el, api, changed);
    expect(api.getRecoveryKit).toHaveBeenCalledTimes(2);
    expect(q(el, "[data-test=read-failure]")).toBe(alert);
    fail({ code: "connection.failed" });
    await flush(el);
    expect(q(el, "[data-test=read-failure]")).toBe(alert);
    vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    await refresh(el, api, changed);
    expect(q(el, "[data-test=read-failure]")).toBeNull();
  });

  it.each([
    ["fetched", { ...ON, keyFingerprint: "ffee0011" }, 3],
    ["dropped by the copy being turned off", { ...OFF, keyFingerprint: "ffee0011" }, 2],
  ] as const)(
    "once a failed re-issue is %s, a failed read's alert goes with the next successful read, even one bringing another key change",
    async (_, settled, fetches) => {
      type Kit = { kit: string; keyFingerprint: string };
      const api = stubApi({}, ON);
      const { el } = await mount(api);
      vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
      await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
      vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
      await refresh(el, api, settled);
      await refresh(el, api, { code: "authorization.not_permitted" });
      expect(text(el, "[data-test=read-failure]")).toBe(codeMessage("authorization.not_permitted"));
      vi.mocked(api.getRecoveryKit).mockImplementation(() => new Promise<Kit>(() => {}));
      await refresh(el, api, { ...ON, keyFingerprint: "99887766" });
      expect(api.getRecoveryKit).toHaveBeenCalledTimes(fetches);
      expect(q(el, "[data-test=read-failure]")).toBeNull();
    },
  );

  it("drops a failed re-issue's alert once a read finds the copy turned off elsewhere", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(q(el, "[data-test=read-failure]")).not.toBeNull();
    await refresh(el, api, OFF);
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it.each(["arrives", "fails"] as const)(
    "shows nothing of a re-issue that %s after the owner turned the copy off",
    async (outcome) => {
      type Kit = { kit: string; keyFingerprint: string };
      let settle!: { resolve: (value: Kit) => void; reject: (error: unknown) => void };
      const api = stubApi(
        {
          getRecoveryKit: vi.fn(
            () => new Promise<Kit>((resolve, reject) => (settle = { resolve, reject })),
          ),
        },
        ON,
      );
      const { el } = await mount(api);
      await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
      await press(el, "turn-off");
      await press(el, "turn-off");
      expect(api.turnOffStream).toHaveBeenCalledOnce();
      if (outcome === "arrives") settle.resolve({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
      else settle.reject({ code: "connection.failed" });
      await flush(el);
      expect(q(el, "[data-test=kit]")).toBeNull();
      expect(q(el, "[data-test=kit-reissued]")).toBeNull();
      expect(q(el, "[role=alert]")).toBeNull();
    },
  );

  it("shows a failed read's alert beside an earlier refusal's, and the refusal stays once reads succeed again", async () => {
    const api = stubApi({
      testStreamBucket: vi.fn().mockRejectedValue({ code: "backup.stream_test_failed" }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "test");
    await refresh(el, api, { code: "connection.failed" });
    expect(text(el, "[data-test=refusal]")).toBe(codeMessage("backup.stream_test_failed"));
    expect(text(el, "[data-test=read-failure]")).toBe(codeMessage("connection.failed"));
    await refresh(el, api, OFF);
    expect(q(el, "[data-test=read-failure]")).toBeNull();
    expect(text(el, "[data-test=refusal]")).toBe(codeMessage("backup.stream_test_failed"));
  });

  it("fetches the kit the owner asks for through the ordinary client", async () => {
    const api = withBackground(stubApi({}, ON));
    const { el } = await mount(api);
    await press(el, "show-kit");
    expect(api.getRecoveryKit).toHaveBeenCalledOnce();
    expect(api.background.getRecoveryKit).not.toHaveBeenCalled();
  });

  it("tells the Backups screen to read its status again once Save has stored the bucket", async () => {
    const api = stubApi();
    const invalidate = vi.spyOn(api.liveData, "invalidate");
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  });

  it("does not tell the Backups screen anything when Save is refused", async () => {
    const api = stubApi({
      saveStreamSettings: vi.fn().mockRejectedValue({ code: "backup.reload_in_progress" }),
    });
    const invalidate = vi.spyOn(api.liveData, "invalidate");
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("drops a failed automatic read's alert once a later read succeeds", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await refresh(el, api, { code: "connection.failed" });
    expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed"));
    await refresh(el, api, ON);
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("keeps a refused Test's alert when an automatic read succeeds afterwards", async () => {
    const api = stubApi({
      testStreamBucket: vi.fn().mockRejectedValue({ code: "backup.stream_test_failed" }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "test");
    await refresh(el, api, OFF);
    expect(text(el, "[role=alert]")).toBe(codeMessage("backup.stream_test_failed"));
  });

  it.each(["save", "kit"] as const)(
    "explains, in this panel's words, a %s refused because the box's recovery key is too short",
    async (which) => {
      const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
      const api =
        which === "save"
          ? stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) })
          : stubApi({ getRecoveryKit: vi.fn().mockRejectedValue(refusal) }, ON);
      const { el } = await mount(api, { managedByEnvironment: false });
      if (which === "save") {
        fillRequired(el);
        await press(el, "save");
      } else {
        await press(el, "show-kit");
      }
      expect(text(el, "[role=alert]")).toBe(t("stream.error.recovery_key_too_short"));
    },
  );

  it.each(["en-GB", "es-ES"])(
    "in %s, points a too-short-key refusal at the button above that replaces the key",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const api = stubApi({
          saveStreamSettings: vi
            .fn()
            .mockRejectedValue({ code: "backup.recovery_key_too_short", params: { min: 12 } }),
        });
        const { el } = await mount(api, { managedByEnvironment: false });
        fillRequired(el);
        await press(el, "save");
        expect(text(el, "[role=alert]")).toContain(t("backup.apply"));
      } finally {
        setLocale(before);
      }
    },
  );

  it.each([
    ["en-GB", "save"],
    ["en-GB", "kit"],
    ["es-ES", "save"],
    ["es-ES", "kit"],
  ] as const)(
    "in %s, sends a %s refused for a too-short key to the box's environment when the environment owns the backup settings",
    async (locale, which) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
        const api =
          which === "save"
            ? stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) })
            : stubApi({ getRecoveryKit: vi.fn().mockRejectedValue(refusal) }, ON);
        const { el } = await mount(api, { managedByEnvironment: true });
        if (which === "save") {
          fillRequired(el);
          await press(el, "save");
        } else {
          await press(el, "show-kit");
        }
        const alert = text(el, "[role=alert]");
        expect(alert).toBe(t("stream.error.recovery_key_too_short_managed"));
        expect(alert).not.toContain(t("backup.apply"));
      } finally {
        setLocale(before);
      }
    },
  );

  it.each([
    ["en-GB", "save"],
    ["en-GB", "kit"],
    ["es-ES", "save"],
    ["es-ES", "kit"],
  ] as const)(
    "in %s, names neither the button nor the environment for a %s refused for a too-short key while the Backups status is not known",
    async (locale, which) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
        const api =
          which === "save"
            ? stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) })
            : stubApi({ getRecoveryKit: vi.fn().mockRejectedValue(refusal) }, ON);
        const { el } = await mount(api);
        expect(el.managedByEnvironment).toBeUndefined();
        if (which === "save") {
          fillRequired(el);
          await press(el, "save");
        } else {
          await press(el, "show-kit");
        }
        const alert = text(el, "[role=alert]");
        expect(alert).toBe(t("stream.error.recovery_key_too_short_unknown"));
        expect(alert).not.toContain(t("backup.apply"));
        expect(alert).not.toMatch(/environment|entorno/i);
      } finally {
        setLocale(before);
      }
    },
  );

  it("explains, in this panel's words, a kit refused because the box holds no recovery key", async () => {
    const api = stubApi(
      { getRecoveryKit: vi.fn().mockRejectedValue({ code: "backup.recovery_key_missing" }) },
      ON,
    );
    const { el } = await mount(api);
    await press(el, "show-kit");
    expect(text(el, "[role=alert]")).toBe(t("stream.error.recovery_key_missing"));
  });

  it("Cancel leaves the bucket as it was", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "change");
    type(el, "bucket-name", "other-bucket");
    await press(el, "cancel");
    expect(q(el, "wt-input")).toBeNull();
    expect(api.saveStreamSettings).not.toHaveBeenCalled();
  });

  it("offers nothing to change on a server that is not the primary", async () => {
    const { el } = await mount(stubApi({}, { ...OFF, isPrimary: false }));
    expect(text(el, "[data-test=not-primary]")).toBe(t("stream.not_primary"));
    expect(el.shadowRoot!.querySelector("wt-input")).toBeNull();
  });

  it("Turn off stops the copy and hides the kit", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "show-kit");
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalled();
    expect(q(el, "[data-test=kit]")).toBeNull();
    expect(field(el, "bucket-region")).not.toBeNull();
  });

  it("keeps the copy on and says why when Turn off is refused", async () => {
    const api = stubApi(
      { turnOffStream: vi.fn().mockRejectedValue({ code: "backup.reload_in_progress" }) },
      ON,
    );
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(text(el, "[role=alert]")).toBe(codeMessage("backup.reload_in_progress"));
    expect(text(el, "[data-test=stream-state]")).toBe(t("stream.state.streaming"));
  });

  it("turns off only on a second, confirming tap", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "turn-off");
    expect(api.turnOffStream).not.toHaveBeenCalled();
    expect(text(el, "[data-test=turn-off]")).toBe(t("stream.turn_off_confirm"));
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalledOnce();
  });

  it("forgets a first Turn off tap when the owner goes to change the bucket instead", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "change");
    await press(el, "cancel");
    expect(text(el, "[data-test=turn-off]")).toBe(t("stream.turn_off"));
    await press(el, "turn-off");
    expect(api.turnOffStream).not.toHaveBeenCalled();
  });

  it("forgets a first Turn off tap when the owner asks for the recovery kit instead", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "show-kit");
    expect(text(el, "[data-test=turn-off]")).toBe(t("stream.turn_off"));
    await press(el, "turn-off");
    expect(api.turnOffStream).not.toHaveBeenCalled();
  });

  it("forgets a first Turn off tap once a read finds the copy turned off elsewhere", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "turn-off");
    await refresh(el, api, OFF);
    await refresh(el, api, ON);
    expect(text(el, "[data-test=turn-off]")).toBe(t("stream.turn_off"));
    await press(el, "turn-off");
    expect(api.turnOffStream).not.toHaveBeenCalled();
  });

  it("keeps a first Turn off tap across a read that finds the copy still on", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "turn-off");
    await refresh(el, api, ON);
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalledOnce();
  });

  it("takes away a refused Turn off's alert when the owner taps Turn off again", async () => {
    const api = stubApi(
      { turnOffStream: vi.fn().mockRejectedValue({ code: "backup.reload_in_progress" }) },
      ON,
    );
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(q(el, "[role=alert]")).not.toBeNull();
    await press(el, "turn-off");
    expect(q(el, "[role=alert]")).toBeNull();
    expect(text(el, "[data-test=turn-off]")).toBe(t("stream.turn_off_confirm"));
  });

  it("holds Turn off while its request is running, so a further tap sends nothing", async () => {
    let finish!: (value: StreamSettingsView) => void;
    const api = stubApi(
      { turnOffStream: vi.fn(() => new Promise<StreamSettingsView>((r) => (finish = r))) },
      ON,
    );
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "turn-off");
    const button = q(el, "[data-test=turn-off]") as HTMLElement & { disabled: boolean };
    expect(button.disabled).toBe(true);
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalledOnce();
    finish(OFF);
    await flush(el);
    expect(field(el, "bucket-region")).not.toBeNull();
  });

  it("holds Show recovery kit while the kit is being fetched", async () => {
    type Kit = { kit: string; keyFingerprint: string };
    let finish!: (value: Kit) => void;
    const api = stubApi({ getRecoveryKit: vi.fn(() => new Promise<Kit>((r) => (finish = r))) }, ON);
    const { el } = await mount(api);
    await press(el, "show-kit");
    const button = q(el, "[data-test=show-kit]") as HTMLElement & { disabled: boolean };
    expect(button.disabled).toBe(true);
    await press(el, "show-kit");
    expect(api.getRecoveryKit).toHaveBeenCalledOnce();
    finish({ kit: KIT, keyFingerprint: "ab12cd34" });
    await flush(el);
    expect(text(el, "[data-test=kit]")).toBe(KIT);
  });

  it("says why when the settings cannot be read", async () => {
    const api = stubApi({
      getStreamSettings: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mount(api);
    expect(text(el, "[role=alert]")).toBe(codeMessage("authorization.not_permitted"));
    expect(q(el, "wt-input")).toBeNull();
  });

  it("fits a phone's width with the kit shown — the kit is one long token", async () => {
    await page.viewport(390, 844);
    try {
      const { el, host } = await mount(stubApi({}, ON));
      await press(el, "show-kit");
      // State the width measured, not the one asked for (testing-guide.md, "A width you set…").
      expect(window.innerWidth).toBe(390);
      expect(el.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      const kit = q(el, "[data-test=kit]")!;
      expect(kit.scrollWidth).toBeLessThanOrEqual(kit.clientWidth);
    } finally {
      await page.viewport(1280, 900);
    }
  });
});

describe("stream-settings-panel: which kit is on screen", () => {
  type Kit = { kit: string; keyFingerprint: string };

  /** A kit read that answers only when the test says so, oldest read first. */
  function heldKit(): {
    read: () => Promise<Kit>;
    answer: (value: Kit) => void;
    refuse: (error: unknown) => void;
  } {
    const waiting: { resolve: (value: Kit) => void; reject: (error: unknown) => void }[] = [];
    return {
      read: () => new Promise<Kit>((resolve, reject) => waiting.push({ resolve, reject })),
      answer: (value) => waiting.shift()!.resolve(value),
      refuse: (error) => waiting.shift()!.reject(error),
    };
  }

  const moved = (
    change: Partial<NonNullable<StreamSettingsView["bucket"]>>,
  ): StreamSettingsView => ({
    ...ON,
    bucket: { ...ON.bucket!, ...change },
  });

  it("keeps the re-issued kit when an earlier Show recovery kit request answers after it", async () => {
    const held = heldKit();
    const api = withBackground(stubApi({ getRecoveryKit: vi.fn(held.read) }, ON));
    vi.mocked(api.background.getRecoveryKit).mockResolvedValue({
      kit: NEW_KIT,
      keyFingerprint: "ffee0011",
    });
    const { el } = await mount(api);
    await press(el, "show-kit");
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    held.answer({ kit: KIT, keyFingerprint: "ab12cd34" });
    await flush(el);
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
  });

  it("shows nothing of a Show recovery kit answer that arrives after the copy was turned off elsewhere", async () => {
    const held = heldKit();
    const api = stubApi({ getRecoveryKit: vi.fn(held.read) }, ON);
    const { el } = await mount(api);
    await press(el, "show-kit");
    await refresh(el, api, OFF);
    held.answer({ kit: KIT, keyFingerprint: "ab12cd34" });
    await flush(el);
    expect(q(el, "[data-test=kit]")).toBeNull();
  });

  it("keeps the kit fetched for the saved bucket when an earlier Show recovery kit request answers after Save", async () => {
    const held = heldKit();
    const api = stubApi({ getRecoveryKit: vi.fn(held.read) }, ON);
    const { el } = await mount(api);
    await press(el, "show-kit");
    await press(el, "change");
    type(el, "bucket-secret-access-key", "not-a-real-secret-0123456789");
    await press(el, "save");
    held.answer({ kit: KIT, keyFingerprint: "ab12cd34" });
    await flush(el);
    expect(q(el, "[data-test=kit]")).toBeNull();
    held.answer({ kit: NEW_KIT, keyFingerprint: "ab12cd34" });
    await flush(el);
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
  });

  it("keeps the kit the owner asked for when an earlier automatic re-issue answers after it", async () => {
    const held = heldKit();
    const api = withBackground(stubApi({}, ON));
    vi.mocked(api.background.getRecoveryKit).mockImplementation(held.read);
    vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    const { el } = await mount(api);
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    await press(el, "show-kit");
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    held.answer({ kit: KIT, keyFingerprint: "ab12cd34" });
    await flush(el);
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
  });

  it.each(["arrives", "fails"] as const)(
    "shows nothing of a re-issue that %s after a read found the bucket changed, and fetches the kit again under the new bucket",
    async (outcome) => {
      const held = heldKit();
      const api = withBackground(stubApi({}, ON));
      vi.mocked(api.background.getRecoveryKit).mockImplementation(held.read);
      const { el } = await mount(api);
      await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
      await refresh(el, api, {
        ...moved({ bucket: "replacement-bucket" }),
        keyFingerprint: "ffee0011",
      });
      expect(api.background.getRecoveryKit).toHaveBeenCalledTimes(2);
      if (outcome === "arrives") held.answer({ kit: KIT, keyFingerprint: "ffee0011" });
      else held.refuse({ code: "connection.failed" });
      await flush(el);
      expect(q(el, "[data-test=kit]")).toBeNull();
      expect(q(el, "[data-test=kit-reissued]")).toBeNull();
      expect(q(el, "[role=alert]")).toBeNull();
      held.answer({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
      await flush(el);
      expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
      expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
    },
  );

  it("fetches the kit again for a changed key when the owner's Show recovery kit overtook the re-issue still running", async () => {
    const held = heldKit();
    const api = withBackground(stubApi({}, ON));
    vi.mocked(api.background.getRecoveryKit).mockImplementation(held.read);
    vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    const { el } = await mount(api);
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    await press(el, "show-kit");
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(api.background.getRecoveryKit).toHaveBeenCalledTimes(2);
    held.answer({ kit: KIT, keyFingerprint: "ffee0011" });
    await flush(el);
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    expect(q(el, "[data-test=kit-reissued]")).toBeNull();
    held.answer({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
    await flush(el);
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
  });

  it.each([
    ["endpoint", { endpoint: "https://s3.example.net" }],
    ["region", { region: "eu-south-2" }],
    ["bucket", { bucket: "replacement-bucket" }],
    ["prefix", { prefix: "venue" }],
    ["accessKeyId", { accessKeyId: "AKIAREPLACEMENT" }],
  ] as const)(
    "takes the kit away, without fetching another, when a read finds the %s changed elsewhere under the same key",
    async (_field, change) => {
      const api = stubApi({}, ON);
      const { el } = await mount(api);
      await press(el, "show-kit");
      await refresh(el, api, moved(change));
      expect(q(el, "[data-test=kit]")).toBeNull();
      expect(q(el, "[data-test=show-kit]")).not.toBeNull();
      expect(api.getRecoveryKit).toHaveBeenCalledOnce();
    },
  );

  it("keeps the kit across a read that finds the same bucket", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "show-kit");
    await refresh(el, api, { ...ON, bucket: { ...ON.bucket! } });
    expect(text(el, "[data-test=kit]")).toBe(KIT);
  });

  it("shows nothing of a Show recovery kit answer requested before a read found the bucket changed", async () => {
    const held = heldKit();
    const api = stubApi({ getRecoveryKit: vi.fn(held.read) }, ON);
    const { el } = await mount(api);
    await press(el, "show-kit");
    await refresh(el, api, moved({ bucket: "replacement-bucket" }));
    held.answer({ kit: KIT, keyFingerprint: "ab12cd34" });
    await flush(el);
    expect(q(el, "[data-test=kit]")).toBeNull();
    expect(q(el, "[data-test=show-kit]")).not.toBeNull();
  });

  it("after a Save whose kit fetch fails, takes the old kit away, offers Show recovery kit, and reports the fetch apart from the save", async () => {
    const changed = moved({ bucket: "replacement-bucket" });
    const api = stubApi({}, ON);
    vi.mocked(api.saveStreamSettings).mockImplementation(() => {
      vi.mocked(api.getStreamSettings).mockResolvedValue(changed);
      return Promise.resolve(changed);
    });
    const { el } = await mount(api);
    await press(el, "show-kit");
    vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
    await press(el, "change");
    type(el, "bucket-name", "replacement-bucket");
    type(el, "bucket-secret-access-key", "not-a-real-secret-0123456789");
    await press(el, "save");
    expect(q(el, "wt-input")).toBeNull();
    expect(q(el, "[data-test=kit]")).toBeNull();
    expect(q(el, "[data-test=show-kit]")).not.toBeNull();
    expect(q(el, "[data-test=refusal]")).toBeNull();
    expect(text(el, "[data-test=kit-failure]")).toBe(codeMessage("connection.failed"));
    // The read Save asks for does not take the kit failure away.
    await refresh(el, api, changed);
    expect(text(el, "[data-test=kit-failure]")).toBe(codeMessage("connection.failed"));
    vi.mocked(api.getRecoveryKit).mockResolvedValue({ kit: NEW_KIT, keyFingerprint: "ab12cd34" });
    await press(el, "show-kit");
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("shows the kit for the latest key, never an earlier key change's, when the key changes again while the first re-issue is running", async () => {
    const held = heldKit();
    const api = withBackground(stubApi({}, ON));
    vi.mocked(api.background.getRecoveryKit).mockImplementation(held.read);
    const { el } = await mount(api);
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "99887766" });
    held.answer({ kit: KIT, keyFingerprint: "ffee0011" });
    await flush(el);
    expect(q(el, "[data-test=kit]")).toBeNull();
    expect(q(el, "[data-test=kit-reissued]")).toBeNull();
    expect(api.background.getRecoveryKit).toHaveBeenCalledTimes(2);
    held.answer({ kit: NEW_KIT, keyFingerprint: "99887766" });
    await flush(el);
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    expect(text(el, "[data-test=kit-reissued]")).toBe(t("stream.kit.reissued"));
    expect(q(el, "[data-test=download-kit]")!.getAttribute("download")).toBe(
      "waitron-recovery-kit-99887766.txt",
    );
  });

  it("does not fetch the latest key's kit a second time when an earlier key change's re-issue settles first", async () => {
    const held = heldKit();
    const api = withBackground(stubApi({}, ON));
    vi.mocked(api.background.getRecoveryKit).mockImplementation(held.read);
    const { el } = await mount(api);
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    await refresh(el, api, { ...ON, keyFingerprint: "99887766" });
    held.answer({ kit: KIT, keyFingerprint: "ffee0011" });
    await flush(el);
    await refresh(el, api, { ...ON, keyFingerprint: "99887766" });
    expect(api.background.getRecoveryKit).toHaveBeenCalledTimes(2);
  });

  it.each(["arrives", "fails"] as const)(
    "shows nothing of a re-issue that %s after a read found the previous key back",
    async (outcome) => {
      let settle!: { resolve: (value: Kit) => void; reject: (error: unknown) => void };
      const api = withBackground(stubApi({}, ON));
      vi.mocked(api.background.getRecoveryKit).mockImplementation(
        () => new Promise<Kit>((resolve, reject) => (settle = { resolve, reject })),
      );
      const { el } = await mount(api);
      await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
      await refresh(el, api, ON);
      if (outcome === "arrives") settle.resolve({ kit: NEW_KIT, keyFingerprint: "ffee0011" });
      else settle.reject({ code: "connection.failed" });
      await flush(el);
      expect(q(el, "[data-test=kit]")).toBeNull();
      expect(q(el, "[data-test=kit-reissued]")).toBeNull();
      expect(q(el, "[role=alert]")).toBeNull();
    },
  );

  it("takes a failed Show recovery kit's alert away once an automatic re-issue shows the new kit", async () => {
    const api = withBackground(stubApi({}, ON));
    vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
    vi.mocked(api.background.getRecoveryKit).mockResolvedValue({
      kit: NEW_KIT,
      keyFingerprint: "ffee0011",
    });
    const { el } = await mount(api);
    await press(el, "show-kit");
    expect(text(el, "[data-test=kit-failure]")).toBe(codeMessage("connection.failed"));
    await refresh(el, api, { ...ON, keyFingerprint: "ffee0011" });
    expect(text(el, "[data-test=kit]")).toBe(NEW_KIT);
    expect(q(el, "[data-test=kit-failure]")).toBeNull();
  });

  it.each([
    ["the copy turned off elsewhere", OFF],
    ["the bucket changed elsewhere", moved({ bucket: "replacement-bucket" })],
  ] as const)(
    "takes a failed Show recovery kit's alert away once a read finds %s",
    async (_n, next) => {
      const api = stubApi({}, ON);
      vi.mocked(api.getRecoveryKit).mockRejectedValue({ code: "connection.failed" });
      const { el } = await mount(api);
      await press(el, "show-kit");
      expect(text(el, "[data-test=kit-failure]")).toBe(codeMessage("connection.failed"));
      await refresh(el, api, next);
      expect(q(el, "[data-test=kit-failure]")).toBeNull();
    },
  );
});
