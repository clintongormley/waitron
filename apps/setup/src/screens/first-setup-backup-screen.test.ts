import { afterEach, expect, it, vi } from "vitest";
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
import {
  BUCKET_CODE,
  choose,
  damaged,
  heldFile,
  plainPdf,
  recoveryPackPdf,
} from "../../test/recovery-pack-pdf.js";

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

async function bucketSource(el: FirstSetupBackupScreen): Promise<void> {
  q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bucket" } }));
  await el.updateComplete;
}
function kitValue(el: FirstSetupBackupScreen): string {
  return q<LitElement>(el, "kit").shadowRoot!.querySelector<HTMLTextAreaElement>("textarea")!.value;
}

it("fills the kit from a chosen recovery pack PDF's attached file and sends that code", async () => {
  const { el, calls } = await mount();
  await bucketSource(el);
  choose(q<HTMLInputElement>(el, "kit-file"), await recoveryPackPdf(BUCKET_CODE));
  await expect.poll(() => kitValue(el)).toBe(BUCKET_CODE);
  await key(el);
  for (const name of ["offline", "sole"]) await userEvent.click(q<HTMLInputElement>(el, name));
  await el.updateComplete;
  await click(el, "prove");
  await expect
    .poll(() => calls.find((c) => c.action === "open")?.body)
    .toMatchObject({
      source: { kind: "bucket", kit: BUCKET_CODE, environment: "production" },
    });
  expect(q(el, "kit-file-error")).toBeNull();
});

it.each([
  [
    "a pack made with no bucket copy",
    () => recoveryPackPdf(null),
    "This recovery pack holds no bucket copy code: the box had no bucket copy when it was made. Choose a newer pack, or paste the code.",
  ],
  ["a PDF that is not a pack", plainPdf, "This PDF is not a Waitron recovery pack."],
  [
    "a pack whose attached file was changed",
    async () => damaged(await recoveryPackPdf(BUCKET_CODE)),
    "This recovery pack is damaged, or was changed after it was made. Choose the pack as it was saved, or paste the code.",
  ],
])("says so under the pack field for %s and keeps the kit already there", async (_, pdf, said) => {
  const { el } = await mount();
  await bucketSource(el);
  await fill(el, "kit", "pasted-kit");
  const input = q<HTMLInputElement>(el, "kit-file");
  choose(input, await pdf());
  await expect.poll(() => q(el, "kit-file-error")?.textContent).toBe(said);
  expect(input.getAttribute("aria-describedby")).toBe("repair-kit-file-error");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(kitValue(el)).toBe("pasted-kit");
  await fill(el, "kit", "typed-kit");
  await el.updateComplete;
  expect(q(el, "kit-file-error")).toBeNull();
});

it("keeps what was typed when a file chosen before it finishes reading later", async () => {
  const { el } = await mount();
  await bucketSource(el);
  const late = heldFile("WAITRON-RECOVERY-KIT-1:late");
  choose(q<HTMLInputElement>(el, "kit-file"), late.file);
  await fill(el, "kit", "typed-kit");
  await late.release();
  await el.updateComplete;
  expect(kitValue(el)).toBe("typed-kit");
});

/** Chooses `file` through the input's real file list, so the input shows its name. */
function pick(input: HTMLInputElement, file: File): void {
  const files = new DataTransfer();
  files.items.add(file);
  input.files = files.files;
  input.dispatchEvent(new Event("change"));
}

it("clears a pack refusal and the chosen pack file when reconnecting after a refused proof", async () => {
  const { el } = await mount((action) =>
    action === "open"
      ? Response.json(
          { error: { code: "promotion.break_glass_invalid", params: {} } },
          { status: 422 },
        )
      : undefined,
  );
  await bucketProof(el);
  await click(el, "prove");
  await expect.poll(() => q(el, "reload-status")).not.toBeNull();
  pick(q<HTMLInputElement>(el, "kit-file"), await plainPdf());
  await expect.poll(() => q(el, "kit-file-error")).not.toBeNull();
  await click(el, "reload-status");
  await expect.poll(() => q<WtButton>(el, "prove")?.disabled).toBe(false);
  expect(q(el, "kit-file-error")).toBeNull();
  expect(q<HTMLInputElement>(el, "kit-file").files).toHaveLength(0);
});

it("clears the chosen pack file when the environment changes", async () => {
  const { el } = await mount();
  await bucketSource(el);
  const input = q<HTMLInputElement>(el, "kit-file");
  pick(input, await plainPdf());
  await expect.poll(() => q(el, "kit-file-error")).not.toBeNull();
  q(el, "environment").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "preproduction" } }),
  );
  await el.updateComplete;
  expect(q(el, "kit-file-error")).toBeNull();
  expect(q<HTMLInputElement>(el, "kit-file")).toBe(input);
  expect(input.files).toHaveLength(0);
});

it("drops a pack read that finishes after the form was reset", async () => {
  const { el } = await mount();
  await bucketSource(el);
  const late = heldFile("WAITRON-RECOVERY-KIT-1:late");
  choose(q<HTMLInputElement>(el, "kit-file"), late.file);
  q(el, "environment").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "preproduction" } }),
  );
  await el.updateComplete;
  await late.release();
  await el.updateComplete;
  expect(kitValue(el)).toBe("");
});

it.each([
  ["en-GB", "Recovery pack or kit file"],
  ["es-ES", "Paquete de recuperación o archivo del kit"],
] as const)("labels the pack field in %s", async (locale, label) => {
  setLocale(locale);
  const { el } = await mount();
  await bucketSource(el);
  const input = q<HTMLInputElement>(el, "kit-file");
  expect(input.labels![0]!.textContent!.trim()).toBe(label);
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

const root = "/setup-api/first-setup/resolution/backup";
// 14:41 on 25 October 2026 in the browser's own time zone, so the shown time below is fixed.
const discardedAt = new Date(2026, 9, 25, 14, 41).toISOString();
const shownDiscardedAt = { "en-GB": "25 Oct 2026, 14:41", "es-ES": "25 oct 2026, 14:41" } as const;
const discardedText = (locale: keyof typeof shownDiscardedAt) =>
  backupRepairStrings[locale === "es-ES" ? "es" : "en"].discarded.replace(
    "{at}",
    shownDiscardedAt[locale],
  );
const refused = (code: string, params: Record<string, unknown> = {}) =>
  Response.json(
    { error: { code, params } },
    { status: code === "setup.owner_required" ? 403 : 409 },
  );
const approvedView = {
  requestId: "approval",
  code: "ABCD",
  openCloudUrl: "https://cloud.example.test/approve",
  expiresAt: "2026-10-24T11:00:00Z",
  state: "awaiting_owner",
};
async function openedWithRenewal(renew: () => Response) {
  const fixture = await mount((action, body) =>
    action === "renew" && (body as { sessionId?: string }).sessionId !== undefined
      ? renew()
      : undefined,
  );
  await bucketProof(fixture.el);
  await click(fixture.el, "prove");
  await expect.poll(() => q(fixture.el, "review")).not.toBeNull();
  return fixture;
}
function expectNoStep(el: FirstSetupBackupScreen) {
  for (const name of ["review", "prove", "resume", "commit", "proof-key", "source", "cloud-check"])
    expect(q(el, name)).toBeNull();
}

it("renews an open session every 30 s and stops when the screen closes", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el, calls } = await openedWithRenewal(() => Response.json({ renewed: true }));
    const renewals = () => calls.filter((call) => call.path === `${root}/renew`);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewals().map((call) => call.body)).toEqual([
      { sessionId: saved.sessionId },
      { sessionId: saved.sessionId },
    ]);
    el.remove();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(renewals()).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it.each(["en-GB", "es-ES"] as const)(
  "stops renewing and says the recovery stopped when a renewal is refused, in %s",
  async (locale) => {
    setLocale(locale);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { el, calls } = await openedWithRenewal(() => refused("setup.owner_required"));
      await vi.advanceTimersByTimeAsync(30_000);
      await expect.poll(() => q(el, "stopped")).not.toBeNull();
      expect(q(el, "stopped").textContent).toBe(
        backupRepairStrings[locale === "es-ES" ? "es" : "en"].stopped,
      );
      expectNoStep(el);
      expect(q(el, "back")).not.toBeNull();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls.filter((call) => call.path === `${root}/renew`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each(["en-GB", "es-ES"] as const)(
  "shows a discarded recovery's sentence with its time and no step after it, in %s",
  async (locale) => {
    setLocale(locale);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { el } = await openedWithRenewal(() =>
        refused("setup.recovery_discarded", { discardedAt }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await expect.poll(() => q(el, "discarded")).not.toBeNull();
      expect(q(el, "discarded").textContent).toBe(discardedText(locale));
      expectNoStep(el);
      expect(q(el, "stopped")).toBeNull();
      expect(q(el, "reload-status")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  },
);

it("shows the discarded sentence when completing a discarded recovery is refused", async () => {
  const { el } = await mount((action) =>
    action === "status"
      ? Response.json({ phase: "restored", proofRequired: true, recoveryId: saved.recoveryId })
      : action === "resume"
        ? Response.json({ ...saved, input: { exact: "saved" } })
        : action === "commit"
          ? refused("setup.recovery_discarded", { discardedAt })
          : undefined,
  );
  await bucketProof(el);
  await click(el, "resume");
  await expect.poll(() => q(el, "review")).not.toBeNull();
  await click(el, "commit");
  await expect.poll(() => q(el, "discarded")?.textContent).toBe(discardedText("en-GB"));
  expectNoStep(el);
});

it.each(["prepared", "placement-started", "restored"])(
  "offers neither resume nor reopening for a stopped %s recovery",
  async (phase) => {
    const fixture = repairApi((action) =>
      action === "status"
        ? Response.json({ phase, proofRequired: true, recoveryId: saved.recoveryId })
        : action === "activity"
          ? Response.json({
              activity: {
                state: "stopped",
                startedAt: "2026-10-25T14:35:00.000Z",
                lastActiveSource: "memory",
                lastActiveAt: "2026-10-25T14:41:00.000Z",
                phase,
                recoveryId: saved.recoveryId,
                failed: false,
                cloud: false,
              },
            })
          : undefined,
    );
    const { el } = await mountWidget<FirstSetupBackupScreen>("setup-first-backup", {
      api: fixture.api,
      inspection,
    });
    await expect.poll(() => q(el, "stopped")).not.toBeNull();
    expect(q(el, "stopped").textContent).toBe(backupRepairStrings.en.stopped);
    expectNoStep(el);
    expect(fixture.calls.map((call) => call.action)).toEqual(["status", "resolution", "activity"]);
  },
);

it("still offers resume when the saved recovery is not reported stopped", async () => {
  const { el, calls } = await mount((action) =>
    action === "status"
      ? Response.json({ phase: "restored", proofRequired: true, recoveryId: saved.recoveryId })
      : action === "activity"
        ? Response.json({ activity: null })
        : undefined,
  );
  expect(q(el, "resume")).not.toBeNull();
  expect(q(el, "stopped")).toBeNull();
  expect(calls.map((call) => call.action)).toEqual(["status", "resolution", "activity"]);
});

it("keeps the session and its renewals when the box answers a renewal with a fault", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el, calls } = await openedWithRenewal(() =>
      Response.json({ error: { code: "server.internal", params: {} } }, { status: 500 }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await new Promise((done) => setTimeout(done, 50));
    await vi.advanceTimersByTimeAsync(30_000);
    await el.updateComplete;
    expect(calls.filter((call) => call.path === `${root}/renew`)).toHaveLength(2);
    expect(q(el, "stopped")).toBeNull();
    expect(q(el, "review")).not.toBeNull();
    expect(calls.some((call) => call.action === "close")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  { locale: "en-GB", action: "open" },
  { locale: "es-ES", action: "open" },
  { locale: "en-GB", action: "resume" },
  { locale: "es-ES", action: "resume" },
] as const)(
  "shows the discarded sentence when $action is refused as discarded, in $locale",
  async ({ locale, action }) => {
    setLocale(locale);
    const { el } = await mount((called) =>
      called === "status"
        ? Response.json({ phase: "restored", proofRequired: true, recoveryId: saved.recoveryId })
        : called === action
          ? refused("setup.recovery_discarded", { discardedAt })
          : undefined,
    );
    await bucketProof(el);
    await click(el, action === "open" ? "prove" : "resume");
    await expect.poll(() => q(el, "discarded")?.textContent).toBe(discardedText(locale));
    expectNoStep(el);
    expect(q(el, "reload-status")).not.toBeNull();
  },
);

it("shows a discarded time it cannot read as the box sent it", async () => {
  const { el } = await mount((action) =>
    action === "open"
      ? refused("setup.recovery_discarded", { discardedAt: "not a time" })
      : undefined,
  );
  await bucketProof(el);
  await click(el, "prove");
  await expect
    .poll(() => q(el, "discarded")?.textContent)
    .toBe(backupRepairStrings.en.discarded.replace("{at}", "not a time"));
});

it.each([
  {
    name: "a refused read",
    answer: () =>
      Response.json({ error: { code: "server.internal", params: {} } }, { status: 500 }),
  },
  { name: "an answer without activity", answer: () => Response.json({}) },
  {
    name: "an activity that is not a record",
    answer: () => Response.json({ activity: "stopped" }),
  },
])(
  "offers no resume when it cannot tell whether the saved recovery stopped: $name",
  async ({ answer }) => {
    const { api, calls } = repairApi((action) =>
      action === "status"
        ? Response.json({ phase: "restored", proofRequired: true, recoveryId: saved.recoveryId })
        : action === "activity"
          ? answer()
          : undefined,
    );
    const { el } = await mountWidget<FirstSetupBackupScreen>("setup-first-backup", {
      api,
      inspection,
    });
    await expect.poll(() => q(el, "reload-status")).not.toBeNull();
    expect(q(el, "resume")).toBeNull();
    expect(q<WtButton>(el, "prove").disabled).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
    ).toBe(backupRepairStrings.en.statusFailed);
    expect(calls.map((call) => call.action)).toEqual(["status", "resolution", "activity"]);
  },
);

it("ends the Cloud wait and lets go of it when the source changes away from Cloud", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el, calls, cloudRenewals } = await cloudWait(() => Response.json({ renewed: true }));
    const holder = (
      calls.find((call) => call.path === `${root}/cloud/start`)!.body as {
        holder: string;
      }
    ).holder;
    q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bucket" } }));
    await el.updateComplete;
    await expect
      .poll(() => calls.filter((call) => call.path === `${root}/cloud/release`).map((c) => c.body))
      .toEqual([{ holder }]);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(cloudRenewals()).toHaveLength(0);
    el.remove();
    await new Promise((done) => setTimeout(done, 50));
    expect(calls.filter((call) => call.path === `${root}/cloud/release`)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

async function cloudWait(renew: () => Response) {
  const fixture = await mount((action, body) => {
    const held = (body as { holder?: string }).holder !== undefined;
    if (action === "start" || (action === "status" && held)) return Response.json(approvedView);
    if (action === "renew" && held) return renew();
    if (action === "release") return Response.json({ released: true });
  });
  q(fixture.el, "source").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "cloud" } }),
  );
  await fixture.el.updateComplete;
  await click(fixture.el, "cloud-start");
  await expect.poll(() => fixture.el.shadowRoot!.querySelector("a")).not.toBeNull();
  const cloudRenewals = () => fixture.calls.filter((call) => call.path === `${root}/cloud/renew`);
  return { ...fixture, cloudRenewals };
}

it("holds the Cloud wait with one holder: renews every 30 s and on becoming visible, releases on leaving", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el, calls, cloudRenewals } = await cloudWait(() => Response.json({ renewed: true }));
    const holder = (
      calls.find((call) => call.path === `${root}/cloud/start`)!.body as {
        holder: string;
      }
    ).holder;
    expect(holder).toMatch(/^[a-f0-9]{32}$/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cloudRenewals().map((call) => call.body)).toEqual([{ holder }, { holder }]);
    document.dispatchEvent(new Event("visibilitychange"));
    await expect.poll(() => cloudRenewals()).toHaveLength(3);
    el.remove();
    await expect
      .poll(() => calls.filter((call) => call.path === `${root}/cloud/release`).map((c) => c.body))
      .toEqual([{ holder }]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(cloudRenewals()).toHaveLength(3);
  } finally {
    vi.useRealTimers();
  }
});

it.each(["setup.owner_required"])(
  "a Cloud renewal refused with %s stops renewing and keeps Check, which still asks Cloud",
  async (code) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { el, calls, cloudRenewals } = await cloudWait(() => refused(code));
      await vi.advanceTimersByTimeAsync(30_000);
      await expect.poll(() => cloudRenewals()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(cloudRenewals()).toHaveLength(1);
      await el.updateComplete;
      expect(q(el, "stopped")).toBeNull();
      expect(q(el, "discarded")).toBeNull();
      expect(q(el, "cloud-check")).not.toBeNull();
      await click(el, "cloud-check");
      await expect
        .poll(() => calls.filter((call) => call.path === `${root}/cloud/status`))
        .toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each([
  [
    "a fault",
    () => Response.json({ error: { code: "server.internal", params: {} } }, { status: 500 }),
  ],
  ["setup.attempt_conflict", () => refused("setup.attempt_conflict")],
] as const)(
  "a Cloud renewal answered with %s keeps renewing, and the wait stays as it was",
  async (_name, answer) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { el, cloudRenewals } = await cloudWait(answer);
      await vi.advanceTimersByTimeAsync(30_000);
      await expect.poll(() => cloudRenewals()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect.poll(() => cloudRenewals()).toHaveLength(3);
      await el.updateComplete;
      expect(q(el, "stopped")).toBeNull();
      expect(q(el, "discarded")).toBeNull();
      expect(q(el, "cloud-check")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  },
);

it("a Cloud renewal refused as discarded shows the discarded sentence with its time", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el } = await cloudWait(() => refused("setup.recovery_discarded", { discardedAt }));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(() => q(el, "discarded")?.textContent).toBe(discardedText("en-GB"));
    expectNoStep(el);
  } finally {
    vi.useRealTimers();
  }
});

it("hands the Cloud wait's lease to the session once the approved point is opened", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const view = {
      ...approvedView,
      state: "approved",
      point: {
        id: "00000000-0000-4000-8000-000000000009",
        venueId: "venue",
        capturedAt: "2026-10-24T10:00:00Z",
        modules: {},
      },
    };
    const { el, calls } = await mount((action, body) => {
      const held = (body as { holder?: string }).holder !== undefined;
      if (action === "start") return Response.json(view);
      if (action === "renew") return Response.json({ renewed: true });
      if (action === "release" && held) return Response.json({ released: true });
    });
    q(el, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "cloud" } }));
    await el.updateComplete;
    await click(el, "cloud-start");
    await expect.poll(() => el.shadowRoot!.querySelector("a")).not.toBeNull();
    await key(el);
    for (const name of ["offline", "sole"]) await userEvent.click(q<HTMLInputElement>(el, name));
    await click(el, "prove");
    await expect.poll(() => q(el, "review")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.filter((call) => call.path === `${root}/cloud/renew`)).toHaveLength(0);
    expect(calls.filter((call) => call.path === `${root}/renew`)).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it("Back after a refused renewal stopped the recovery returns to the setup repair page", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el } = await openedWithRenewal(() => refused("setup.owner_required"));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(() => q(el, "back")).not.toBeNull();
    const screens: unknown[] = [];
    el.addEventListener("setup-goto", (event) =>
      screens.push((event as CustomEvent<{ screen: string }>).detail.screen),
    );
    await click(el, "back");
    expect(screens).toEqual(["first-owner"]);
  } finally {
    vi.useRealTimers();
  }
});

it("Reconnect after a discarded recovery reads the saved status again and offers a fresh proof", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el, calls } = await openedWithRenewal(() =>
      refused("setup.recovery_discarded", { discardedAt }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(() => q(el, "reload-status")).not.toBeNull();
    const reads = (action: string) => calls.filter((call) => call.action === action).length;
    const before = [reads("status"), reads("resolution")];
    await click(el, "reload-status");
    await expect.poll(() => q<WtButton>(el, "prove")?.disabled).toBe(false);
    expect([reads("status"), reads("resolution")]).toEqual([before[0]! + 1, before[1]! + 1]);
    expect(q(el, "discarded")).toBeNull();
    expect(q(el, "source")).not.toBeNull();
    expect(q(el, "review")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
