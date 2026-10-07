import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, StreamBucketBody, StreamSettingsView } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./stream-settings-panel.js";

class StreamLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-stream-settings .api=${this.api}></dashboard-stream-settings>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("stream-leave-test-app", StreamLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Panel = HTMLElementTagNameMap["dashboard-stream-settings"];
const off: StreamSettingsView = {
  isPrimary: true,
  configured: false,
  bucket: null,
  status: { state: "off" },
  recoveryKeySet: false,
  keyFingerprint: null,
};
const on: StreamSettingsView = {
  ...off,
  configured: true,
  bucket: {
    endpoint: null,
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "",
    accessKeyId: "EXAMPLE",
  },
  recoveryKeySet: true,
  keyFingerprint: "abcd1234",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(
  settings = on,
  overrides: Partial<DashboardApi> = {},
  theme: "light" | "dark" = "light",
) {
  const liveData = new LiveData();
  let stored = settings;
  const api = {
    liveData,
    getStreamSettings: async () => stored,
    testStreamBucket: async () => ({ ok: true }),
    getRecoveryKit: async () => ({ kit: "synthetic-kit", keyFingerprint: "abcd1234" }),
    ...overrides,
    saveStreamSettings: async (body: StreamBucketBody) => {
      stored = await (overrides.saveStreamSettings?.(body) ?? Promise.resolve(on));
      return stored;
    },
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<StreamLeaveApp>("stream-leave-test-app", { api }, theme);
  const panel = app.shadowRoot!.querySelector("dashboard-stream-settings")!;
  await expect
    .poll(() =>
      panel.shadowRoot?.querySelector(settings.configured ? "[data-test=change]" : "wt-input"),
    )
    .toBeTruthy();
  if (settings.configured) {
    click(panel, "change");
    await panel.updateComplete;
  }
  return { app, panel, liveData };
}
function input(panel: Panel, name: string) {
  return panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=bucket-${name}]`,
  )!;
}
async function type(panel: Panel, name: string, value: string) {
  input(panel, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await panel.updateComplete;
}
function click(panel: Panel, action: string) {
  panel.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: StreamLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
it("a pristine new bucket leaves without warning", async () => {
  const { app } = await mount(off);
  expect(await leave(app)).toBe("proceeded");
  expect(unload()).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
async function choose(app: StreamLeaveApp, decision: "keep" | "discard") {
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
}
async function fill(panel: Panel) {
  await type(panel, "region", "eu-west-1");
  await type(panel, "name", "venue-copy");
  await type(panel, "access-key-id", "EXAMPLE");
  await type(panel, "secret-access-key", "synthetic secret");
}

it("Cancel keeps the edited native fields until Discard is chosen", async () => {
  const { app, panel } = await mount();
  await type(panel, "prefix", "draft-folder");
  click(panel, "cancel");
  await choose(app, "keep");
  expect(input(panel, "prefix").shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe(
    "draft-folder",
  );
  expect(unload()).toBe(true);
  click(panel, "cancel");
  await choose(app, "discard");
  await expect.poll(() => panel.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(unload()).toBe(false);
  click(panel, "change");
  await panel.updateComplete;
  expect(input(panel, "prefix").value).toBe("");
});

for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`${locale} ${theme} ${width}: native bucket input, Escape, Keep and Discard`, async () => {
        setLocale(locale);
        await page.viewport(width, 850);
        const { app, panel } = await mount(on, {}, theme);
        const host = app.parentElement!;
        const native = input(panel, "prefix").shadowRoot!.querySelector<HTMLInputElement>("input")!;
        await userEvent.fill(native, "draft-folder");
        await panel.updateComplete;
        const cancel = panel
          .shadowRoot!.querySelector("[data-test=cancel]")!
          .shadowRoot!.querySelector("button")!;
        await userEvent.click(cancel);
        const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
        await expect.poll(() => warning.open).toBe(true);
        await warning.updateComplete;
        const modal = warning.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        await commands.parkPointer();
        await expectNoA11yViolations(host);
        await userEvent.keyboard("{Escape}");
        await expect.poll(() => warning.open).toBe(false);
        expect(native.value).toBe("draft-folder");
        expect(unload()).toBe(true);
        await userEvent.click(cancel);
        await expect.poll(() => warning.open).toBe(true);
        await userEvent.click(
          warning
            .shadowRoot!.querySelector("[data-choice=keep]")!
            .shadowRoot!.querySelector("button")!,
        );
        await expect.poll(() => warning.open).toBe(false);
        expect(native.value).toBe("draft-folder");
        await commands.parkPointer();
        await expectNoA11yViolations(host);
        await userEvent.click(cancel);
        await expect.poll(() => warning.open).toBe(true);
        await userEvent.click(
          warning
            .shadowRoot!.querySelector("[data-choice=discard]")!
            .shadowRoot!.querySelector("button")!,
        );
        await expect.poll(() => panel.shadowRoot!.querySelector("wt-input")).toBeNull();
        expect(unload()).toBe(false);
      });
    }

it("a clean or normalized reverted bucket can leave directly", async () => {
  const { app, panel } = await mount();
  expect(await leave(app)).toBe("proceeded");
  await type(panel, "name", "other");
  expect(unload()).toBe(true);
  await type(panel, "name", " venue-copy ");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("the secret compares exact whitespace and a revert removes protection", async () => {
  const { app, panel } = await mount();
  await type(panel, "secret-access-key", " ");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  await type(panel, "secret-access-key", "");
  expect(unload()).toBe(false);
});

it("a new bucket and an invalid endpoint remain protected", async () => {
  const { app, panel } = await mount(off);
  expect(unload()).toBe(false);
  await type(panel, "endpoint", "not a URL");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  expect(input(panel, "endpoint").value).toBe("");
  expect(unload()).toBe(false);
});

it("connection testing sends the normalized body and leaves the draft unsaved", async () => {
  const bodies: StreamBucketBody[] = [];
  const { app, panel } = await mount(off, {
    testStreamBucket: async (body) => {
      bodies.push(body);
      return { ok: true };
    },
  });
  await fill(panel);
  await type(panel, "name", " venue-copy ");
  click(panel, "test");
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=test-passed]")).toBeTruthy();
  expect(bodies).toEqual([
    {
      endpoint: "",
      region: "eu-west-1",
      bucket: "venue-copy",
      prefix: "",
      accessKeyId: "EXAMPLE",
      secretAccessKey: "synthetic secret",
    },
  ]);
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
});

it("a refused settings write retains the values and warning", async () => {
  const { app, panel } = await mount(off, {
    saveStreamSettings: async () => {
      throw { code: "connection.failed" };
    },
  });
  await fill(panel);
  click(panel, "save");
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=refusal]")).toBeTruthy();
  expect(input(panel, "secret-access-key").value).toBe("synthetic secret");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
});

it("an accepted settings write is clean before a failed recovery-kit read", async () => {
  const kit = deferred<{ kit: string; keyFingerprint: string }>();
  const bodies: StreamBucketBody[] = [];
  const { app, panel } = await mount(off, {
    saveStreamSettings: async (body) => {
      bodies.push(body);
      return on;
    },
    getRecoveryKit: () => kit.promise,
  });
  await fill(panel);
  click(panel, "save");
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=change]")).toBeTruthy();
  expect(bodies).toEqual([
    {
      endpoint: "",
      region: "eu-west-1",
      bucket: "venue-copy",
      prefix: "",
      accessKeyId: "EXAMPLE",
      secretAccessKey: "synthetic secret",
    },
  ]);
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
  kit.reject({ code: "connection.failed" });
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=kit-failure]")).toBeTruthy();
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("input made during Save survives and compares against the submitted snapshot", async () => {
  const write = deferred<StreamSettingsView>();
  const { app, panel } = await mount(off, { saveStreamSettings: () => write.promise });
  await fill(panel);
  click(panel, "save");
  await type(panel, "prefix", "later");
  write.resolve(on);
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=kit]")).toBeTruthy();
  expect(input(panel, "prefix")?.value).toBe("later");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  await type(panel, "prefix", "");
  expect(unload()).toBe(false);
});

it("a live settings read retains the edit and its original baseline", async () => {
  let settings = on;
  const { app, panel, liveData } = await mount(on, { getStreamSettings: async () => settings });
  await type(panel, "prefix", "local");
  expect(panel.shadowRoot!.querySelector("[data-test=stream-status]")).not.toBeNull();
  settings = off;
  liveData.invalidate([{ type: "backup_status" }]);
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=stream-status]")).toBeNull();
  expect(input(panel, "prefix").value).toBe("local");
  expect(unload()).toBe(true);
  await type(panel, "prefix", "");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("disconnect releases protection and clears sensitive fields on reconnect", async () => {
  const { app, panel } = await mount();
  await type(panel, "secret-access-key", "synthetic secret");
  expect(unload()).toBe(true);
  panel.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(panel);
  await panel.updateComplete;
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=change]")).toBeTruthy();
  click(panel, "change");
  await panel.updateComplete;
  expect(input(panel, "secret-access-key").value).toBe("");
  expect(unload()).toBe(false);
});

it.each(["success", "refusal"] as const)(
  "an old settings write %s cannot change a reconnected editor",
  async (outcome) => {
    const write = deferred<StreamSettingsView>();
    let kitReads = 0;
    const { app, panel } = await mount(off, {
      saveStreamSettings: () => write.promise,
      getRecoveryKit: async () => {
        kitReads++;
        return { kit: "synthetic-kit", keyFingerprint: "abcd1234" };
      },
    });
    await fill(panel);
    click(panel, "save");
    panel.remove();
    app.shadowRoot!.prepend(panel);
    await expect.poll(() => input(panel, "name")).toBeTruthy();
    await type(panel, "name", "new editor");
    if (outcome === "success") write.resolve(on);
    else write.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await panel.updateComplete;
    expect(input(panel, "name")?.value).toBe("new editor");
    expect(kitReads).toBe(0);
    expect(panel.shadowRoot!.querySelector("[data-test=refusal]")).toBeNull();
    expect(unload()).toBe(true);
  },
);

it.each(["success", "refusal"] as const)(
  "an old bucket test %s cannot affect a reconnected form",
  async (outcome) => {
    const test = deferred<{ ok: true }>();
    const { app, panel } = await mount(off, { testStreamBucket: () => test.promise });
    await fill(panel);
    click(panel, "test");
    panel.remove();
    app.shadowRoot!.prepend(panel);
    await expect.poll(() => input(panel, "name")).toBeTruthy();
    await fill(panel);
    if (outcome === "success") test.resolve({ ok: true });
    else test.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await panel.updateComplete;
    expect(panel.shadowRoot!.querySelector("[data-test=test-passed]")).toBeNull();
    expect(panel.shadowRoot!.querySelector("[data-test=refusal]")).toBeNull();
    expect(unload()).toBe(true);
  },
);

it.each(["success", "refusal"] as const)(
  "an old recovery-kit %s cannot affect a reconnected panel",
  async (outcome) => {
    const kit = deferred<{ kit: string; keyFingerprint: string }>();
    const { app, panel } = await mount(off, { getRecoveryKit: () => kit.promise });
    await fill(panel);
    click(panel, "save");
    await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=change]")).toBeTruthy();
    panel.remove();
    app.shadowRoot!.prepend(panel);
    await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=change]")).toBeTruthy();
    if (outcome === "success") kit.resolve({ kit: "old-kit", keyFingerprint: "abcd1234" });
    else kit.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await panel.updateComplete;
    expect(panel.shadowRoot!.querySelector("[data-test=kit]")).toBeNull();
    expect(panel.shadowRoot!.querySelector("[data-test=kit-failure]")).toBeNull();
    expect(unload()).toBe(false);
  },
);

it("an accepted settings write cancels a pending leave decision", async () => {
  const write = deferred<StreamSettingsView>();
  const { app, panel } = await mount(off, { saveStreamSettings: () => write.promise });
  await fill(panel);
  click(panel, "save");
  const pending = leave(app);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  write.resolve(on);
  expect(await pending).toBe("stale");
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=change]")).toBeTruthy();
  expect(unload()).toBe(false);
});

it("a clean Cancel disposes only the bucket form, retaining another owner's draft", async () => {
  const { app, panel } = await mount();
  let value = "saved";
  const other = app.leave.coordinator.register({
    id: {},
    current: () => value,
    snapshot: (value) => value,
    equal: (a, b) => a === b,
    restore: (saved) => {
      value = saved;
    },
  });
  value = "other draft";
  other.changed();
  click(panel, "cancel");
  await expect.poll(() => panel.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(value).toBe("other draft");
  expect(unload()).toBe(true);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

it.each(["success", "refusal"] as const)(
  "an old Turn off %s cannot replace a reconnected panel's settings",
  async (outcome) => {
    const write = deferred<StreamSettingsView>();
    const { app, panel } = await mount(on, { turnOffStream: () => write.promise });
    click(panel, "cancel");
    await panel.updateComplete;
    click(panel, "turn-off");
    await panel.updateComplete;
    click(panel, "turn-off");
    panel.remove();
    app.shadowRoot!.prepend(panel);
    await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=change]")).toBeTruthy();
    click(panel, "change");
    await panel.updateComplete;
    await type(panel, "prefix", "new draft");
    if (outcome === "success") write.resolve(off);
    else write.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await panel.updateComplete;
    expect(panel.shadowRoot!.querySelector("[data-test=stream-status]")).not.toBeNull();
    expect(panel.shadowRoot!.querySelector("[data-test=refusal]")).toBeNull();
    expect(input(panel, "prefix").value).toBe("new draft");
    expect(unload()).toBe(true);
  },
);

it("an old kit action cannot unlock a newer kit request after reconnect", async () => {
  const first = deferred<{ kit: string; keyFingerprint: string }>();
  const second = deferred<{ kit: string; keyFingerprint: string }>();
  let reads = 0;
  const { app, panel } = await mount(on, {
    getRecoveryKit: () => (++reads === 1 ? first.promise : second.promise),
  });
  click(panel, "cancel");
  await panel.updateComplete;
  click(panel, "show-kit");
  panel.remove();
  app.shadowRoot!.prepend(panel);
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=show-kit]")).toBeTruthy();
  click(panel, "show-kit");
  await panel.updateComplete;
  expect(reads).toBe(2);
  first.resolve({ kit: "old-kit", keyFingerprint: "abcd1234" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await panel.updateComplete;
  expect(panel.shadowRoot!.querySelector("[data-test=show-kit]")!.hasAttribute("disabled")).toBe(
    true,
  );
  expect(panel.shadowRoot!.querySelector("[data-test=kit]")).toBeNull();
  second.resolve({ kit: "new-kit", keyFingerprint: "abcd1234" });
  await expect
    .poll(() => panel.shadowRoot!.querySelector("[data-test=kit]")?.textContent?.trim())
    .toBe("new-kit");
  expect(unload()).toBe(false);
});

it("an old failed settings read cannot replace a reconnected panel's read status", async () => {
  const first = deferred<StreamSettingsView>();
  let reads = 0;
  const liveData = new LiveData();
  const api = {
    liveData,
    getStreamSettings: () => (++reads === 1 ? first.promise : Promise.resolve(off)),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<StreamLeaveApp>("stream-leave-test-app", { api });
  const panel = app.shadowRoot!.querySelector("dashboard-stream-settings")!;
  await expect.poll(() => reads).toBe(1);
  panel.remove();
  app.shadowRoot!.prepend(panel);
  await expect.poll(() => input(panel, "name")).toBeTruthy();
  first.reject({ code: "connection.failed" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await panel.updateComplete;
  expect(panel.shadowRoot!.querySelector("[data-test=read-failure]")).toBeNull();
  expect(unload()).toBe(false);
});
