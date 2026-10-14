import { LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { SetupApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";
import { SetupCloudRestoreScreen } from "./cloud-restore-screen.js";
import "./recovery-copy.js";

const saved = {
  sourceId: "copy-id",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "preproduction",
  nodeId: "saved-node",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  locationName: "Saved location",
};
const approved = {
  requestId: "current-request",
  code: "12345678",
  openCloudUrl: "https://cloud.example.test/recover",
  expiresAt: "2026-10-15T12:00:00Z",
  state: "approved" as const,
  point: {
    id: "selected-point",
    venueId: "selected-venue",
    capturedAt: saved.createdAt,
    modules: { core: 1 },
  },
};
type Screen = SetupRestoreBucketScreen | SetupCloudRestoreScreen;
const child = (screen: Screen) =>
  screen.shadowRoot!.querySelector<LitElement>("setup-recovery-copy")!;
const click = (screen: Screen) =>
  child(screen).shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
async function kit(screen: Screen, text = "private-kit") {
  screen
    .shadowRoot!.querySelector("[data-test=kit]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: text } }));
  await screen.updateComplete;
  await child(screen).updateComplete;
}
async function mount(kind: string, transport: typeof fetch) {
  const { el, host } =
    kind === "bucket"
      ? await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
          api: new SetupApi("", transport),
        })
      : await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
          api: new SetupApi("", transport),
          view: approved,
        });
  await el.updateComplete;
  expect(child(el)).not.toBeNull();
  if (kind === "bucket") await kit(el);
  await child(el).updateComplete;
  return { el, host };
}
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it.each(["bucket", "cloud"])(
  "shows the %s copy's date and key name before restore",
  async (kind) => {
    const transport = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      return Response.json(saved);
    });
    const { el } = await mount(kind, transport);
    click(el);
    await vi.waitFor(() => expect(child(el).shadowRoot!.textContent).toContain("Amber Hill"));
    expect(child(el).shadowRoot!.textContent).toContain("2026-10-01");
    expect(child(el).shadowRoot!.textContent).toContain("Saved venue");
    expect(child(el).shadowRoot!.textContent).toContain(
      "Keep older paper keys until no older backup remains.",
    );
    expect(child(el).shadowRoot!.textContent).not.toContain("private-kit");
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
      kind === "bucket" ? "/setup-api/restore-bucket/preview" : "/setup-api/cloud-recovery/preview",
    ]);
  },
);
it.each(["bucket-kit", "bucket-environment", "cloud-point", "cloud-request"])(
  "drops a late preview when %s changes",
  async (changed) => {
    let complete!: (response: Response) => void;
    const transport = vi.fn(
      () =>
        new Promise<Response>((done) => {
          complete = done;
        }),
    );
    const kind = changed.startsWith("bucket") ? "bucket" : "cloud";
    const { el } = await mount(kind, transport);
    click(el);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    if (changed === "bucket-kit") await kit(el, "other-kit");
    else if (changed === "bucket-environment") {
      el.shadowRoot!.querySelector("[data-test=environment]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "preproduction" } }),
      );
    } else
      (el as SetupCloudRestoreScreen).view = {
        ...approved,
        requestId: changed === "cloud-request" ? "new-request" : approved.requestId,
        point: {
          ...approved.point,
          id: changed === "cloud-point" ? "new-point" : approved.point.id,
        },
      };
    await el.updateComplete;
    await child(el).updateComplete;
    const response = Response.json(saved);
    const read = vi.spyOn(response, "text");
    complete(response);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await read.mock.results[0]!.value;
    await child(el).updateComplete;
    expect(child(el).shadowRoot!.textContent).not.toContain("Amber Hill");
  },
);
it("asks the bucket's old-box question after a live-source preview refusal, then reviews the confirmed source", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "restore.stream_source_live",
            params: { lastChangeAt: "2026-10-14T12:00:00Z" },
          },
        },
        { status: 409 },
      ),
    )
    .mockImplementation(async () => Response.json(saved));
  const { el } = await mount("bucket", transport);
  click(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=old-box-gone]")).not.toBeNull(),
  );
  const checkbox = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=old-box-gone]")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  await el.updateComplete;
  await child(el).updateComplete;
  click(el);
  await vi.waitFor(() => expect(child(el).shadowRoot!.textContent).toContain("Amber Hill"));
  expect(JSON.parse(transport.mock.calls[1]![1].body)).toEqual({
    kit: "private-kit",
    environment: "production",
    oldBoxGone: true,
  });
  await kit(el, "other-kit");
  expect(el.shadowRoot!.querySelector("[data-test=old-box-gone]")).toBeNull();
});
it.each(["bucket", "cloud"])("discards the %s preview after leaving", async (kind) => {
  let complete!: (response: Response) => void;
  const transport = vi.fn(
    () =>
      new Promise<Response>((done) => {
        complete = done;
      }),
  );
  const { el, host } = await mount(kind, transport);
  const panel = child(el);
  click(el);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
  host.remove();
  const response = Response.json(saved);
  const read = vi.spyOn(response, "text");
  complete(response);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  await read.mock.results[0]!.value;
  await panel.updateComplete;
  expect(panel.shadowRoot!.textContent).not.toContain("Amber Hill");
});

it.each([
  ["backup.stream_kit_invalid", {}, "kit", "Check the recovery kit."],
  [
    "restore.environment_mismatch",
    { backup: "production", target: "preproduction" },
    "environment",
    "Check the backup environment.",
  ],
] as const)("puts %s beneath the bucket field it names", async (code, params, field, message) => {
  const { el } = await mount("bucket", async () =>
    Response.json({ error: { code, params } }, { status: 400 }),
  );
  click(el);
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>(`[data-test=${field}]`)!.error,
    ).toBe(message),
  );
});

it.each(["bucket", "cloud"])(
  "shows the %s source reference to retain with the outside incident",
  async (kind) => {
    const { el } = await mount(kind, async () => Response.json(saved));
    click(el);
    await vi.waitFor(() => expect(child(el).shadowRoot!.textContent).toContain("Amber Hill"));
    expect(child(el).shadowRoot!.querySelector("[data-test=selected-copy]")!.textContent).toContain(
      "copy-id",
    );
  },
);
