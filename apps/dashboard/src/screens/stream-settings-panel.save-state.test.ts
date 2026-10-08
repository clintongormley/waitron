import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, StreamBucketBody, StreamSettingsView } from "../api/client.js";
import type { StreamSettingsPanel } from "./stream-settings-panel.js";
import "./stream-settings-panel.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const OFF: StreamSettingsView = {
  isPrimary: true,
  configured: false,
  bucket: null,
  status: { state: "off" },
  recoveryKeySet: false,
  keyFingerprint: null,
};
// Every bucket field holds something, so a field that rewrites its value on first draw shows as a change.
const ON: StreamSettingsView = {
  isPrimary: true,
  configured: true,
  bucket: {
    endpoint: "https://s3.example.com",
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "venue/main",
    accessKeyId: "AKIAEXAMPLE",
  },
  status: {
    state: "streaming",
    generation: "gen-0-n-20260923T101500Z",
    reason: null,
    stateSince: "2026-09-23T10:15:30.000Z",
    bucketProblem: null,
    lastConfirmedUploadAt: "2026-09-23T10:16:00.000Z",
    lagMs: 0,
  },
  recoveryKeySet: true,
  keyFingerprint: "ab12cd34",
};
const SECRET = "not-a-real-secret-0123456789";

function stubApi(settings: StreamSettingsView, overrides: Partial<DashboardApi> = {}) {
  return {
    getStreamSettings: vi.fn().mockResolvedValue(settings),
    saveStreamSettings: vi.fn().mockResolvedValue(ON),
    testStreamBucket: vi.fn().mockResolvedValue({ ok: true }),
    turnOffStream: vi.fn().mockResolvedValue(OFF),
    getRecoveryKit: vi.fn().mockResolvedValue({ kit: "KIT", keyFingerprint: "ab12cd34" }),
    liveData: new LiveData(),
    ...overrides,
  } as unknown as DashboardApi;
}

const q = <T extends HTMLElement = HTMLElement>(el: StreamSettingsPanel, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
async function settle(el: StreamSettingsPanel) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}
async function mount(api: DashboardApi) {
  setLocale("en-GB");
  const { el } = await mountWidget<StreamSettingsPanel>("dashboard-stream-settings", { api });
  await settle(el);
  return el;
}
async function openEditor(api: DashboardApi) {
  const el = await mount(api);
  q(el, "[data-test=change]")!.click();
  await settle(el);
  expect(q(el, "wt-input[name=bucket-name]")).not.toBeNull();
  return el;
}

function save(el: StreamSettingsPanel) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: StreamSettingsPanel) {
  await settle(el);
  const action = save(el);
  await action.updateComplete;
  return {
    variant: action.variant,
    disabled: action.disabled,
    innerDisabled: action.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on Save's inner button; `force` presses a disabled one too. */
async function press(el: StreamSettingsPanel) {
  await userEvent.click(page.elementLocator(save(el).shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await settle(el);
}
async function type(el: StreamSettingsPanel, name: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await settle(el);
}
function errors(el: StreamSettingsPanel): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input")]
    .map((input) => input.error)
    .filter((error) => error !== "");
}

it("a new bucket opens with Save quiet, and neither a press nor a host click marks or sends anything", async () => {
  const api = stubApi(OFF);
  const el = await mount(api);
  expect(await state(el)).toEqual(quiet);
  await press(el);
  save(el).click();
  await settle(el);
  expect(api.saveStreamSettings).not.toHaveBeenCalled();
  expect(errors(el)).toEqual([]);
});

it("the stored bucket opens with Save quiet, and neither a press nor a host click marks or sends anything", async () => {
  const api = stubApi(ON);
  const el = await openEditor(api);
  expect(await state(el)).toEqual(quiet);
  await press(el);
  save(el).click();
  await settle(el);
  expect(api.saveStreamSettings).not.toHaveBeenCalled();
  expect(errors(el)).toEqual([]);
});

it.each([
  ["bucket-endpoint", "https://s3.example.com", "https://other.example.com"],
  ["bucket-region", "eu-west-1", "eu-south-2"],
  ["bucket-name", "venue-copy", "venue-copy-2"],
  ["bucket-prefix", "venue/main", "venue/other"],
  ["bucket-access-key-id", "AKIAEXAMPLE", "AKIAOTHER"],
  ["bucket-secret-access-key", "", SECRET],
])(
  "an edit of %s wakes Save, and typing the stored value back quiets it",
  async (name, stored, edit) => {
    const el = await openEditor(stubApi(ON));
    await type(el, name, edit);
    expect((await state(el)).variant).toBe("primary");
    await type(el, name, stored);
    expect(await state(el)).toEqual(quiet);
  },
);

it("typing the secret, the one field an edit must fill, makes Save ready and sends the stored fields beside it", async () => {
  const api = stubApi(ON);
  const el = await openEditor(api);
  await type(el, "bucket-secret-access-key", SECRET);
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(api.saveStreamSettings).toHaveBeenCalledExactlyOnceWith({
    endpoint: "https://s3.example.com",
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "venue/main",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: SECRET,
  } satisfies StreamBucketBody);
});

it("a changed form its own checks refuse stays primary and disabled", async () => {
  const api = stubApi(ON);
  const el = await openEditor(api);
  await type(el, "bucket-endpoint", "s3.example.com");
  await press(el);
  expect(api.saveStreamSettings).not.toHaveBeenCalled();
  expect(errors(el).length).toBeGreaterThan(0);
  expect(await state(el)).toEqual(blocked);
});

it("after a save the person kept editing through, Save is quiet once the sent value is typed back", async () => {
  let finish!: (value: StreamSettingsView) => void;
  const api = stubApi(OFF, {
    saveStreamSettings: vi.fn(
      () =>
        new Promise<StreamSettingsView>((resolve) => {
          finish = resolve;
        }),
    ),
  });
  const el = await mount(api);
  await type(el, "bucket-region", "eu-west-1");
  await type(el, "bucket-name", "venue-copy");
  await type(el, "bucket-access-key-id", "AKIAEXAMPLE");
  await type(el, "bucket-secret-access-key", SECRET);
  await press(el);
  expect(api.saveStreamSettings).toHaveBeenCalledOnce();
  await type(el, "bucket-prefix", "later");
  finish(ON);
  await settle(el);
  expect(q(el, "wt-input[name=bucket-prefix]")).not.toBeNull();
  expect(await state(el)).toEqual(ready);
  await type(el, "bucket-prefix", "");
  expect(await state(el)).toEqual(quiet);
  await press(el);
  save(el).click();
  await settle(el);
  expect(api.saveStreamSettings).toHaveBeenCalledOnce();
});

it("after turning the copy off, the new-bucket form opens quiet and an edit wakes Save", async () => {
  const el = await mount(stubApi(ON));
  q(el, "[data-test=turn-off]")!.click();
  await settle(el);
  q(el, "[data-test=turn-off]")!.click();
  await settle(el);
  expect(q(el, "wt-input[name=bucket-name]")).not.toBeNull();
  expect(await state(el)).toEqual(quiet);
  await type(el, "bucket-name", "venue-copy");
  expect((await state(el)).variant).toBe("primary");
});

it("a new-bucket form another read replaced opens Change quiet over the stored bucket", async () => {
  const api = stubApi(OFF);
  const el = await mount(api);
  vi.mocked(api.getStreamSettings).mockResolvedValue(ON);
  api.liveData.invalidate([{ type: "backup_status" }]);
  await settle(el);
  q(el, "[data-test=change]")!.click();
  await settle(el);
  expect(await state(el)).toEqual(quiet);
});
