import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import { VenueOperationsLoader } from "./venue-operations-loader.js";
customElements.define("a10-venue-operations-loader", class extends VenueOperationsLoader {});

const initialUrl = location.href;
const hosts: HTMLElement[] = [];
function model(name = "Restaurant"): VenueServiceView {
  return {
    departments: [
      { id: "d1", name, tradingName: "Casa", active: true, defaultServiceMode: "prepay" },
      { id: "d2", name: "Deli", tradingName: "Shop", active: false, defaultServiceMode: "prepay" },
    ],
    zones: [],
    floorZones: [],
    salePolicies: { departments: [], zones: [] },
    readiness: [],
    settings: { editSentLines: true },
    kitchenTicketGrouping: "combined",
    printHeldWork: false,
    releaseReminderMinutes: null,
    clearingWorkflow: false,
  };
}
class App extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<a10-venue-operations-loader></a10-venue-operations-loader
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a10-load-ownership-app", App);
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  setLocale("en");
});
async function mount(path = "/manage/venue-operations") {
  history.replaceState(null, "", path);
  setLocale("en");
  let value = model();
  let failRead = false;
  let failWrite = false;
  let pendingRead: Promise<VenueServiceView> | undefined;
  const liveData = new LiveData();
  const request = vi.fn(async (url: string, method = "GET") => {
    if (method !== "GET") {
      if (failWrite) throw { code: "department.name_taken" };
      return { id: "new" };
    }
    if (url === "/management-api/venue-service") {
      if (pendingRead) {
        const pending = pendingRead;
        pendingRead = undefined;
        return pending;
      }
      if (failRead) throw new Error("offline");
      return structuredClone(value);
    }
    if (url === "/management-api/zones?includeInactive=true") return value.floorZones;
    return [];
  });
  const app = document.createElement("a10-load-ownership-app") as App;
  hosts.push(app);
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const loader = app.shadowRoot!.querySelector("a10-venue-operations-loader")! as LitElement & {
    api: VenueServiceApi;
  };
  loader.api = new VenueServiceApi(request as DashboardRequest, liveData);
  await expect
    .poll(() => loader.shadowRoot?.querySelector("venue-departments-shell") ?? null)
    .not.toBeNull();
  const shell = loader.shadowRoot!.querySelector("venue-departments-shell")!;
  await expect.poll(() => shell.model?.departments[0]?.name).toBe("Restaurant");
  await shell.updateComplete;
  return {
    loader,
    shell,
    app,
    request,
    liveData,
    value: (next: VenueServiceView) => {
      value = next;
    },
    readFailure: (failed: boolean) => {
      failRead = failed;
    },
    writeFailure: (failed: boolean) => {
      failWrite = failed;
    },
    deferRead: () => {
      let resolve!: (value: VenueServiceView) => void;
      let reject!: (error: unknown) => void;
      pendingRead = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      return { resolve, reject };
    },
  };
}
function emit(el: HTMLElement, name: string, detail: object = {}) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
const reads = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(
    (call) => call[0] === "/management-api/venue-service" && (call[1] ?? "GET") === "GET",
  ).length;
async function invalidate(liveData: LiveData, request: ReturnType<typeof vi.fn>) {
  const count = reads(request);
  liveData.invalidate([{ type: "departments", id: "d1" }]);
  await expect.poll(() => reads(request)).toBeGreaterThan(count);
}
it("the initial read opens the department list actively and later live reads are passive", async () => {
  const { shell, request, value, liveData } = await mount();
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: false,
  });
  value(model("New live name"));
  await invalidate(liveData, request);
  await expect.poll(() => shell.model.departments[0]!.name).toBe("New live name");
  expect(request).toHaveBeenLastCalledWith(
    "/management-api/zones?includeInactive=true",
    "GET",
    undefined,
    { passive: true },
  );
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: true,
  });
});
it("a live read updates the heading without resetting the dirty Settings draft", async () => {
  const { shell, value, liveData, request } = await mount("/manage/venue-operations/department/d1");
  const page = shell.shadowRoot!.querySelector("department-page")!;
  await page.updateComplete;
  const settings = page.shadowRoot!.querySelector("department-settings")!;
  await settings.updateComplete;
  emit(settings.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "My draft" });
  await settings.updateComplete;
  value(model("New heading"));
  await invalidate(liveData, request);
  await expect.poll(() => page.shadowRoot!.querySelector("h1")!.textContent).toBe("New heading");
  expect(
    settings.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("My draft");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});
it.each(["resolve", "reject"] as const)(
  "an old live read that will %s cannot replace a successful action refresh",
  async (answer) => {
    const { shell, liveData, request, value, deferRead, loader } = await mount();
    const pending = deferRead();
    await invalidate(liveData, request);
    value(model("Saved name"));
    emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
      departmentId: "d2",
    });
    await expect.poll(() => shell.model.departments[0]!.name).toBe("Saved name");
    if (answer === "resolve") pending.resolve(model("Old live name"));
    else pending.reject(new Error("old failure"));
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await loader.updateComplete;
    await shell.updateComplete;
    expect(shell.model.departments[0]!.name).toBe("Saved name");
    expect(loader.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  },
);
it("a failed live read keeps the shown list and its recovery clears the load error", async () => {
  const { shell, loader, readFailure, liveData, request, value } = await mount();
  readFailure(true);
  await invalidate(liveData, request);
  await expect
    .poll(() => loader.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim())
    .toBe("The venue configuration could not be loaded.");
  expect(shell.model.departments[0]!.name).toBe("Restaurant");
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
  readFailure(false);
  value(model("Recovered"));
  await invalidate(liveData, request);
  await expect.poll(() => shell.model.departments[0]!.name).toBe("Recovered");
  expect(loader.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});
it("detaching the load wrapper releases reads and rejects a pending snapshot", async () => {
  const { shell, loader, liveData, request, deferRead } = await mount();
  const pending = deferRead();
  await invalidate(liveData, request);
  loader.remove();
  const count = reads(request);
  expect(liveData.interests).toEqual([]);
  pending.resolve(model("Detached"));
  liveData.invalidate([{ type: "departments", id: "d1" }]);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(reads(request)).toBe(count);
  expect(shell.model.departments[0]!.name).toBe("Restaurant");
});

it("an action refresh updates another cached observer when the change feed is silent", async () => {
  const { shell, loader, value } = await mount();
  const second = document.createElement("a10-venue-operations-loader") as VenueOperationsLoader;
  second.api = loader.api;
  hosts.push(second);
  document.body.append(second);
  await expect
    .poll(
      () => second.shadowRoot?.querySelector("venue-departments-shell")?.model.departments[0]!.name,
    )
    .toBe("Restaurant");
  value(model("Saved without feed"));
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
    departmentId: "d2",
  });
  await expect.poll(() => shell.model.departments[0]!.name).toBe("Saved without feed");
  await expect
    .poll(
      () => second.shadowRoot!.querySelector("venue-departments-shell")!.model.departments[0]!.name,
    )
    .toBe("Saved without feed");
});
it("an initial load failure recovers through a passive live read", async () => {
  history.replaceState(null, "", "/manage/venue-operations");
  const liveData = new LiveData();
  let failed = true;
  const request = vi.fn(async (path: string) => {
    if (path.endsWith("includeInactive=true")) return [];
    if (failed) throw new Error("offline");
    return model();
  });
  const loader = document.createElement("a10-venue-operations-loader") as VenueOperationsLoader;
  loader.api = new VenueServiceApi(request as DashboardRequest, liveData);
  hosts.push(loader);
  document.body.append(loader);
  await expect
    .poll(() => loader.shadowRoot?.querySelector("[role=alert]")?.textContent?.trim())
    .toBe("The venue configuration could not be loaded.");
  expect(loader.shadowRoot!.querySelector("venue-departments-shell")).toBeNull();
  failed = false;
  await invalidate(liveData, request);
  await expect
    .poll(
      () => loader.shadowRoot!.querySelector("venue-departments-shell")?.model.departments[0]!.name,
    )
    .toBe("Restaurant");
  expect(loader.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: true,
  });
});
it("live recovery clears a refresh failure without clearing a later action refusal", async () => {
  const { shell, loader, readFailure, writeFailure, request, liveData } = await mount();
  readFailure(true);
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
    departmentId: "d2",
  });
  await expect
    .poll(() => shell.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim())
    .toBe("The venue configuration could not be loaded.");
  writeFailure(true);
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
    departmentId: "d2",
  });
  await expect
    .poll(() => shell.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim())
    .toBe("The change could not be saved.");
  readFailure(false);
  await invalidate(liveData, request);
  await loader.updateComplete;
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
    "The change could not be saved.",
  );
});
it("a reconnected load wrapper reads passively and retains its Settings draft", async () => {
  const { shell, loader, app, request } = await mount("/manage/venue-operations/department/d1");
  const page = shell.shadowRoot!.querySelector("department-page")!;
  await page.updateComplete;
  const settings = page.shadowRoot!.querySelector("department-settings")!;
  await settings.updateComplete;
  emit(settings.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Retained" });
  await settings.updateComplete;
  const count = reads(request);
  loader.remove();
  app.shadowRoot!.append(loader);
  await expect.poll(() => reads(request)).toBeGreaterThan(count);
  await settings.updateComplete;
  expect(
    settings.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Retained");
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: true,
  });
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it.each(["resolve", "reject"] as const)(
  "a shared live read that will %s retains another observer's action snapshot",
  async (answer) => {
    const { shell, loader, value, deferRead, liveData, request } = await mount();
    const second = document.createElement("a10-venue-operations-loader") as VenueOperationsLoader;
    second.api = loader.api;
    hosts.push(second);
    document.body.append(second);
    await expect
      .poll(
        () =>
          second.shadowRoot?.querySelector("venue-departments-shell")?.model.departments[0]!.name,
      )
      .toBe("Restaurant");
    const other = second.shadowRoot!.querySelector("venue-departments-shell")!;
    await other.updateComplete;
    const pending = deferRead();
    await invalidate(liveData, request);
    value(model("Saved in second observer"));
    emit(other.shadowRoot!.querySelector("departments-list")!, "enable-department", {
      departmentId: "d2",
    });
    await expect.poll(() => other.model.departments[0]!.name).toBe("Saved in second observer");
    // Hold the next cache read so it cannot conceal the old read's result.
    const next = deferRead();
    const count = reads(request);
    if (answer === "resolve") pending.resolve(model("Old shared name"));
    else pending.reject(new Error("old shared failure"));
    await expect.poll(() => reads(request)).toBeGreaterThan(count);
    await loader.updateComplete;
    await second.updateComplete;
    await shell.updateComplete;
    await other.updateComplete;
    const names = [shell.model.departments[0]!.name, other.model.departments[0]!.name];
    const errors = [loader, second].map((el) =>
      el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim(),
    );
    next.resolve(model("Saved in second observer"));
    expect(names).toEqual(["Saved in second observer", "Saved in second observer"]);
    expect(errors).toEqual([undefined, undefined]);
  },
);

it("opening an already cached query displays it without extending the session", async () => {
  history.replaceState(null, "", "/manage/venue-operations");
  const data = new LiveData();
  const request = vi.fn(async (path: string) =>
    path.endsWith("includeInactive=true") ? [] : model("Cached restaurant"),
  );
  const api = new VenueServiceApi(request as DashboardRequest, data);
  const observation = data.observe(
    {
      key: "venue-service:operations",
      dependencies: [{ type: "departments" }],
      read: () => api.background.load(),
    },
    () => {},
  );
  try {
    await expect.poll(() => observation.snapshot.status).toBe("ready");
    const count = request.mock.calls.length;
    const loader = document.createElement("a10-venue-operations-loader") as VenueOperationsLoader;
    loader.api = api;
    hosts.push(loader);
    document.body.append(loader);
    await expect
      .poll(
        () =>
          loader.shadowRoot?.querySelector("venue-departments-shell")?.model.departments[0]!.name,
      )
      .toBe("Cached restaurant");
    expect(request.mock.calls).toHaveLength(count);
  } finally {
    observation.unsubscribe();
  }
});

it.each([
  ["en", "The change could not be saved.", "The venue configuration could not be loaded."],
  ["es", "No se pudo guardar el cambio.", "No se pudo cargar la configuración del local."],
] as const)(
  "an open refused dialog retains its draft through live failure and recovery in %s",
  async (locale, refusal, loadError) => {
    const { shell, loader, liveData, request, value, readFailure } = await mount();
    setLocale(locale);
    emit(shell.shadowRoot!.querySelector("departments-list")!, "add-department");
    await shell.updateComplete;
    const dialog = shell.shadowRoot!.querySelector("department-dialogs")!;
    await dialog.updateComplete;
    const name =
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    emit(name, "wt-change", { value: "Brunch" });
    await dialog.updateComplete;
    request.mockRejectedValueOnce({ code: "connection.failed" });
    const save =
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=save-editor]",
      )!;
    save.click();
    const bottom = async () =>
      (
        await formMessageOf(dialog.shadowRoot!.querySelector("wt-form-actions")!)
      )?.textContent?.trim() ?? "";
    await expect.poll(bottom).toBe(refusal);
    expect(name.error).toBe("");
    expect(save.disabled).toBe(false);
    expect(loader.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(shell.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    readFailure(true);
    await invalidate(liveData, request);
    await expect
      .poll(() => loader.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim())
      .toBe(loadError);
    expect(await bottom()).toBe(refusal);
    expect(name.value).toBe("Brunch");
    expect(dialog.dialog?.kind).toBe("add-department");
    expect(save.disabled).toBe(false);

    readFailure(false);
    value(model("Updated elsewhere"));
    await invalidate(liveData, request);
    await expect.poll(() => shell.model.departments[0]!.name).toBe("Updated elsewhere");
    await dialog.updateComplete;
    expect(await bottom()).toBe(refusal);
    expect(name.value).toBe("Brunch");
    expect(save.disabled).toBe(false);
    expect(loader.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(shell.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1);
  },
);

it("a live failure behind an unsaved dialog leaves its Save message empty", async () => {
  const { shell, loader, liveData, request, readFailure } = await mount();
  emit(shell.shadowRoot!.querySelector("departments-list")!, "add-department");
  await shell.updateComplete;
  const dialog = shell.shadowRoot!.querySelector("department-dialogs")!;
  await dialog.updateComplete;
  emit(dialog.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Brunch" });
  await dialog.updateComplete;
  readFailure(true);
  await invalidate(liveData, request);
  await expect
    .poll(() => loader.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim())
    .toBe("The venue configuration could not be loaded.");
  expect(
    (
      await formMessageOf(dialog.shadowRoot!.querySelector("wt-form-actions")!)
    )?.textContent?.trim() ?? "",
  ).toBe("");
  expect(dialog.dialog?.kind).toBe("add-department");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Brunch");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!
      .disabled,
  ).toBe(false);
  expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(0);
});
