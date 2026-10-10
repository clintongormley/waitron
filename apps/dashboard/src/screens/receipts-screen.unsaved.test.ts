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
    getVenueDepartments: vi.fn().mockResolvedValue([]),
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
        (
          screen.shadowRoot!.querySelector("[data-test=combined-actions]") as HTMLElement & {
            error: string;
          }
        ).error,
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

for (const [name, changed, original] of [
  ["receiptLanguage", "ca-ES", "es-ES"],
  ["operationDescription", "  Dinner service  ", "Restaurant service"],
] as const) {
  it(`protects ${name} until its exact revert`, async () => {
    const { screen } = await mount();
    await change(screen, name, changed);
    expect(unload()).toBe(true);
    await change(screen, name, original);
    expect(unload()).toBe(false);
  });
  it(`Keep retains ${name} and Discard restores only local receipt drafts`, async () => {
    const { app, screen } = await mount();
    await change(screen, name, changed);
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
    expect(field(screen, name).value).toBe(changed);
    const discarded = request();
    await choose(app, "discard");
    expect(await discarded).toBe("proceeded");
    await screen.updateComplete;
    expect(left).toBe(1);
    expect(field(screen, name).value).toBe(original);
    expect(unload()).toBe(false);
  });
}
it("commits the accepted description before a pending appearance refusal and keeps its exact request body", async () => {
  const receipt = deferred<void>();
  let body: string | undefined;
  const { screen } = await mount({
    putReceipt: () => receipt.promise,
    putLocationSettings: async (value) => {
      body = value;
    },
  });
  await change(screen, "operationDescription", "  Dinner service  ");
  save(screen);
  await expect.poll(() => body).toBe("  Dinner service  ");
  await expect.poll(() => unload()).toBe(false);
  receipt.reject({ code: "connection.failed" });
  await expect
    .poll(() => field(screen, "operationDescription").hasAttribute("disabled"))
    .toBe(false);
  expect(unload()).toBe(false);
});
it("an accepted language commits independently while description refusal retains its draft", async () => {
  const language = deferred<void>();
  let sentLanguage: string | undefined;
  let description: string | undefined;
  const { screen } = await mount({
    putReceiptLanguage: (value) => {
      sentLanguage = value;
      return language.promise;
    },
    putLocationSettings: async (value) => {
      description = value;
      throw { code: "management.request_invalid", params: { field: "operationDescription" } };
    },
  });
  await change(screen, "receiptLanguage", "ca-ES");
  await change(screen, "operationDescription", "Dinner");
  save(screen);
  await expect.poll(() => sentLanguage).toBe("ca-ES");
  expect(description).toBeUndefined();
  language.resolve();
  await expect.poll(() => description).toBe("Dinner");
  await expect
    .poll(() => field(screen, "operationDescription").hasAttribute("disabled"))
    .toBe(false);
  expect(unload()).toBe(true);
  await change(screen, "operationDescription", "Restaurant service");
  expect(unload()).toBe(false);
  await change(screen, "receiptLanguage", "es-ES");
  expect(unload()).toBe(true);
  await change(screen, "receiptLanguage", "ca-ES");
  expect(unload()).toBe(false);
});
it("a refused language keeps both drafts without sending the other parts", async () => {
  let writes = 0;
  const { screen } = await mount({
    putReceiptLanguage: async () => {
      throw { code: "connection.failed" };
    },
    putReceipt: async () => {
      writes++;
    },
    putLocationSettings: async () => {
      writes++;
    },
  });
  await change(screen, "receiptLanguage", "ca-ES");
  await change(screen, "operationDescription", "Dinner");
  save(screen);
  await expect.poll(() => field(screen, "receiptLanguage").hasAttribute("disabled")).toBe(false);
  expect(writes).toBe(0);
  expect(unload()).toBe(true);
  await change(screen, "operationDescription", "Restaurant service");
  expect(unload()).toBe(true);
  await change(screen, "receiptLanguage", "es-ES");
  expect(unload()).toBe(false);
});
it("a later description stays dirty against the submitted snapshot while appearance is still pending", async () => {
  const location = deferred<void>();
  const receipt = deferred<void>();
  let sent: string | undefined;
  const { screen } = await mount({
    putReceipt: () => receipt.promise,
    putLocationSettings: (value) => {
      sent = value;
      return location.promise;
    },
  });
  await change(screen, "operationDescription", "First");
  save(screen);
  await expect.poll(() => sent).toBe("First");
  await change(screen, "operationDescription", "Later");
  location.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(unload()).toBe(true);
  await change(screen, "operationDescription", "First");
  expect(unload()).toBe(false);
  receipt.resolve();
});
it("a later language selection stays dirty against the accepted submitted language", async () => {
  const language = deferred<void>();
  let sent: string | undefined;
  const { screen } = await mount({
    getReceiptLanguage: async () => ({
      language: "es-ES",
      choices: ["es-ES", "ca-ES", "gl-ES"],
      fixed: null,
    }),
    putReceiptLanguage: (value) => {
      sent = value;
      return language.promise;
    },
  });
  await change(screen, "receiptLanguage", "ca-ES");
  save(screen);
  await expect.poll(() => sent).toBe("ca-ES");
  await change(screen, "receiptLanguage", "gl-ES");
  language.resolve();
  await expect.poll(() => field(screen, "receiptLanguage").hasAttribute("disabled")).toBe(false);
  expect(field(screen, "receiptLanguage").value).toBe("gl-ES");
  expect(unload()).toBe(true);
  await change(screen, "receiptLanguage", "ca-ES");
  expect(unload()).toBe(false);
});
it("successful language and description writes abort a pending leave question", async () => {
  const { app, screen } = await mount();
  await change(screen, "receiptLanguage", "ca-ES");
  await change(screen, "operationDescription", "Dinner");
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
  await expect.poll(() => unload()).toBe(false);
});
it("disconnect releases language and description protection and reconnect loads their baselines again", async () => {
  const { app, screen } = await mount();
  await change(screen, "receiptLanguage", "ca-ES");
  await change(screen, "operationDescription", "Dinner");
  expect(unload()).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(screen);
  await expect.poll(() => field(screen, "operationDescription").value).toBe("Restaurant service");
  await expect.poll(() => field(screen, "receiptLanguage").value).toBe("es-ES");
  expect(unload()).toBe(false);
});
for (const part of ["language", "description"] as const) {
  it(`an old accepted ${part} write cannot change or commit a reconnected page`, async () => {
    const write = deferred<void>();
    let writes = 0;
    const { app, screen } = await mount({
      ...(part === "language"
        ? {
            putReceiptLanguage: () => {
              writes++;
              return write.promise;
            },
          }
        : {
            putLocationSettings: () => {
              writes++;
              return write.promise;
            },
          }),
    });
    const name = part === "language" ? "receiptLanguage" : "operationDescription";
    const original = part === "language" ? "es-ES" : "Restaurant service";
    const edited = part === "language" ? "ca-ES" : "Dinner";
    await change(screen, name, edited);
    save(screen);
    await expect.poll(() => writes).toBe(1);
    screen.remove();
    app.shadowRoot!.prepend(screen);
    await expect.poll(() => field(screen, name).value).toBe(original);
    await change(screen, name, edited);
    write.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field(screen, name).value).toBe(edited);
    expect(unload()).toBe(true);
    await change(screen, name, original);
    expect(unload()).toBe(false);
  });
}

it("a description's whitespace is part of the submitted value and an empty invalid draft stays protected", async () => {
  const { screen } = await mount();
  await change(screen, "operationDescription", " Restaurant service ");
  expect(unload()).toBe(true);
  await change(screen, "operationDescription", "");
  expect(unload()).toBe(true);
  await change(screen, "operationDescription", "Restaurant service");
  expect(unload()).toBe(false);
});
for (const dirty of [false, true]) {
  it(`${dirty ? "edited" : "clean"} receipt language and description handle live values without replacing their draft baseline`, async () => {
    let language = "es-ES";
    let description = "Restaurant service";
    let reads = 0;
    const { app, screen, liveData } = await mount({
      getReceiptLanguage: async () => {
        reads++;
        return { language, choices: ["es-ES", "ca-ES", "gl-ES"], fixed: null };
      },
      getLocationSettings: async () => ({ name: "Restaurant", operationDescription: description }),
    });
    if (dirty) {
      await change(screen, "receiptLanguage", "ca-ES");
      await change(screen, "operationDescription", "Dinner");
    }
    language = "gl-ES";
    description = "Elsewhere";
    liveData.invalidate([{ type: "locations" }]);
    await expect.poll(() => reads).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field(screen, "receiptLanguage").value).toBe(dirty ? "ca-ES" : "gl-ES");
    expect(field(screen, "operationDescription").value).toBe(dirty ? "Dinner" : "Elsewhere");
    expect(unload()).toBe(dirty);
    if (dirty) {
      const request = app.leave.coordinator.request({
        scopes: "all",
        reason: "navigation",
        proceed() {},
      });
      await choose(app, "discard");
      expect(await request).toBe("proceeded");
      await screen.updateComplete;
      expect(field(screen, "receiptLanguage").value).toBe("es-ES");
      expect(field(screen, "operationDescription").value).toBe("Restaurant service");
      expect(unload()).toBe(false);
    }
  });
}
it("unchanged location reads do not abort a description leave question", async () => {
  let reads = 0;
  const { app, screen, liveData } = await mount({
    getReceiptLanguage: async () => {
      reads++;
      return { language: "es-ES", choices: ["es-ES", "ca-ES"], fixed: null };
    },
  });
  await change(screen, "operationDescription", "Dinner");
  const request = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => reads).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(field(screen, "operationDescription").value).toBe("Dinner");
});
it("unchanged description reads do not abort a language leave question", async () => {
  let reads = 0;
  const { app, screen, liveData } = await mount({
    getLocationSettings: async () => {
      reads++;
      return { name: "Restaurant", operationDescription: "Restaurant service" };
    },
  });
  await change(screen, "receiptLanguage", "ca-ES");
  const request = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => reads).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(field(screen, "receiptLanguage").value).toBe("ca-ES");
});
it("a successful description and language save stays clean after a subsequent failed location read", async () => {
  let written = false;
  let body: string | undefined;
  let language: string | undefined;
  const { screen, liveData } = await mount({
    putReceiptLanguage: async (value) => {
      language = value;
    },
    putLocationSettings: async (value) => {
      body = value;
      written = true;
    },
    getLocationSettings: async () => {
      if (written) throw { code: "connection.failed" };
      return { name: "Restaurant", operationDescription: "Restaurant service" };
    },
  });
  await change(screen, "receiptLanguage", "ca-ES");
  await change(screen, "operationDescription", " Dinner ");
  save(screen);
  await expect.poll(() => body).toBe(" Dinner ");
  expect(language).toBe("ca-ES");
  await expect.poll(() => unload()).toBe(false);
  liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=retry]")).toBeTruthy();
  expect(unload()).toBe(false);
});

for (const accepted of [true, false]) {
  it(`an older ${accepted ? "accepted" : "refused"} language write leaves the clean reconnected values and status alone`, async () => {
    const language = deferred<void>();
    let writes = 0;
    const { app, screen } = await mount({
      putReceiptLanguage: () => {
        writes++;
        return language.promise;
      },
    });
    await change(screen, "receiptLanguage", "ca-ES");
    save(screen);
    await expect.poll(() => writes).toBe(1);
    screen.remove();
    app.shadowRoot!.prepend(screen);
    await expect.poll(() => field(screen, "receiptLanguage").value).toBe("es-ES");
    if (accepted) language.resolve();
    else language.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field(screen, "receiptLanguage").value).toBe("es-ES");
    expect(
      (
        screen.shadowRoot!.querySelector("[data-test=combined-actions]")! as HTMLElement & {
          error: string;
        }
      ).error,
    ).toBe("");
    expect(unload()).toBe(false);
  });
}

it("a region fixing an edited language makes that read-only choice exempt without committing another receipt part", async () => {
  let fixed = false;
  const { screen, liveData } = await mount({
    getReceiptLanguage: async () => ({
      language: fixed ? "ca-ES" : "es-ES",
      choices: ["es-ES", "ca-ES"],
      fixed: fixed ? { locale: "ca-ES", reason: { en: "Catalan", es: "Catalán" } } : null,
    }),
  });
  await change(screen, "receiptLanguage", "ca-ES");
  expect(unload()).toBe(true);
  fixed = true;
  liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=receiptLanguage]")).toBeNull();
  expect(unload()).toBe(false);
  await change(screen, "operationDescription", "Dinner");
  expect(unload()).toBe(true);
});

it("the independent language action commits only language protection", async () => {
  const writes: string[] = [];
  const { screen } = await mount({
    putReceiptLanguage: async (value) => {
      writes.push(value);
    },
  });
  await change(screen, "receiptLanguage", "ca-ES");
  await change(screen, "operationDescription", "Dinner");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=language-save]")!.click();
  await expect.poll(() => writes).toEqual(["ca-ES"]);
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<import("@waitron/ui").WtButton>(
          "[data-test=language-save]",
        )!.disabled,
    )
    .toBe(true);
  expect(unload()).toBe(true);
  await change(screen, "operationDescription", "Restaurant service");
  expect(unload()).toBe(false);
});
it("the independent description action commits only description protection", async () => {
  const writes: string[] = [];
  const { screen } = await mount({
    putLocationSettings: async (value) => {
      writes.push(value);
    },
  });
  await change(screen, "receiptLanguage", "ca-ES");
  await change(screen, "operationDescription", "Dinner");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=description-save]")!.click();
  await expect.poll(() => writes).toEqual(["Dinner"]);
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<import("@waitron/ui").WtButton>(
          "[data-test=description-save]",
        )!.disabled,
    )
    .toBe(true);
  expect(unload()).toBe(true);
  await change(screen, "receiptLanguage", "es-ES");
  expect(unload()).toBe(false);
});
