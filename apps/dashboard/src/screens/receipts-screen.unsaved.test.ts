import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, ReceiptConfig } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./receipts-screen.js";

class ReceiptLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-receipts-screen .api=${this.api}></dashboard-receipts-screen>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("receipt-leave-test-app", ReceiptLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-receipts-screen"];
const preview = {
  preview: {
    widthDots: 512,
    columns: 42,
    text: "Restaurant",
    blocks: [{ kind: "text", text: "Restaurant" }],
    qrData: [],
    omittedGraphics: false,
    truncated: false,
    unsupported: false,
  },
  marks: {
    headerSubtitle: null,
    footerMessage: null,
    phone: null,
    email: null,
    address: null,
    logo: null,
  },
  paperWidth: "80mm",
  paperWidths: ["80mm"],
};
async function mount(overrides: Partial<DashboardApi> = {}) {
  const liveData = new LiveData();
  const api = {
    liveData,
    getReceipt: async () => ({ receipt: { headerSubtitle: "Welcome" }, venueAddress: [] }),
    getLocationSettings: async () => ({
      name: "Restaurant",
      operationDescription: "Restaurant service",
    }),
    getReceiptLanguage: async () => ({
      language: "es-ES",
      choices: ["es-ES", "ca-ES"],
      fixed: null,
    }),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
    listDepartments: async () => [],
    previewReceipt: async () => preview,
    putReceipt: async () => {},
    putLocationSettings: async () => {},
    putReceiptLanguage: async () => {},
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<ReceiptLeaveApp>("receipt-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-receipts-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector("[data-test=save]")).toBeTruthy();
  return { app, screen, liveData };
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function field(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<
    HTMLElement & { value: string; checked: boolean; image: string | null }
  >(`[name=${name}], [data-test=${name}]`)!;
}
async function change(screen: Screen, name: string, value: string | boolean | null) {
  const logo = name === "logo";
  const el = logo
    ? screen.shadowRoot!.querySelector("dashboard-image-upload")!
    : field(screen, name);
  el.dispatchEvent(
    new CustomEvent(logo ? "image-changed" : "wt-change", {
      detail: logo ? { image: value } : name === "printAddress" ? { checked: value } : { value },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
}
function save(screen: Screen) {
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
}
async function choose(app: ReceiptLeaveApp, decision: "keep" | "discard") {
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

for (const [name, changed, original] of [
  ["headerSubtitle", "New header", "Welcome"],
  ["footerMessage", "Thank you", ""],
  ["phone", "+34 912345678", ""],
  ["email", "hello@example.com", ""],
  ["printAddress", false, true],
  ["logo", "image-1", null],
] as const) {
  it(`protects ${name} and clears protection on its exact revert`, async () => {
    const { screen } = await mount();
    expect(unload()).toBe(false);
    await change(screen, name, changed);
    expect(unload()).toBe(true);
    await change(screen, name, original);
    expect(unload()).toBe(false);
  });
}
it("compares trimmed appearance values but retains invalid contact values", async () => {
  const { screen } = await mount();
  await change(screen, "headerSubtitle", " Welcome ");
  await change(screen, "footerMessage", "  ");
  expect(unload()).toBe(false);
  await change(screen, "phone", "invalid");
  expect(unload()).toBe(true);
  await change(screen, "phone", "");
  expect(unload()).toBe(false);
});
it("Keep retains appearance values and Discard restores the loaded native controls before leaving", async () => {
  const { app, screen } = await mount();
  await change(screen, "headerSubtitle", "New");
  await change(screen, "printAddress", false);
  let left = 0;
  const request = () =>
    app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        left++;
      },
    });
  const kept = request();
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(left).toBe(0);
  expect(field(screen, "headerSubtitle").value).toBe("New");
  const discarded = request();
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(left).toBe(1);
  expect(field(screen, "headerSubtitle").value).toBe("Welcome");
  expect(
    field(screen, "printAddress").shadowRoot!.querySelector<HTMLInputElement>("input")!.checked,
  ).toBe(true);
  expect(unload()).toBe(false);
});
it("commits an accepted appearance write while the independent location write is still pending and later refuses", async () => {
  const location = deferred<void>();
  let body: ReceiptConfig | undefined;
  const { screen } = await mount({
    putReceipt: async (input) => {
      body = input;
    },
    putLocationSettings: () => location.promise,
  });
  await change(screen, "headerSubtitle", " New ");
  await change(screen, "printAddress", false);
  save(screen);
  await expect.poll(() => body).toEqual({ headerSubtitle: "New", printAddress: false });
  expect(unload()).toBe(false);
  location.reject({ code: "connection.failed" });
  await expect.poll(() => field(screen, "headerSubtitle").hasAttribute("disabled")).toBe(false);
  expect(unload()).toBe(false);
});
it("a refused appearance write retains protection when the independent location write succeeds", async () => {
  const { screen } = await mount({
    putReceipt: async () => {
      throw { code: "connection.failed" };
    },
  });
  await change(screen, "footerMessage", "Thank you");
  save(screen);
  await expect
    .poll(
      () =>
        (screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
          .error,
    )
    .toContain(t("receipts.trim_save_error"));
  expect(unload()).toBe(true);
  expect(field(screen, "footerMessage").value).toBe("Thank you");
});
it("commits the submitted snapshot and keeps later input dirty", async () => {
  const receipt = deferred<void>();
  let body: ReceiptConfig | undefined;
  const { screen } = await mount({
    putReceipt: (input) => {
      body = input;
      return receipt.promise;
    },
  });
  await change(screen, "headerSubtitle", "First");
  save(screen);
  await expect.poll(() => body).toEqual({ headerSubtitle: "First" });
  await change(screen, "headerSubtitle", "Later");
  receipt.resolve();
  await expect.poll(() => field(screen, "headerSubtitle").hasAttribute("disabled")).toBe(false);
  expect(unload()).toBe(true);
  await change(screen, "headerSubtitle", "First");
  expect(unload()).toBe(false);
});
it("disconnect releases appearance protection", async () => {
  const { screen } = await mount();
  await change(screen, "email", "hello@example.com");
  expect(unload()).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
});
it("clean receipt appearance leaves directly", async () => {
  const { app } = await mount();
  let left = 0;
  expect(
    await app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        left++;
      },
    }),
  ).toBe("proceeded");
  expect(left).toBe(1);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

it("saving aborts an outstanding appearance question before the other write finishes", async () => {
  const location = deferred<void>();
  const { app, screen } = await mount({ putLocationSettings: () => location.promise });
  await change(screen, "headerSubtitle", "Saved");
  let left = 0;
  const request = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      left++;
    },
  });
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  save(screen);
  expect(await request).toBe("stale");
  expect(left).toBe(0);
  expect(unload()).toBe(false);
  location.resolve();
});
it("live receipt reads do not replace an edited appearance baseline", async () => {
  let receipt: ReceiptConfig = { headerSubtitle: "Welcome" };
  const { app, screen, liveData } = await mount({
    getReceipt: async () => ({ receipt, venueAddress: [] }),
  });
  await change(screen, "headerSubtitle", "Draft");
  receipt = { headerSubtitle: "Elsewhere" };
  liveData.invalidate([{ type: "tenant_receipts" }]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field(screen, "headerSubtitle").value).toBe("Draft");
  expect(unload()).toBe(true);
  const request = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "headerSubtitle").value).toBe("Welcome");
  expect(unload()).toBe(false);
});
it("an older accepted appearance write cannot commit a reconnected form's draft", async () => {
  const receipt = deferred<void>();
  let writes = 0;
  const { app, screen } = await mount({
    putReceipt: () => {
      writes++;
      return receipt.promise;
    },
  });
  await change(screen, "headerSubtitle", "First");
  save(screen);
  await expect.poll(() => writes).toBe(1);
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await expect
    .poll(() => screen.shadowRoot?.querySelector("[name=headerSubtitle]")?.getAttribute("disabled"))
    .toBe(null);
  await expect.poll(() => field(screen, "headerSubtitle").value).toBe("Welcome");
  await change(screen, "headerSubtitle", "New connection");
  receipt.resolve();
  await expect.poll(() => field(screen, "headerSubtitle").hasAttribute("disabled")).toBe(false);
  expect(unload()).toBe(true);
  await change(screen, "headerSubtitle", "Welcome");
  expect(unload()).toBe(false);
});

it("a clean live receipt refresh remains exempt from leave protection", async () => {
  let receipt: ReceiptConfig = { headerSubtitle: "Welcome" };
  const { app, screen, liveData } = await mount({
    getReceipt: async () => ({ receipt, venueAddress: [] }),
  });
  receipt = { headerSubtitle: "Elsewhere" };
  liveData.invalidate([{ type: "tenant_receipts" }]);
  await expect.poll(() => field(screen, "headerSubtitle").value).toBe("Elsewhere");
  expect(unload()).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  let left = 0;
  expect(
    await app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        left++;
      },
    }),
  ).toBe("proceeded");
  expect(left).toBe(1);
});

it("saves every appearance field in its existing normalized body and stays clean after a failed live refresh", async () => {
  let body: ReceiptConfig | undefined;
  let written = false;
  const { app, screen, liveData } = await mount({
    putReceipt: async (input) => {
      body = input;
      written = true;
    },
    getReceipt: async () => {
      if (written) throw { code: "connection.failed" };
      return { receipt: { headerSubtitle: "Welcome" }, venueAddress: [] };
    },
  });
  await change(screen, "headerSubtitle", " Welcome ");
  await change(screen, "footerMessage", " Thank you ");
  await change(screen, "phone", " +34 912345678 ");
  await change(screen, "email", " hello@example.com ");
  await change(screen, "logo", "image-1");
  await change(screen, "printAddress", false);
  save(screen);
  await expect
    .poll(() => body)
    .toEqual({
      headerSubtitle: "Welcome",
      footerMessage: "Thank you",
      phone: "+34 912345678",
      email: "hello@example.com",
      logo: "image-1",
      printAddress: false,
    });
  await expect.poll(() => field(screen, "headerSubtitle").hasAttribute("disabled")).toBe(false);
  expect(unload()).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  liveData.invalidate([{ type: "tenant_receipts" }]);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=retry]")).toBeTruthy();
  expect(unload()).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
