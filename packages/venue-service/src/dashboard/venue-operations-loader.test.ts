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
      { id: "d1", name, tradingName: "Casa", active: true },
      { id: "d2", name: "Deli", tradingName: "Shop", active: false },
    ],
    zones: [],
    floorZones: [],
    salePolicies: { departments: [], zones: [] },
    readiness: [],
    releaseReminderMinutesByDepartment: {},
    needsClearingDepartmentIds: [],
    lateSendManagerDepartmentIds: [],
    serviceSteps: [],
    courses: [],
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
async function mount(path = "/manage/venue-operations", initial = model()) {
  history.replaceState(null, "", path);
  setLocale("en");
  let value = initial;
  let failRead = false;
  let failWrite = false;
  let pendingRead: Promise<VenueServiceView> | undefined;
  let pendingSave: Promise<VenueServiceView> | undefined;
  const liveData = new LiveData();
  const request = vi.fn(async (url: string, method = "GET", _body?: unknown) => {
    if (method !== "GET") {
      if (failWrite) throw { code: "connection.failed" };
      if (url.endsWith("/settings") && pendingSave) {
        const answer = pendingSave;
        pendingSave = undefined;
        return answer;
      }
      return url.endsWith("/settings") ? structuredClone(value) : { id: "new" };
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
    if (url === "/management-api/zones") return value.floorZones;
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
    deferSave: () => {
      let resolve!: (value: VenueServiceView) => void;
      pendingSave = new Promise((yes) => {
        resolve = yes;
      });
      return { resolve };
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
async function renameDepartment(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  emit(shell.shadowRoot!.querySelector("departments-list")!, "open-department", {
    departmentId: "d1",
  });
  await shell.updateComplete;
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeTruthy();
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await editor.updateComplete;
  const dialog = editor.shadowRoot!.querySelector("department-settings")!;
  await dialog.updateComplete;
  emit(dialog.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Changed name" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=save-editor]")!.click();
  return dialog;
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
  expect(request).toHaveBeenLastCalledWith("/management-api/zones", "GET", undefined, {
    passive: true,
  });
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: true,
  });
});
it("a live read updates the heading without resetting the dirty Settings draft", async () => {
  const { shell, value, liveData, request } = await mount("/manage/venue-operations/department/d1");
  const page = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await page.updateComplete;
  const settings = page.shadowRoot!.querySelector("department-settings")!;
  await settings.updateComplete;
  emit(settings.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "My draft" });
  await settings.updateComplete;
  value(model("New heading"));
  await invalidate(liveData, request);
  await expect
    .poll(() => page.shadowRoot!.querySelector("wt-modal")!.heading)
    .toBe("Edit department: New heading");
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
    await renameDepartment(shell);
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
  await renameDepartment(shell);
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
    if (path.endsWith("/management-api/zones")) return [];
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
  await renameDepartment(shell);
  await expect
    .poll(() => shell.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim())
    .toBe("The venue configuration could not be loaded.");
  writeFailure(true);
  const dialog = await renameDepartment(shell);
  const bottom = async () =>
    (
      await formMessageOf(dialog.shadowRoot!.querySelector("wt-form-actions")!)
    )?.textContent?.trim() ?? "";
  await expect.poll(bottom).toBe("The change could not be saved.");
  expect(shell.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
    "The venue configuration could not be loaded.",
  );
  readFailure(false);
  await invalidate(liveData, request);
  await loader.updateComplete;
  await shell.updateComplete;
  expect(await bottom()).toBe("The change could not be saved.");
  expect(shell.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Changed name");
});
it("a reconnected load wrapper reads passively and retains its Settings draft", async () => {
  const { shell, loader, app, request } = await mount("/manage/venue-operations/department/d1");
  const page = shell.shadowRoot!.querySelector("department-edit-dialog")!;
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
    await renameDepartment(other);
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
    path.endsWith("/management-api/zones") ? [] : model("Cached restaurant"),
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

it("receipt changes refresh department description setup passively", async () => {
  const { shell, request, value, liveData } = await mount();
  const next = model();
  next.readiness.push(
    Object.assign(
      {},
      {
        code: "department.operation_description_required" as const,
        departmentId: "d1",
        departmentName: "Restaurant",
      },
    ),
  );
  value(next);
  const count = reads(request);
  liveData.invalidate([{ type: "department_receipts", id: "d1" }]);
  await expect.poll(() => reads(request)).toBeGreaterThan(count);
  await expect
    .poll(() => shell.model.readiness)
    .toEqual([
      {
        code: "department.operation_description_required" as const,
        departmentId: "d1",
        departmentName: "Restaurant",
      },
    ]);
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: true,
  });
  value(model());
  liveData.invalidate([{ type: "department_receipts", id: "d1" }]);
  await expect.poll(() => shell.model.readiness).toEqual([]);
});

async function openSettings(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await editor.updateComplete;
  const form = editor.shadowRoot!.querySelector("department-settings")!;
  await form.updateComplete;
  return form;
}
const inputValue = (form: HTMLElementTagNameMap["department-settings"], name: string) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!.value;
function submit(form: HTMLElementTagNameMap["department-settings"]) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
}
async function reopen(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  emit(shell.shadowRoot!.querySelector("departments-list")!, "open-department", {
    departmentId: "d1",
  });
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeTruthy();
  return openSettings(shell);
}
it.each(["live", "one-off"] as const)(
  "an older %s read cannot take back a saved department name when its refresh fails",
  async (kind) => {
    const { shell, request, liveData, value, deferRead, deferSave, readFailure } = await mount(
      "/manage/venue-operations/department/d1",
    );
    const form = await openSettings(shell);
    const saved = deferSave();
    const pending = deferRead();
    if (kind === "live") await invalidate(liveData, request);
    value(model("Restaurant revised"));
    emit(form.shadowRoot!.querySelector("[name=name]")!, "wt-change", {
      value: "Restaurant revised",
    });
    await form.updateComplete;
    submit(form);
    await expect
      .poll(() =>
        request.mock.calls.some(([path, method]) => path.endsWith("/settings") && method === "PUT"),
      )
      .toBe(true);
    if (kind === "one-off") {
      emit(shell.shadowRoot!.querySelector("department-edit-dialog")!, "written");
      await expect.poll(() => reads(request)).toBe(2);
    }
    readFailure(true);
    saved.resolve(model("Restaurant revised"));
    pending.resolve(model("Restaurant"));
    await expect.poll(() => shell.model.departments[0]!.name).toBe("Restaurant revised");
    const shown = await reopen(shell);
    await expect.poll(() => inputValue(shown, "name")).toBe("Restaurant revised");
    value(model("Another manager"));
    readFailure(false);
    await invalidate(liveData, request);
    await expect.poll(() => inputValue(shown, "name")).toBe("Another manager");
  },
);
it("an older live copy cannot remove a saved Coffee step from the next save", async () => {
  const initial = model();
  initial.serviceSteps = [
    { id: "s1", departmentId: "d1", name: "Set up", start: "seated", courseId: null, minutes: 0 },
    {
      id: "s2",
      departmentId: "d1",
      name: "Take order",
      start: "after_previous",
      courseId: null,
      minutes: 2,
    },
    {
      id: "s3",
      departmentId: "d1",
      name: "Dessert?",
      start: "after_previous",
      courseId: null,
      minutes: 10,
    },
  ];
  const { shell, request, liveData, value, deferRead, readFailure } = await mount(
    "/manage/venue-operations/department/d1/view/service",
    initial,
  );
  const form = await openSettings(shell);
  const steps = form.shadowRoot!.querySelector("department-service-steps")!;
  await steps.updateComplete;
  steps.shadowRoot!.querySelector<HTMLElement>("[data-test=add-service-step]")!.click();
  await steps.updateComplete;
  await form.updateComplete;
  await steps.updateComplete;
  const names =
    steps.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("[name=serviceStepName]");
  emit(names[3]!, "wt-change", { value: "Coffee" });
  await form.updateComplete;
  const pending = deferRead();
  await invalidate(liveData, request);
  const saved = structuredClone(initial);
  saved.serviceSteps.push({
    id: "coffee-saved",
    departmentId: "d1",
    name: "Coffee",
    start: "after_previous",
    courseId: null,
    minutes: 0,
  });
  value(saved);
  readFailure(true);
  submit(form);
  await expect
    .poll(() => request.mock.calls.filter(([, method]) => method === "PUT").length)
    .toBe(1);
  pending.resolve(initial);
  await expect
    .poll(() => shell.model.serviceSteps.map((step) => step.name))
    .toEqual(["Set up", "Take order", "Dessert?", "Coffee"]);
  const shown = await reopen(shell);
  emit(shown.shadowRoot!.querySelector("[name=tradingName]")!, "wt-change", {
    value: "New receipt name",
  });
  await shown.updateComplete;
  const list = shown.shadowRoot!.querySelector("department-service-steps")!;
  await list.updateComplete;
  expect(list.steps.map((step) => step.name)).toEqual([
    "Set up",
    "Take order",
    "Dessert?",
    "Coffee",
  ]);
  list.shadowRoot!.querySelector<HTMLElement>("[data-test=add-service-step]")!.click();
  await shown.updateComplete;
  await list.updateComplete;
  emit(list.shadowRoot!.querySelectorAll("[name=serviceStepName]")[4] as HTMLElement, "wt-change", {
    value: "Tea",
  });
  await shown.updateComplete;
  submit(shown);
  await expect
    .poll(() => request.mock.calls.filter(([, method]) => method === "PUT").length)
    .toBe(2);
  const second = request.mock.calls.filter(([, method]) => method === "PUT")[1]![2] as {
    serviceSteps: unknown[];
  };
  expect(second.serviceSteps).toEqual([
    ...initial.serviceSteps.map(({ departmentId: _departmentId, ...step }) => step),
    { id: "coffee-saved", name: "Coffee", start: "after_previous", courseId: null, minutes: 0 },
    { name: "Tea", start: "after_previous", courseId: null, minutes: 0 },
  ]);
});

it("a department save answered after leaving still updates the shared snapshot", async () => {
  const { shell, loader, request, value, deferSave } = await mount(
    "/manage/venue-operations/department/d1",
  );
  const form = await openSettings(shell);
  const saved = deferSave();
  emit(form.shadowRoot!.querySelector("[name=name]")!, "wt-change", {
    value: "Restaurant revised",
  });
  await form.updateComplete;
  submit(form);
  await expect.poll(() => request.mock.calls.some(([, method]) => method === "PUT")).toBe(true);
  loader.remove();
  const before = reads(request);
  value(model("Restaurant revised"));
  saved.resolve(model("Restaurant revised"));
  await expect.poll(() => shell.model.departments[0]!.name).toBe("Restaurant revised");
  await loader.updateComplete;
  expect(reads(request)).toBe(before);
  const second = document.createElement("a10-venue-operations-loader") as VenueOperationsLoader;
  second.api = loader.api;
  hosts.push(second);
  document.body.append(second);
  await expect
    .poll(
      () => second.shadowRoot?.querySelector("venue-departments-shell")?.model.departments[0]!.name,
    )
    .toBe("Restaurant revised");
});
