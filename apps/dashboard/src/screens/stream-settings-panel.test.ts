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
  revision: null,
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
  revision: "0123456789abcdef",
};

function stubApi(overrides: Partial<DashboardApi> = {}, settings = OFF): DashboardApi {
  const getStreamSettings = vi.fn().mockResolvedValue(settings);
  return {
    getStreamSettings,
    // As on the server, a later read of the settings answers what Save or Turn off returned.
    saveStreamSettings: vi.fn(() => {
      getStreamSettings.mockResolvedValue(ON);
      return Promise.resolve(ON);
    }),
    testStreamBucket: vi.fn().mockResolvedValue({ ok: true }),
    turnOffStream: vi.fn(() => {
      getStreamSettings.mockResolvedValue(OFF);
      return Promise.resolve(OFF);
    }),
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
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
async function bottomOf(el: StreamSettingsPanel): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}
const disabled = (el: StreamSettingsPanel, button: string) =>
  q(el, `[data-test=${button}]`)!.hasAttribute("disabled");
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
  it.each([
    [
      "en-GB",
      "The saved bucket settings are incomplete. Change bucket to enter them again, or turn off the copy.",
    ],
    [
      "es-ES",
      "Los ajustes guardados del bucket están incompletos. Cambia de bucket para introducirlos de nuevo o desactiva la copia.",
    ],
  ] as const)("explains incomplete settings and offers repair in %s", async (locale, message) => {
    const before = currentLocale();
    setLocale(locale);
    try {
      const broken: StreamSettingsView = {
        ...ON,
        bucket: null,
        status: { state: "off", reason: "start_failed", stateSince: "2026-09-23T10:15:30.000Z" },
      };
      const { el } = await mount(stubApi({}, broken));
      expect(text(el, "[data-test=settings-incomplete]")).toBe(message);
      expect(q(el, "[data-test=change]")).not.toBeNull();
      expect(q(el, "[data-test=turn-off]")).not.toBeNull();
      await press(el, "change");
      expect(field(el, "bucket-name").value).toBe("");
    } finally {
      setLocale(before);
    }
  });

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

  it("explains every missing field beside it and once above Save, focuses the first, and sends nothing", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    type(el, "bucket-prefix", "venue");
    await press(el, "save");
    expect(api.saveStreamSettings).not.toHaveBeenCalled();
    expect(
      ["bucket-region", "bucket-name", "bucket-access-key-id", "bucket-secret-access-key"].map(
        (name) => field(el, name).error,
      ),
    ).toEqual([
      t("stream.form.region_required"),
      t("stream.form.bucket_required"),
      t("stream.form.access_key_id_required"),
      t("stream.form.secret_access_key_required"),
    ]);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(disabled(el, "save")).toBe(true);
    expect(q(el, "wt-form-error-summary")).toBeNull();
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
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-input")].filter(
        (input) => input.error !== "",
      ),
    ).toHaveLength(4);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
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

  it("puts a refused bucket name beside the bucket field, with the bottom message, focuses it and leaves Save working", async () => {
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
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(disabled(el, "save")).toBe(false);
    expect(disabled(el, "test")).toBe(false);
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
    expect(disabled(el, "test")).toBe(false);
    expect(disabled(el, "save")).toBe(false);
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
    expect(await bottomOf(el)).toBe("");
    expect(disabled(el, "save")).toBe(false);
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
    expect(q(el, "[data-test=change]")).not.toBeNull();
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

  it("says nothing about errors before the first submission, and Save works", async () => {
    const { el } = await mount(stubApi());
    type(el, "bucket-region", "eu-west-1");
    type(el, "bucket-region", "");
    type(el, "bucket-endpoint", "s3.example.net");
    await flush(el);
    expect(field(el, "bucket-region").error).toBe("");
    expect(field(el, "bucket-endpoint").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(disabled(el, "save")).toBe(false);
    expect(disabled(el, "test")).toBe(false);
  });

  it("re-checks every change after a failed submission, and Save works again once all are fixed", async () => {
    const { el } = await mount(stubApi());
    type(el, "bucket-prefix", "venue");
    await press(el, "save");
    type(el, "bucket-region", "eu-west-1");
    await flush(el);
    expect(field(el, "bucket-region").error).toBe("");
    expect(field(el, "bucket-name").error).toBe(t("stream.form.bucket_required"));
    expect(disabled(el, "save")).toBe(true);
    expect(disabled(el, "test")).toBe(true);

    type(el, "bucket-region", " ");
    await flush(el);
    expect(field(el, "bucket-region").error).toBe(t("stream.form.region_required"));

    fillRequired(el);
    await flush(el);
    expect(field(el, "bucket-region").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(disabled(el, "save")).toBe(false);
    expect(disabled(el, "test")).toBe(false);
  });

  it("keeps a refused field's message, with Save working, until that field changes", async () => {
    const api = stubApi({
      saveStreamSettings: vi.fn().mockRejectedValue({
        code: "backup.stream_config_unsafe",
        params: { field: "bucket" },
      }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(disabled(el, "save")).toBe(false);

    type(el, "bucket-region", "eu-west-2");
    await flush(el);
    expect(field(el, "bucket-name").error).toBe(t("stream.field.bucket_characters"));
    expect(disabled(el, "save")).toBe(false);

    type(el, "bucket-name", "venue.copy");
    await flush(el);
    expect(field(el, "bucket-name").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(disabled(el, "save")).toBe(false);
  });

  it("leaves Save working after a refusal that names no field", async () => {
    const api = stubApi({
      saveStreamSettings: vi.fn().mockRejectedValue({ code: "backup.managed_by_environment" }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(disabled(el, "save")).toBe(false);
    await press(el, "save");
    expect(api.saveStreamSettings).toHaveBeenCalledTimes(2);
  });

  it("starts again when the form is cancelled and reopened: no messages and Save working", async () => {
    const { el } = await mount(stubApi(), {});
    await refresh(el, el.api, ON);
    await press(el, "change");
    type(el, "bucket-region", "");
    await press(el, "save");
    expect(field(el, "bucket-region").error).toBe(t("stream.form.region_required"));
    await press(el, "cancel");
    await press(el, "change");
    type(el, "bucket-region", "");
    await flush(el);
    expect(field(el, "bucket-region").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(disabled(el, "save")).toBe(false);
  });

  it("asks a password manager for a new secret, never a saved one", async () => {
    const { el } = await mount(stubApi());
    const inner = field(el, "bucket-secret-access-key").shadowRoot!.querySelector("input")!;
    expect(inner.autocomplete).toBe("new-password");
  });
});

describe("stream-settings-panel: once set up", () => {
  it("keeps no secret after Save: Change opens with it blank and the other fields from the server's answer", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(api.saveStreamSettings).toHaveBeenCalled();
    await press(el, "change");
    expect(field(el, "bucket-secret-access-key").value).toBe("");
    expect(field(el, "bucket-region").value).toBe("eu-west-1");
  });

  it("shows how current the copy is when it is on", async () => {
    const { el } = await mount(stubApi({}, ON));
    expect(text(el, "[data-test=stream-state]")).toBe(t("stream.state.streaming"));
    expect(text(el, "[data-test=stream-lag]")).toBe(t("stream.status.lag_none"));
    expect(text(el, "[data-test=stream-last]")).toBe(
      new Date(STREAMING.lastConfirmedUploadAt).toLocaleString(currentLocale()),
    );
  });

  it("writes the last confirmed copy in the dashboard's language, not the browser's", async () => {
    const at = STREAMING.lastConfirmedUploadAt;
    expect(new Date(at).toLocaleString()).not.toBe(new Date(at).toLocaleString("es-ES"));
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mount(stubApi({}, ON));
      expect(text(el, "[data-test=stream-last]")).toBe(new Date(at).toLocaleString("es-ES"));
    } finally {
      setLocale(before);
    }
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

  it("tells the Backups screen to read its status again once Save has stored the bucket", async () => {
    const api = stubApi();
    const invalidate = vi.spyOn(api.liveData, "invalidate");
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
    expect(invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  });

  it("tells the Backups screen to read the bucket copy again once Turn off has stopped it", async () => {
    const api = stubApi({}, ON);
    const invalidate = vi.spyOn(api.liveData, "invalidate");
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  });

  it("does not tell the Backups screen anything when Turn off is refused", async () => {
    const api = stubApi(
      { turnOffStream: vi.fn().mockRejectedValue({ code: "backup.reload_in_progress" }) },
      ON,
    );
    const invalidate = vi.spyOn(api.liveData, "invalidate");
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
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

  it("explains, in this panel's words, a save refused because the box's recovery key is too short", async () => {
    const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
    const api = stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) });
    const { el } = await mount(api, { managedByEnvironment: false });
    fillRequired(el);
    await press(el, "save");
    expect(text(el, "[role=alert]")).toBe(t("stream.error.recovery_key_too_short"));
  });

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

  it.each(["en-GB", "es-ES"] as const)(
    "in %s, sends a save refused for a too-short key to the box's environment when the environment owns the backup settings",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
        const api = stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) });
        const { el } = await mount(api, { managedByEnvironment: true });
        fillRequired(el);
        await press(el, "save");
        const alert = text(el, "[role=alert]");
        expect(alert).toBe(t("stream.error.recovery_key_too_short_managed"));
        expect(alert).not.toContain(t("backup.apply"));
      } finally {
        setLocale(before);
      }
    },
  );

  it.each(["en-GB", "es-ES"] as const)(
    "in %s, names neither the button nor the environment for a save refused for a too-short key while the Backups status is not known",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
        const api = stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) });
        const { el } = await mount(api);
        expect(el.managedByEnvironment).toBeUndefined();
        fillRequired(el);
        await press(el, "save");
        const alert = text(el, "[role=alert]");
        expect(alert).toBe(t("stream.error.recovery_key_too_short_unknown"));
        expect(alert).not.toContain(t("backup.apply"));
        expect(alert).not.toMatch(/environment|entorno/i);
      } finally {
        setLocale(before);
      }
    },
  );

  it.each(["en-GB", "es-ES"] as const)(
    "in %s, with archives on, points a save refused for a too-short key at Change the recovery key, not Turn on backups",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
        const api = stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) });
        const { el } = await mount(api, { managedByEnvironment: false, archivesEnabled: true });
        fillRequired(el);
        await press(el, "save");
        const alert = text(el, "[role=alert]");
        expect(alert).toContain(t("backup.rotate.title"));
        expect(alert).not.toContain(t("backup.apply"));
      } finally {
        setLocale(before);
      }
    },
  );

  it("with archives off, points a too-short key's refusal at Turn on backups", async () => {
    const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
    const api = stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) });
    const { el } = await mount(api, { managedByEnvironment: false, archivesEnabled: false });
    fillRequired(el);
    await press(el, "save");
    const alert = text(el, "[role=alert]");
    expect(alert).toContain(t("backup.apply"));
    expect(alert).not.toContain(t("backup.rotate.title"));
  });

  it("with archives on but the environment owning the settings, sends a too-short key's refusal to the environment", async () => {
    const refusal = { code: "backup.recovery_key_too_short", params: { min: 12 } };
    const api = stubApi({ saveStreamSettings: vi.fn().mockRejectedValue(refusal) });
    const { el } = await mount(api, { managedByEnvironment: true, archivesEnabled: true });
    fillRequired(el);
    await press(el, "save");
    expect(text(el, "[role=alert]")).toBe(t("stream.error.recovery_key_too_short_managed"));
  });

  it("explains, in this panel's words, a save refused because the box holds no recovery key", async () => {
    const api = stubApi({
      saveStreamSettings: vi.fn().mockRejectedValue({ code: "backup.recovery_key_missing" }),
    });
    const { el } = await mount(api);
    fillRequired(el);
    await press(el, "save");
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

  it("Turn off stops the copy", async () => {
    const api = stubApi({}, ON);
    const { el } = await mount(api);
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalled();
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

  it.each([
    ["en", "Turn off this copy?"],
    ["es-ES", "¿Desactivar esta copia?"],
  ])("turns off only on a second, confirming tap (%s)", async (locale, wording) => {
    const before = currentLocale();
    setLocale(locale);
    try {
      const api = stubApi({}, ON);
      const { el } = await mount(api);
      await press(el, "turn-off");
      expect(api.turnOffStream).not.toHaveBeenCalled();
      expect(text(el, "[data-test=turn-off]")).toBe(wording);
      expect(q(el, "[data-test=turn-off]")?.getAttribute("variant")).toBe("danger");
      await press(el, "turn-off");
      expect(api.turnOffStream).toHaveBeenCalledOnce();
    } finally {
      setLocale(before);
    }
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
    vi.mocked(api.getStreamSettings).mockResolvedValue(OFF);
    finish(OFF);
    await flush(el);
    expect(field(el, "bucket-region")).not.toBeNull();
  });

  it("keeps a new Turn off held when an earlier one sent before the panel was re-added answers", async () => {
    const answers: ((value: StreamSettingsView) => void)[] = [];
    const api = stubApi(
      {
        turnOffStream: vi.fn(
          () => new Promise<StreamSettingsView>((resolve) => answers.push(resolve)),
        ),
      },
      ON,
    );
    const { el, host } = await mount(api);
    await press(el, "turn-off");
    await press(el, "turn-off");
    el.remove();
    host.append(el);
    await flush(el);
    await press(el, "turn-off");
    await press(el, "turn-off");
    expect(api.turnOffStream).toHaveBeenCalledTimes(2);
    answers[0]!(OFF);
    await flush(el);
    const button = q(el, "[data-test=turn-off]") as HTMLElement & { disabled: boolean };
    expect(button.disabled).toBe(true);
  });

  it("says why when the settings cannot be read", async () => {
    const api = stubApi({
      getStreamSettings: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mount(api);
    expect(text(el, "[role=alert]")).toBe(codeMessage("authorization.not_permitted"));
    expect(q(el, "wt-input")).toBeNull();
  });

  it("fits a phone's width with the copy on", async () => {
    await page.viewport(390, 844);
    try {
      const { el, host } = await mount(stubApi({}, ON));
      // State the width measured, not the one asked for (testing-guide.md, "A width you set…").
      expect(window.innerWidth).toBe(390);
      expect(el.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    } finally {
      await page.viewport(1280, 900);
    }
  });
});

describe("A1089 unsafe bucket settings choices", () => {
  for (const locale of ["en-GB", "es-ES"] as const) {
    it(`explains testing and saving corrected settings after a refusal (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const refused = withStatus({ ...STREAMING, state: "refused", reason: "config_unsafe" });
        const api = stubApi({}, refused);
        vi.mocked(api.testStreamBucket).mockRejectedValueOnce({
          code: "backup.stream_config_unsafe",
          params: { field: "prefix" },
        });
        const { el } = await mount(api);
        const message = alertMessage("backup.stream_settings_unusable", {}, locale);
        expect(message).toContain(q(el, "[data-test=change]")!.textContent!.trim());
        await press(el, "change");
        for (const action of ["test", "save", "cancel"]) {
          expect(message).toContain(q(el, `[data-test=${action}]`)!.textContent!.trim());
        }
        type(el, "bucket-secret-access-key", "replacement-test-secret");
        type(el, "bucket-prefix", "saved/../copy");
        await press(el, "test");
        expect(field(el, "bucket-prefix").error).toBe(t("stream.field.prefix_folders"));
        expect(field(el, "bucket-prefix").value).toBe("saved/../copy");
        expect(api.saveStreamSettings).not.toHaveBeenCalled();
        type(el, "bucket-prefix", "saved/copy");
        await press(el, "test");
        expect(text(el, "[data-test=test-passed]")).toBe(t("stream.form.test_passed"));
        expect(api.saveStreamSettings).not.toHaveBeenCalled();
        await press(el, "save");
        expect(api.saveStreamSettings).toHaveBeenCalledExactlyOnceWith({
          endpoint: "",
          region: "eu-west-1",
          bucket: "venue-copy",
          prefix: "saved/copy",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "replacement-test-secret",
        });
        expect(text(el, "[data-test=stream-state]")).toBe(t("stream.state.streaming"));
        expect(q(el, "[data-test=change]")).not.toBeNull();
        expect(api.turnOffStream).not.toHaveBeenCalled();
      } finally {
        setLocale(previous);
      }
    });

    it(`explains cancelling a settings change without a save or shutdown (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const refused = withStatus({ ...STREAMING, state: "refused", reason: "config_unsafe" });
        const api = stubApi({}, refused);
        const { el } = await mount(api);
        const message = alertMessage("backup.stream_settings_unusable", {}, locale);
        expect(message).toContain(t("stream.form.cancel"));
        await press(el, "change");
        type(el, "bucket-prefix", "reconsidered");
        await press(el, "cancel");
        expect(q(el, "[data-test=change]")).not.toBeNull();
        expect(text(el, "[data-test=stream-state]")).toBe(t("stream.state.unusable"));
        expect(api.saveStreamSettings).not.toHaveBeenCalled();
        expect(api.testStreamBucket).not.toHaveBeenCalled();
        expect(api.turnOffStream).not.toHaveBeenCalled();
      } finally {
        setLocale(previous);
      }
    });
  }
});
