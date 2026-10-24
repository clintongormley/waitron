import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { WtButton } from "@waitron/ui";
import { FirstSetupBackupScreen } from "./first-setup-backup-screen.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { backupRepairStrings } from "../i18n/backup-repair.js";
import {
  repairApi,
  inspection,
  saved,
  bucketProof,
  click,
  q,
  fill,
  key,
  moduleAnswer,
  recoveryEntry,
} from "../../test/first-setup-backup-browser.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(intercept?: Parameters<typeof repairApi>[0]) {
  const fixture = repairApi(intercept);
  const { el } = await mountWidget<FirstSetupBackupScreen>("setup-first-backup", {
    api: fixture.api,
    inspection,
  });
  await expect.poll(() => q<WtButton>(el, "prove")?.disabled).toBe(false);
  return { el, ...fixture };
}
it("offers repair recovery even when the original attempt and password cannot be read", async () => {
  const { el, calls } = await mount();
  expect(el.shadowRoot!.textContent).toContain("Recover from backup");
  expect(q(el, "source")).not.toBeNull();
  expect(q(el, "proof-key")).not.toBeNull();
  expect(q(el, "review")).toBeNull();
  expect(calls.map((c) => c.action)).toEqual(["status", "resolution"]);
});
it.each(["en-GB", "es-ES"] as const)(
  "explains the restart needed to return to ordinary setup before opening a backup in %s",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount();
    expect(q(el, "handoff-restart")).not.toBeNull();
    expect(q(el, "handoff-restart").textContent).toBe(
      backupRepairStrings[locale === "es-ES" ? "es" : "en"].handoffRestart,
    );
  },
);
it("shows reconnection instead of offering proof or resume for an already selected target", async () => {
  const fixture = repairApi((action) =>
    action === "status"
      ? Response.json({ phase: "selected", proofRequired: true, recoveryId: saved.recoveryId })
      : undefined,
  );
  const { el } = await mountWidget<FirstSetupBackupScreen>("setup-first-backup", {
    api: fixture.api,
    inspection,
  });
  await expect.poll(() => q(el, "restarting")).not.toBeNull();
  expect(q(el, "restarting").textContent).toBe(backupRepairStrings.en.restarting);
  expect(q(el, "reconnect")).not.toBeNull();
  for (const name of ["resume", "prove", "proof-key"]) expect(q(el, name)).toBeNull();
  expect(fixture.calls.map((call) => call.action)).toEqual(["status", "resolution"]);
});
it("requires source, selected key and isolation beside their fields with one bottom message", async () => {
  const { el, calls } = await mount();
  await click(el, "prove");
  expect(q<WtButton>(el, "prove").disabled).toBe(true);
  expect(q(el, "artifact-error").textContent).toBeTruthy();
  expect(q(el, "offline-error").textContent).toBeTruthy();
  expect(q(el, "sole-error").textContent).toBeTruthy();
  expect(calls.some((c) => c.action === "open")).toBe(false);
  await bucketProof(el);
  await expect.poll(() => q<WtButton>(el, "prove").disabled).toBe(false);
});
it("shows private preview only after selected-backup proof, then reuses the server's event", async () => {
  const { el, calls } = await mount();
  await bucketProof(el);
  expect(q(el, "review")).toBeNull();
  await click(el, "prove");
  await expect.poll(() => q(el, "review")?.textContent).toContain("Saved venue");
  expect(calls.find((c) => c.action === "open")!.body).toEqual({
    observation: { inspectionId: "a".repeat(64), revision: null, ownerGeneration: null },
    source: { kind: "bucket", kit: "private-kit", environment: "production" },
    nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    context: { oldBoxGone: true, soleRecovery: true },
  });
  const allocation = q<LitElement>(el, "allocation");
  await allocation.updateComplete;
  const entry = allocation.shadowRoot!.querySelector<
    LitElement & { context: { binding: unknown } }
  >("vf-recovery-hour")!;
  expect(entry.context.binding).toEqual(saved.binding);
  expect(
    calls.every(
      (c) =>
        c.path.startsWith("/setup-api/first-setup/resolution/backup/") ||
        c.path === "/setup-api/first-setup/resolution",
    ),
  ).toBe(true);
});
it("leaves rejected proof retryable and keeps local business details hidden", async () => {
  let attempts = 0;
  const { el } = await mount((action) =>
    action === "open" && attempts++ === 0
      ? Response.json(
          { error: { code: "promotion.break_glass_invalid", params: {} } },
          { status: 422 },
        )
      : undefined,
  );
  await bucketProof(el);
  await click(el, "prove");
  await expect.poll(() => q<WtButton>(el, "prove").disabled).toBe(false);
  expect(q(el, "review")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("Saved venue");
  await click(el, "prove");
  await expect.poll(() => q(el, "review")).not.toBeNull();
});
it.each(["source", "environment"])(
  "discards the authenticated grant and prepared controls when %s changes",
  async (field) => {
    const { el, calls } = await mount();
    await bucketProof(el);
    await click(el, "prove");
    await expect.poll(() => q(el, "review")).not.toBeNull();
    q(el, field).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: field === "source" ? "archive" : "preproduction" },
      }),
    );
    await el.updateComplete;
    expect(q(el, "review")).toBeNull();
    expect(q(el, "allocation")).toBeNull();
    expect(q<HTMLInputElement>(el, "offline").checked).toBe(false);
    await expect.poll(() => calls.filter((c) => c.action === "close")).toHaveLength(1);
  },
);
it("drops a late proof after disconnect, closes it and asks for proof after reconnection", async () => {
  let resolve!: (value: Response) => void;
  const gate = new Promise<Response>((done) => {
    resolve = done;
  });
  const { el, calls } = await mount((action) => (action === "open" ? gate : undefined));
  await bucketProof(el);
  await click(el, "prove");
  await expect.poll(() => calls.some((c) => c.action === "open")).toBe(true);
  const parent = el.parentElement!;
  el.remove();
  resolve(Response.json(saved));
  await expect.poll(() => calls.some((c) => c.action === "close")).toBe(true);
  parent.append(el);
  await el.updateComplete;
  expect(q(el, "review")).toBeNull();
  expect(q<HTMLInputElement>(el, "offline").checked).toBe(false);
});
it("sends no ordinary restore on Enter with invalid input", async () => {
  const { el, calls } = await mount();
  const field = q<LitElement>(el, "archive-key");
  await field.updateComplete;
  await userEvent.fill(
    field.shadowRoot!.querySelector<HTMLInputElement>("input")!,
    "archive-secret",
  );
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => q<WtButton>(el, "prove").disabled).toBe(true);
  expect(calls.some((c) => c.action === "open")).toBe(false);
});
it("resumes the exact interrupted target only after fresh proof", async () => {
  const { el, calls } = await mount((action) =>
    action === "status"
      ? Response.json({ phase: "restored", proofRequired: true, recoveryId: saved.recoveryId })
      : action === "resume"
        ? Response.json({ ...saved, input: { exact: "saved" } })
        : undefined,
  );
  await bucketProof(el);
  await click(el, "resume");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  expect(q(el, "allocation")).toBeNull();
  await click(el, "commit");
  await expect.poll(() => q(el, "restarting")).not.toBeNull();
  expect(calls.find((c) => c.action === "resume")!.body).toEqual({
    observation: { inspectionId: "a".repeat(64), revision: null, ownerGeneration: null },
    recoveryId: saved.recoveryId,
    nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    context: { oldBoxGone: true, soleRecovery: true },
  });
  expect(calls.find((c) => c.action === "commit")!.body).toEqual({
    sessionId: saved.sessionId,
    input: { exact: "saved" },
  });
});
it("does not carry bucket secrets across a source change", async () => {
  const { el } = await mount();
  await bucketProof(el);
  q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "archive" } }));
  await el.updateComplete;
  q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bucket" } }));
  await el.updateComplete;
  const kit = q<LitElement>(el, "kit");
  await kit.updateComplete;
  expect(kit.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
  await fill(el, "kit", "other-kit");
});

it("disables completion after invalid module entry until its fields are corrected", async () => {
  const { el, calls } = await mount();
  await bucketProof(el);
  await click(el, "prove");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  await click(el, "commit");
  await expect.poll(() => q<WtButton>(el, "commit").disabled).toBe(true);
  expect(calls.some((call) => call.action === "commit")).toBe(false);
});

it("completes a newly selected recovery through the real module clock form and bound repair session", async () => {
  const { el, calls } = await mount((action, body) =>
    action === "prepare" ? moduleAnswer(body) : undefined,
  );
  await bucketProof(el);
  await click(el, "prove");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  const entry = await recoveryEntry(el);
  await click(entry, "compare");
  await expect.poll(() => q(entry, "clock-readings")).not.toBeNull();
  await click(entry, "select");
  await expect.poll(() => q(entry, "selected-hour")).not.toBeNull();
  await click(el, "commit");
  await expect.poll(() => q(el, "restarting")).not.toBeNull();
  expect(
    calls
      .filter((call) => call.action === "prepare")
      .map((call) => (call.body as { proposal: { action: string } }).proposal.action),
  ).toEqual([
    "clock-challenge",
    "compare-clocks",
    "preview",
    "clock-challenge",
    "compare-clocks",
    "select",
  ]);
  expect(calls.find((call) => call.action === "commit")!.body).toEqual({
    sessionId: saved.sessionId,
    input: { selected: "module" },
  });
});

it("accepts the same binding in a different key order and rejects a different proof or event before requesting preparation", async () => {
  const { el, calls } = await mount((action) =>
    action === "prepare" ? Response.json({ status: "preview" }) : undefined,
  );
  await bucketProof(el);
  await click(el, "prove");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  const allocation = q<LitElement>(el, "allocation");
  await allocation.updateComplete;
  const entry = allocation.shadowRoot!.querySelector<
    LitElement & { context: { prepare(request: unknown): Promise<unknown> } }
  >("vf-recovery-hour")!;
  const { targetNodeId, sourceId, eventId, action, module } = saved.binding;
  const request = {
    binding: { targetNodeId, sourceId, eventId, action, module },
    nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    context: { selectedSourceId: "copy", oldBoxGone: true, soleRecovery: true },
    proposal: { action: "preview" },
  };
  expect(await entry.context.prepare(request)).toEqual({ status: "preview" });
  await expect(
    entry.context.prepare({
      ...request,
      binding: { ...request.binding, eventId: "another-event" },
    }),
  ).rejects.toEqual({ code: "setup.attempt_conflict" });
  await expect(
    entry.context.prepare({ ...request, nodeRecoverySecret: "another-key" }),
  ).rejects.toEqual({ code: "promotion.break_glass_invalid" });
  expect(calls.filter((call) => call.action === "prepare")).toHaveLength(1);
});

it("uploads a native archive selection with its separate archive key", async () => {
  const { el, calls } = await mount();
  const files = new DataTransfer();
  files.items.add(new File(["encrypted-copy"], "saved.waitron"));
  const picker = q<HTMLInputElement>(el, "artifact");
  picker.files = files.files;
  picker.dispatchEvent(new Event("change"));
  await fill(el, "archive-key", "archive-secret");
  await key(el);
  for (const name of ["offline", "sole"]) await userEvent.click(q<HTMLInputElement>(el, name));
  await click(el, "prove");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  expect(
    (calls.find((call) => call.action === "open")!.body as { source: unknown }).source,
  ).toEqual({ kind: "archive", recoveryKey: "archive-secret", environment: "production" });
});

it("gets Cloud approval only through repair routes and authenticates the approved point", async () => {
  let statuses = 0;
  const view = {
    requestId: "approval",
    code: "ABCD",
    openCloudUrl: "https://cloud.example.test/approve",
    expiresAt: "2026-10-24T11:00:00Z",
    state: "approved",
    point: {
      id: "00000000-0000-4000-8000-000000000009",
      venueId: "venue",
      capturedAt: "2026-10-24T10:00:00Z",
      modules: {},
    },
  };
  const { el, calls } = await mount((action) =>
    action === "start" || action === "start-again" || (action === "status" && statuses++ > 0)
      ? Response.json(view)
      : undefined,
  );
  q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "cloud" } }));
  await el.updateComplete;
  await click(el, "cloud-start");
  await expect
    .poll(() => el.shadowRoot!.querySelector("a")?.href)
    .toBe("https://cloud.example.test/approve");
  await click(el, "cloud-check");
  await expect.poll(() => q<WtButton>(el, "cloud-check").disabled).toBe(false);
  await click(el, "cloud-again");
  await expect.poll(() => q<WtButton>(el, "cloud-again").disabled).toBe(false);
  await key(el);
  for (const name of ["offline", "sole"]) await userEvent.click(q<HTMLInputElement>(el, name));
  await click(el, "prove");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  expect(
    (calls.find((call) => call.action === "open")!.body as { source: unknown }).source,
  ).toEqual({ kind: "cloud", pointId: view.point.id });
  expect(calls.filter((call) => call.path.includes("/cloud/")).map((call) => call.path)).toEqual([
    "/setup-api/first-setup/resolution/backup/cloud/start",
    "/setup-api/first-setup/resolution/backup/cloud/status",
    "/setup-api/first-setup/resolution/backup/cloud/start-again",
  ]);
});

it("keeps a failed saved-status read closed until a successful explicit check", async () => {
  let reads = 0;
  const fixture = repairApi((action) =>
    action === "status" && reads++ === 0
      ? Response.json({ phase: "invented", proofRequired: true })
      : undefined,
  );
  const { el } = await mountWidget<FirstSetupBackupScreen>("setup-first-backup", {
    api: fixture.api,
    inspection,
  });
  await expect.poll(() => q(el, "reload-status")).not.toBeNull();
  expect(q<WtButton>(el, "prove").disabled).toBe(true);
  await click(el, "reload-status");
  await expect.poll(() => q<WtButton>(el, "prove").disabled).toBe(false);
});

it.each([
  {
    code: "setup.request_invalid",
    field: "environment",
    shown: "environment",
    message: "required",
  },
  { code: "setup.request_invalid", field: "kit", shown: "kit", message: "required" },
  { code: "setup.request_invalid", field: "body", shown: undefined, message: "failed" },
  { code: "backup.artifact_invalid", field: undefined, shown: undefined, message: "failed" },
])(
  "places a $code refusal only beside the shown field $field",
  async ({ code, field, shown, message }) => {
    const { backupRepairStrings } = await import("../i18n/backup-repair.js");
    const { el } = await mount((action) =>
      action === "open"
        ? Response.json({ error: { code, params: field ? { field } : {} } }, { status: 422 })
        : undefined,
    );
    await bucketProof(el);
    await click(el, "prove");
    await expect.poll(() => q<WtButton>(el, "prove").disabled).toBe(false);
    const actions = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      "wt-form-actions",
    )!;
    if (shown) {
      expect(q<HTMLElement & { error: string }>(el, shown).error).toBe(
        backupRepairStrings.en[message as "required"],
      );
      expect(actions.error).toBe(backupRepairStrings.en.fix);
    } else expect(actions.error).toBe(backupRepairStrings.en.failed);
  },
);

it("keeps a refused exact completion retryable and preserves its checked selection", async () => {
  let attempts = 0;
  const { el, calls } = await mount((action) =>
    action === "status"
      ? Response.json({ phase: "restored", recoveryId: saved.recoveryId, proofRequired: true })
      : action === "resume"
        ? Response.json({ ...saved, input: { selected: "saved" } })
        : action === "commit" && attempts++ === 0
          ? Response.json(
              { error: { code: "setup.attempt_conflict", params: {} } },
              { status: 409 },
            )
          : undefined,
  );
  await bucketProof(el);
  await click(el, "resume");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  await click(el, "commit");
  await expect.poll(() => q<WtButton>(el, "commit").disabled).toBe(false);
  expect(q(el, "review")).not.toBeNull();
  await click(el, "commit");
  await expect.poll(() => q(el, "restarting")).not.toBeNull();
  expect(calls.filter((call) => call.action === "commit").map((call) => call.body)).toEqual([
    { sessionId: saved.sessionId, input: { selected: "saved" } },
    { sessionId: saved.sessionId, input: { selected: "saved" } },
  ]);
});

it("clears private controls when the inspection or API changes", async () => {
  const { el, calls } = await mount();
  await bucketProof(el);
  await click(el, "prove");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  el.inspection = { ...inspection, inspectionId: "c".repeat(64) };
  await el.updateComplete;
  expect(q(el, "review")).toBeNull();
  await expect.poll(() => calls.filter((call) => call.action === "close")).toHaveLength(1);
  const replacement = repairApi();
  el.api = replacement.api;
  await el.updateComplete;
  await expect.poll(() => replacement.calls.some((call) => call.action === "status")).toBe(true);
});

it("keeps Cloud refusal retryable without installing an unapproved point", async () => {
  const { el, calls } = await mount((action) =>
    action === "start"
      ? Response.json(
          { error: { code: "cloud.recovery_unavailable", params: {} } },
          { status: 503 },
        )
      : undefined,
  );
  q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "cloud" } }));
  await el.updateComplete;
  await click(el, "cloud-start");
  await expect.poll(() => q<WtButton>(el, "cloud-start").disabled).toBe(false);
  await key(el);
  for (const name of ["offline", "sole"]) await userEvent.click(q<HTMLInputElement>(el, name));
  await click(el, "prove");
  expect(calls.some((call) => call.action === "open")).toBe(false);
  expect(q(el, "review")).toBeNull();
});

it("does not render or authenticate a malformed Cloud approval response", async () => {
  const { el, calls } = await mount((action) =>
    action === "start"
      ? Response.json({ state: "approved", openCloudUrl: 42, point: { id: "invented" } })
      : undefined,
  );
  q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "cloud" } }));
  await el.updateComplete;
  await click(el, "cloud-start");
  await expect.poll(() => q<WtButton>(el, "cloud-start").disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("a")).toBeNull();
  await key(el);
  for (const name of ["offline", "sole"]) await userEvent.click(q<HTMLInputElement>(el, name));
  await click(el, "prove");
  expect(calls.some((call) => call.action === "open")).toBe(false);
});

it("offers the module PDF picker before the selected backup's identity is known", async () => {
  const { el, calls } = await mount();
  const picker = q<LitElement & { selection: unknown }>(el, "proof-key");
  await picker.updateComplete;
  expect(picker.selection).toBeUndefined();
  expect(
    picker.shadowRoot!.querySelector<HTMLInputElement>("[name=recovery-pdf]")!.accept,
  ).toContain("application/pdf");
  expect(calls.some((call) => call.action === "open")).toBe(false);
});

it.each(["back", "source"])(
  "rechecks the saved event and observation before reopening a source after preparation via %s",
  async (method) => {
    let prepared = false;
    const fixture = repairApi((action) => {
      if (action === "prepare") {
        prepared = true;
        return Response.json({ status: "preview" });
      }
      if (action === "status" && prepared)
        return Response.json({
          phase: "prepared",
          recoveryId: saved.recoveryId,
          proofRequired: true,
        });
      if (action === "resolution")
        return Response.json({
          ...inspection,
          inspectionId: prepared ? "c".repeat(64) : "a".repeat(64),
        });
    });
    const { el } = await mountWidget<FirstSetupBackupScreen>("setup-first-backup", {
      api: fixture.api,
      inspection,
    });
    await expect.poll(() => q<WtButton>(el, "prove")?.disabled).toBe(false);
    await bucketProof(el);
    await click(el, "prove");
    await expect.poll(() => q(el, "review")).not.toBeNull();
    const allocation = q<LitElement>(el, "allocation");
    await allocation.updateComplete;
    const entry = allocation.shadowRoot!.querySelector<
      LitElement & { context: { prepare(request: unknown): Promise<unknown> } }
    >("vf-recovery-hour")!;
    await entry.context.prepare({
      binding: saved.binding,
      nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      proposal: { action: "preview" },
    });
    if (method === "source") {
      q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "archive" } }));
      await el.updateComplete;
    } else {
      const back = el.shadowRoot!.querySelector<LitElement>(
        "wt-form-actions wt-button[slot=cancel]",
      )!;
      await back.updateComplete;
      await userEvent.click(back.shadowRoot!.querySelector("button")!);
    }
    await expect
      .poll(() => fixture.calls.filter((call) => call.action === "status"))
      .toHaveLength(2);
    await expect.poll(() => q<WtButton>(el, "prove")?.disabled).toBe(false);
    await bucketProof(el);
    await click(el, "prove");
    await expect.poll(() => q(el, "review")).not.toBeNull();
    const opened = fixture.calls.filter((call) => call.action === "open").at(-1)!;
    expect(opened.body).toMatchObject({
      recoveryId: saved.recoveryId,
      observation: { inspectionId: "c".repeat(64) },
    });
  },
);
