import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { SetupApi, type RecoveryBackupPreview } from "../api/client.js";
import type { BucketRestoreRequestDetail } from "../events.js";
import { cleanupWidgets, mountWidget, reviewBackup } from "../widgets/test-helpers.js";
import { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";

const preview: RecoveryBackupPreview = {
  sourceId: "selected-generation",
  createdAt: "2026-10-18T12:00:00Z",
  environment: "production",
  nodeId: "saved-node",
  nodeRecoveryKeyName: "Saved key",
  taxpayer: { legalName: "Olivo SL", taxId: "89890001K" },
  venueName: "Centro",
};
afterEach(cleanupWidgets);
const copy = (el: SetupRestoreBucketScreen) =>
  el.shadowRoot!.querySelector<LitElement>("setup-recovery-copy")!;
const box = (el: SetupRestoreBucketScreen) =>
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=venue-confirmed]");
function change(el: SetupRestoreBucketScreen, field: string, value: string) {
  el.shadowRoot!.querySelector(`[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
async function review(el: SetupRestoreBucketScreen) {
  copy(el).shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await copy(el).updateComplete;
  await vi.waitFor(() => expect(copy(el).shadowRoot!.textContent).toContain("Saved key"));
  await el.updateComplete;
}
async function mount() {
  const { el, host } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
    api: new SetupApi("", async () => Response.json(preview)),
  });
  change(el, "kit", "selected-private-kit");
  await el.updateComplete;
  await copy(el).updateComplete;
  await review(el);
  return { el, host };
}
function check(input: HTMLInputElement) {
  input.checked = true;
  input.dispatchEvent(new Event("change"));
}
it("confirms the reviewed bucket business before the first restore request", async () => {
  const { el, host } = await mount();
  expect(
    box(el),
    "the validated preview offers business confirmation before submitting",
  ).not.toBeNull();
  expect(box(el)!.checked).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=venue]")!.textContent).toContain("Olivo SL");
  const requests: BucketRestoreRequestDetail[] = [];
  host.addEventListener("bucket-restore-requested", (event) => {
    requests.push((event as CustomEvent<{ request: BucketRestoreRequestDetail }>).detail.request);
  });
  check(el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=acknowledge]")!);
  await reviewBackup(el, preview);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
  await el.updateComplete;
  expect(requests).toEqual([]);
  check(box(el)!);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.venueConfirmed).toBe("89890001K");
});
it.each(["kit", "environment", "api", "review"])(
  "drops the preview's business confirmation after changing %s",
  async (field) => {
    const { el } = await mount();
    expect(box(el)).not.toBeNull();
    check(box(el)!);
    await el.updateComplete;
    if (field === "kit") change(el, field, "different-private-kit");
    else if (field === "environment") change(el, field, "preproduction");
    else if (field === "api") el.api = new SetupApi("", async () => Response.json(preview));
    else await review(el);
    await el.updateComplete;
    await copy(el).updateComplete;
    await el.updateComplete;
    if (field !== "review") {
      expect(box(el)).toBeNull();
      await review(el);
    }
    expect(box(el)!.checked).toBe(false);
  },
);

it("does not restore business confirmation from a late response for the previous kit", async () => {
  let finish!: (response: Response) => void;
  let read!: Promise<string>;
  const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
    api: new SetupApi(
      "",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  });
  change(el, "kit", "first-kit");
  await el.updateComplete;
  await copy(el).updateComplete;
  copy(el).shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() => expect(finish).toBeDefined());
  change(el, "kit", "replacement-kit");
  await el.updateComplete;
  await copy(el).updateComplete;
  const response = Response.json(preview);
  const original = response.text.bind(response);
  vi.spyOn(response, "text").mockImplementation(() => (read = original()));
  finish(response);
  await vi.waitFor(() => expect(read).toBeDefined());
  await read;
  await copy(el).updateComplete;
  await el.updateComplete;
  expect(box(el)).toBeNull();
  expect(copy(el).shadowRoot!.textContent).not.toContain("Saved key");
});

it.each(["kit", "environment"])(
  "does not submit the previous business confirmation when %s changes before render",
  async (field) => {
    const { el, host } = await mount();
    expect(box(el)).not.toBeNull();
    check(box(el)!);
    check(el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=acknowledge]")!);
    await el.updateComplete;
    const requests: BucketRestoreRequestDetail[] = [];
    host.addEventListener("bucket-restore-requested", (event) => {
      requests.push((event as CustomEvent<{ request: BucketRestoreRequestDetail }>).detail.request);
    });
    change(el, field, field === "kit" ? "replacement-kit" : "preproduction");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
    expect(requests.map((request) => request.venueConfirmed)).not.toContain("89890001K");
  },
);

/** A bucket preview that refuses any environment but the copy's own, as `restore-gate.ts` does. */
function previewsAs(copyEnvironment: "production" | "preproduction", refusal?: object) {
  const sent: string[] = [];
  const api = new SetupApi("", async (_input, init) => {
    const { environment } = JSON.parse(String(init!.body)) as { environment: string };
    sent.push(environment);
    if (refusal !== undefined) return Response.json({ error: refusal }, { status: 422 });
    if (environment !== copyEnvironment)
      return Response.json(
        {
          error: {
            code: "restore.environment_mismatch",
            params: { backup: copyEnvironment, target: environment },
          },
        },
        { status: 409 },
      );
    return Response.json({ ...preview, environment: copyEnvironment });
  });
  return { api, sent };
}

async function mountWith(api: SetupApi) {
  const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
    api,
  });
  change(el, "kit", "selected-private-kit");
  await el.updateComplete;
  await copy(el).updateComplete;
  return el;
}

const environmentField = (el: SetupRestoreBucketScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { value: string; error: string }>(
    "[data-test=environment]",
  )!;

it("takes a pre-production copy's environment from one Review press, with no error shown", async () => {
  const { api, sent } = previewsAs("preproduction");
  const el = await mountWith(api);
  expect(environmentField(el).value).toBe("production");
  await review(el);
  expect(sent).toEqual(["production", "preproduction"]);
  expect(environmentField(el).value).toBe("preproduction");
  expect(environmentField(el).error).toBe("");
  expect(el.shadowRoot!.textContent).not.toContain("Check the backup environment.");
  expect(copy(el).shadowRoot!.textContent).not.toContain("Check the backup environment.");
});

it("leaves the environment alone when Review is refused for another reason", async () => {
  const { api, sent } = previewsAs("preproduction", { code: "backup.stream_kit_invalid" });
  const el = await mountWith(api);
  copy(el).shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[data-test=kit]")!.error,
    ).toBe("Check the recovery pack or kit file."),
  );
  expect(sent).toEqual(["production"]);
  expect(environmentField(el).value).toBe("production");
});

it("shows the environment refusal when it does not name the copy's environment", async () => {
  const { api, sent } = previewsAs("preproduction", { code: "restore.environment_mismatch" });
  const el = await mountWith(api);
  copy(el).shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() => expect(environmentField(el).error).toBe("Check the backup environment."));
  expect(sent).toEqual(["production"]);
  expect(environmentField(el).value).toBe("production");
});

it("switches the environment once per edit, however the refusals disagree", async () => {
  const sent: string[] = [];
  const api = new SetupApi("", async (_input, init) => {
    const { environment } = JSON.parse(String(init!.body)) as { environment: string };
    sent.push(environment);
    const backup = environment === "production" ? "preproduction" : "production";
    return Response.json(
      { error: { code: "restore.environment_mismatch", params: { backup, target: environment } } },
      { status: 409 },
    );
  });
  const el = await mountWith(api);
  copy(el).shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() => expect(environmentField(el).error).toBe("Check the backup environment."));
  expect(sent).toEqual(["production", "preproduction"]);
});
