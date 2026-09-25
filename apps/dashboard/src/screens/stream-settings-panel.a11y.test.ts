import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, StreamSettingsView } from "../api/client.js";
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
const PAUSED: StreamSettingsView = {
  ...OFF,
  configured: true,
  bucket: {
    endpoint: null,
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "",
    accessKeyId: "AKIAEXAMPLE",
  },
  status: {
    state: "paused",
    generation: "gen-0-n-20260923T101500Z",
    lastConfirmedUploadAt: "2026-09-23T10:16:00.000Z",
    lagMs: 20 * 60_000,
    reason: "side_file_limit",
    stateSince: "2026-09-23T10:15:00.000Z",
    bucketProblem: { reason: "access_denied", since: "2026-09-23T10:15:00.000Z" },
  },
  recoveryKeySet: true,
  keyFingerprint: "ab12cd34",
};

function stubApi(settings: StreamSettingsView): DashboardApi {
  return {
    getStreamSettings: vi.fn().mockResolvedValue(settings),
    testStreamBucket: vi.fn().mockRejectedValue({
      code: "backup.stream_test_failed",
      params: { reason: "write_failed" },
    }),
    saveStreamSettings: vi.fn().mockRejectedValue({
      code: "backup.stream_config_unsafe",
      params: { field: "bucket" },
    }),
    getRecoveryKit: vi
      .fn()
      .mockResolvedValue({ kit: "WAITRON-RECOVERY-KIT-1:abc", keyFingerprint: "ab12cd34" }),
  } as unknown as DashboardApi;
}

async function flush(el: StreamSettingsPanel): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function fillRequired(el: StreamSettingsPanel): void {
  for (const [name, value] of [
    ["bucket-region", "eu-west-1"],
    ["bucket-name", "Venue_Copy"],
    ["bucket-access-key-id", "AKIA"],
    ["bucket-secret-access-key", "secret"],
  ]) {
    el.shadowRoot!.querySelector(`wt-input[name=${name}]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  }
}

describe.each(["light", "dark"] as const)("stream-settings-panel a11y (%s theme)", (theme) => {
  async function mount(settings: StreamSettingsView, props: Partial<StreamSettingsPanel> = {}) {
    const mounted = await mountWidget<StreamSettingsPanel>(
      "dashboard-stream-settings",
      { api: stubApi(settings), ...props },
      theme,
    );
    await flush(mounted.el);
    return mounted;
  }

  it("the empty form", async () => {
    const { host } = await mount(OFF);
    await expectNoA11yViolations(host);
  });

  it("the form after an invalid save, with the summary and field errors", async () => {
    const { el, host } = await mount(OFF);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("the form after the server refused the bucket name", async () => {
    const { el, host } = await mount(OFF);
    fillRequired(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("a failed Test with its alert", async () => {
    const { el, host } = await mount(OFF);
    fillRequired(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=test]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("configured and paused with a failing bucket check, the kit and the re-issue banner", async () => {
    const { el, host } = await mount(PAUSED, { keyFingerprint: "ab12cd34" });
    el.keyFingerprint = "ffee0011";
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("changing the bucket, with Cancel", async () => {
    const { el, host } = await mount(PAUSED);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("the not-primary sentence", async () => {
    const { host } = await mount({ ...OFF, isPrimary: false });
    await expectNoA11yViolations(host);
  });
});
