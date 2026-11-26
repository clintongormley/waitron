import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeMasterKeyCode } from "@waitron/shared";
import type { WtDialog, WtMasterKeyInput } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { BackupWriteAnswer, RecoveryPackStatus } from "../api/backup-api.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { createFreshSignInGate } from "../api/fresh-sign-in.js";
import { DashboardApi } from "../api/client.js";
import { cleanupWidgets, dialogClosed, dialogMessageOf, mountWidget } from "./test-helpers.js";
import type { BackupKeyDialog } from "./backup-key-dialog.js";
import "./backup-key-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

const KEY = encodeMasterKeyCode(new Uint8Array(16).fill(7));

function status(number: number | null): RecoveryPackStatus {
  return {
    latest: null,
    upToDate: false,
    incomplete: false,
    unreceived: null,
    reasons: [],
    keep: [],
    backupsUseOlderKey: false,
    masterKey: { name: "2026-11-23 · QZJV", pack: 1 },
    keepOldPackUntil: "2026-12-23T12:00:00.000Z",
    timeZone: "Europe/Madrid",
    backupKey:
      number === null
        ? null
        : { number, fingerprint: "4f9a21c0", changedAt: null, fromCurrentMasterKey: true },
  };
}

const ANSWER = { enabled: true } as unknown as BackupWriteAnswer;

function stubApi(rotate: ReturnType<typeof vi.fn>, after: RecoveryPackStatus | Error = status(4)) {
  const liveData = new LiveData();
  vi.spyOn(liveData, "invalidate");
  return {
    rotateBackupKey: rotate,
    getRecoveryPackStatus: vi
      .fn()
      .mockImplementation(() =>
        after instanceof Error ? Promise.reject(after) : Promise.resolve(after),
      ),
    liveData,
  };
}

async function open(api: ReturnType<typeof stubApi>, held: number | null = 3) {
  const { el } = await mountWidget<BackupKeyDialog>("dashboard-backup-key-dialog", {
    api: api as unknown as DashboardApi,
  });
  el.show(status(held));
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  return { el, dialog };
}

const field = (el: BackupKeyDialog) =>
  el.shadowRoot!.querySelector<WtMasterKeyInput>("wt-master-key-input")!;
const button = (el: BackupKeyDialog, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`wt-button[data-test=${test}]`);
const words = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();

async function type(el: BackupKeyDialog, text: string) {
  const input = field(el).shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("wt-input")!;
  await input.updateComplete;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await field(el).updateComplete;
  await el.updateComplete;
}

describe.each([
  [
    "en-GB",
    "New backups will use backup key 4. A box you removed can't read them.",
    "Change the backup key",
    "Cancel",
  ],
  [
    "es-ES",
    es["backup_key_dialog.text"].replace("{number}", "4"),
    es["recovery_pack.change_backup_key"],
    es["action.cancel"],
  ],
] as const)("the backup key dialog in %s", (locale, text, change, cancel) => {
  it("names the next backup key, and keeps Change the backup key off until a whole key is typed", async () => {
    setLocale(locale);
    const { el, dialog } = await open(stubApi(vi.fn()));
    expect(dialog.getAttribute("heading")).toBe(change);
    expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(text);
    expect(words(button(el, "change-backup-key"))).toBe(change);
    expect(words(button(el, "cancel-backup-key"))).toBe(cancel);
    expect(field(el).required).toBe(true);
    expect(button(el, "change-backup-key")!.disabled).toBe(true);
    await type(el, KEY.slice(0, 10));
    expect(button(el, "change-backup-key")!.disabled).toBe(true);
    await type(el, KEY);
    expect(button(el, "change-backup-key")!.disabled).toBe(false);
  });
});

it("Change the backup key sends the typed master key and shows 'Backups now use backup key N+1.'", async () => {
  const rotate = vi.fn().mockResolvedValue(ANSWER);
  const api = stubApi(rotate);
  const { el } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe("Backups now use backup key 4.");
  expect(rotate).toHaveBeenCalledWith({ masterKey: KEY });
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(el.shadowRoot!.querySelector("wt-master-key-input")).toBeNull();
  expect(button(el, "change-backup-key")).toBeNull();
  expect(words(button(el, "close-backup-key"))).toBe(t("action.close"));
});

it("names the number the box reports once the key has changed", async () => {
  const rotate = vi.fn().mockResolvedValue(ANSWER);
  const { el } = await open(stubApi(rotate, status(7)));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe(fill("backup_key_dialog.done", { number: "7" }));
});

it("offers backup key 1 when the box holds none", async () => {
  const { el } = await open(stubApi(vi.fn()), null);
  expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(
    fill("backup_key_dialog.text", { number: "1" }),
  );
});

it.each([
  ["en-GB", "Wrong master key. Use the one dated 2026-11-23 · QZJV."],
  ["es-ES", MASTER_KEY_FIELD_WORDS.es.wrongKey("2026-11-23 · QZJV")],
] as const)(
  "a wrong master key shows 'Wrong master key. Use the one dated {name}.' (%s)",
  async (locale, sentence) => {
    setLocale(locale);
    const rotate = vi.fn().mockRejectedValue({
      code: "master_key.wrong",
      params: { keyName: "2026-11-23 · QZJV" },
      status: 400,
    });
    const api = stubApi(rotate);
    const { el, dialog } = await open(api);
    const changed = vi.fn();
    el.addEventListener("backup-key-changed", changed);
    await type(el, KEY);
    button(el, "change-backup-key")!.click();
    await expect.poll(() => field(el).error).toBe(sentence);
    expect(await dialogMessageOf(dialog)).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=done]")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(api.liveData.invalidate).not.toHaveBeenCalled();
    await type(el, encodeMasterKeyCode(new Uint8Array(16).fill(9)));
    expect(field(el).error).toBe("");
  },
);

it("words a wrong master key with the name the box's refusal carries", async () => {
  const rotate = vi.fn().mockRejectedValue({
    code: "master_key.wrong",
    params: { keyName: "2026-11-25 · WXYZ" },
    status: 403,
  });
  const { el } = await open(stubApi(rotate));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => field(el).error)
    .toBe(MASTER_KEY_FIELD_WORDS.en.wrongKey("2026-11-25 · WXYZ"));
});

it("a refusal with no key name says the venue has no master key yet", async () => {
  const rotate = vi.fn().mockRejectedValue({ code: "master_key.wrong", params: {}, status: 403 });
  const { el } = await open(stubApi(rotate));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect.poll(() => field(el).error).toBe(codeMessage("master_key.wrong"));
  expect(field(el).error).toBe(
    "Wrong master key. This venue has no master key yet: use “Make a new master key” on the Recovery pack card.",
  );
});

describe("a recovery pack PDF chosen in the field", () => {
  async function choosePack(el: BackupKeyDialog, masterKeyName: string) {
    const input = field(el);
    input.readPack = async () => async () => ({
      masterKey: KEY,
      masterKeyName,
      masterKeyHeldBy: null,
    });
    const control = input.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["%PDF-1.7"], "pack.pdf"));
    control.files = transfer.files;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => input.pdfRead).not.toBeNull();
    await input.pdfRead;
    await el.updateComplete;
  }

  const fieldLine = (el: BackupKeyDialog) =>
    words(
      field(el).shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("[data-error]"),
    );

  it("an older pack's key is refused by the field itself, naming the current key, with no request", async () => {
    const rotate = vi.fn();
    const { el } = await open(stubApi(rotate));
    expect(field(el).keyName).toBe("2026-11-23 · QZJV");
    await choosePack(el, "2026-10-01 · AAAA");
    expect(fieldLine(el)).toBe(MASTER_KEY_FIELD_WORDS.en.wrongKey("2026-11-23 · QZJV"));
    expect(button(el, "change-backup-key")!.disabled).toBe(true);
    expect(rotate).not.toHaveBeenCalled();
  });

  it("the current key's pack fills the field and lets the change go ahead", async () => {
    const rotate = vi.fn().mockResolvedValue(ANSWER);
    const { el } = await open(stubApi(rotate));
    await choosePack(el, "2026-11-23 · QZJV");
    expect(fieldLine(el)).toBe("");
    expect(button(el, "change-backup-key")!.disabled).toBe(false);
    button(el, "change-backup-key")!.click();
    await expect.poll(() => rotate.mock.calls.length).toBe(1);
    expect(rotate).toHaveBeenCalledWith({ masterKey: KEY });
  });
});

it("explains a refusal the box gives before writing on the form's own line, and changes nothing", async () => {
  const rotate = vi
    .fn()
    .mockRejectedValue({ code: "backup.key_change_page_required", status: 403 });
  const api = stubApi(rotate);
  const { el, dialog } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => dialogMessageOf(dialog))
    .toBe(codeMessage("backup.key_change_page_required"));
  expect(field(el).error).toBe("");
  expect(changed).not.toHaveBeenCalled();
  expect(api.liveData.invalidate).not.toHaveBeenCalled();
  expect(button(el, "change-backup-key")!.disabled).toBe(false);
});

it("a key change the box could not confirm was still written: says so, reads again, and offers no second press", async () => {
  const rotate = vi.fn().mockRejectedValue({ code: "backup.effective_mismatch", status: 500 });
  const api = stubApi(rotate);
  const { el } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe(
      "Backup key 4 is saved, but the box could not confirm that backups use it. Reload the page. If this comes back, stop changing backup settings here.",
    );
  expect(words(el.shadowRoot!.querySelector("[data-test=done]"))).not.toContain("Backups now use");
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(button(el, "change-backup-key")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-master-key-input")).toBeNull();
  expect(rotate).toHaveBeenCalledTimes(1);
});

it("after another failure from the box, the next press offers the key after the one the box now holds", async () => {
  const rotate = vi
    .fn()
    .mockRejectedValueOnce({ code: "server.internal", status: 500 })
    .mockResolvedValue(ANSWER);
  const api = stubApi(rotate, status(4));
  const { el, dialog } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect.poll(() => dialogMessageOf(dialog)).toBe(codeMessage("server.internal"));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=intro]")))
    .toBe(fill("backup_key_dialog.text", { number: "5" }));
});

it("treats a key change whose settings record failed as done, and says so", async () => {
  const rotate = vi.fn().mockRejectedValue({
    code: "backup.rotation_metadata_failed",
    params: { effectiveKeyChanged: true, keyFingerprint: "aa", keyRotatedAt: "x" },
    status: 500,
  });
  const api = stubApi(rotate);
  const { el } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe("Backups now use backup key 4.");
  expect(words(el.shadowRoot!.querySelector("[data-test=done-warning]"))).toBe(
    codeMessage("backup.rotation_metadata_failed"),
  );
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("after a failed reload, says backups still use the old key only when the box says so", async () => {
  const rotate = vi
    .fn()
    .mockResolvedValue({ ...ANSWER, reloadErrorCode: "backup.destination_key_invalid" });
  const { el } = await open(stubApi(rotate, { ...status(4), backupsUseOlderKey: true }));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe(t("recovery_pack.older_key"));
  expect(words(el.shadowRoot!.querySelector("[data-test=done-warning]"))).toBe(
    codeMessage("backup.destination_key_invalid"),
  );
  expect(el.shadowRoot!.textContent).not.toContain("Backups now use");
});

it.each([
  ["en-GB", "Saved, but the box could not load the new settings."],
  ["es-ES", es["backup_key_dialog.saved_not_loaded"]],
] as const)(
  "after a failed reload with the new key loaded, says only that the settings did not load (%s)",
  async (locale, sentence) => {
    setLocale(locale);
    const rotate = vi
      .fn()
      .mockResolvedValue({ ...ANSWER, reloadErrorCode: "backup.destination_key_invalid" });
    const { el } = await open(stubApi(rotate, status(4)));
    await type(el, KEY);
    button(el, "change-backup-key")!.click();
    await expect.poll(() => words(el.shadowRoot!.querySelector("[data-test=done]"))).toBe(sentence);
    expect(el.shadowRoot!.textContent).not.toContain(t("recovery_pack.older_key"));
  },
);

it("settings the box loaded but cannot use are named as not loaded, never 'Backups now use'", async () => {
  const rotate = vi
    .fn()
    .mockResolvedValue({ ...ANSWER, reloadErrorCode: "backup.archive_settings_invalid" });
  const { el } = await open(stubApi(rotate, status(4)));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe(t("backup_key_dialog.saved_not_loaded"));
  expect(words(el.shadowRoot!.querySelector("[data-test=done-warning]"))).toBe(
    codeMessage("backup.archive_settings_invalid"),
  );
  expect(el.shadowRoot!.textContent).not.toContain("Backups now use");
});

it("after a failed reload whose status cannot be read, claims nothing about which key backups use", async () => {
  const rotate = vi
    .fn()
    .mockResolvedValue({ ...ANSWER, reloadErrorCode: "backup.destination_key_invalid" });
  const { el } = await open(stubApi(rotate, new Error("offline")));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe(t("backup_key_dialog.saved_not_loaded"));
});

it("a reload the box was still busy with gives the box's next try, never 'try again'", async () => {
  const rotate = vi
    .fn()
    .mockResolvedValue({ ...ANSWER, reloadErrorCode: "backup.reload_in_progress" });
  const { el } = await open(stubApi(rotate));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done-warning]")))
    .toBe(t("backup.reload_failed_retry"));
  expect(el.shadowRoot!.textContent).not.toContain("try again");
  expect(button(el, "change-backup-key")).toBeNull();
});

it("reads the reload failure a failed settings record carries, and then claims nothing about the new key", async () => {
  const rotate = vi.fn().mockRejectedValue({
    code: "backup.rotation_metadata_failed",
    params: { effectiveKeyChanged: true, reloadErrorCode: "backup.reload_in_progress" },
    status: 500,
  });
  const api = stubApi(rotate);
  const { el } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect
    .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
    .toBe(t("backup_key_dialog.saved_not_loaded"));
  expect(words(el.shadowRoot!.querySelector("[data-test=done-warning]"))).toBe(
    `${codeMessage("backup.rotation_metadata_failed")} ${t("backup.reload_failed_retry")}`,
  );
  expect(changed).toHaveBeenCalledTimes(1);
});

describe("a stale sign-in", () => {
  function realApi(prompt: () => Promise<boolean>) {
    const bodies: unknown[] = [];
    let rotates = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = `${init?.method ?? "GET"} ${String(input)}`;
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (call === "POST /api/backup/rotate") {
        bodies.push(JSON.parse(String(init?.body)));
        if (rotates++ === 0)
          return json({ error: { code: "management_session.proof_required" } }, 400);
        return json({ enabled: true });
      }
      if (call === "GET /api/backup/recovery-pack") return json(status(4));
      throw new Error(`Unexpected request: ${call}`);
    });
    const api = new DashboardApi("", fetchImpl as typeof fetch, undefined, undefined, false, {
      freshSignIn: createFreshSignInGate({ sessionGeneration: () => 0, prompt }),
    });
    return { api, bodies };
  }

  async function openReal(api: DashboardApi) {
    const { el } = await mountWidget<BackupKeyDialog>("dashboard-backup-key-dialog", { api });
    el.show(status(3));
    await el.updateComplete;
    await type(el, KEY);
    return el;
  }

  it("asks the person to confirm it is them, then sends the same key again and finishes", async () => {
    let answer!: (value: boolean) => void;
    const prompt = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { api, bodies } = realApi(prompt);
    const el = await openReal(api);
    button(el, "change-backup-key")!.click();
    await expect.poll(() => prompt.mock.calls.length).toBe(1);
    expect(button(el, "change-backup-key")!.disabled).toBe(true);
    expect(button(el, "cancel-backup-key")!.disabled).toBe(true);
    answer(true);
    await expect
      .poll(() => words(el.shadowRoot!.querySelector("[data-test=done]")))
      .toBe("Backups now use backup key 4.");
    expect(bodies).toEqual([{ masterKey: KEY }, { masterKey: KEY }]);
  });

  it("a cancelled confirmation changes nothing and leaves the button ready to press again", async () => {
    const prompt = vi.fn(async () => false);
    const { api, bodies } = realApi(prompt);
    const el = await openReal(api);
    const changed = vi.fn();
    el.addEventListener("backup-key-changed", changed);
    button(el, "change-backup-key")!.click();
    const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialogMessageOf(dialog)).not.toBe("");
    expect(await dialogMessageOf(dialog)).toBe(codeMessage("management_session.proof_required"));
    expect(field(el).error).toBe("");
    expect(button(el, "change-backup-key")!.disabled).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(bodies).toEqual([{ masterKey: KEY }]);
  });
});

it("a lost answer may have changed the key, so the card and Backups read again", async () => {
  const rotate = vi.fn().mockRejectedValue({ code: "connection.failed" });
  const api = stubApi(rotate);
  const { el, dialog } = await open(api);
  const changed = vi.fn();
  el.addEventListener("backup-key-changed", changed);
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect.poll(() => dialogMessageOf(dialog)).toBe(codeMessage("connection.failed"));
  expect(api.liveData.invalidate).toHaveBeenCalledWith([{ type: "backup_status" }]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("Close after the change closes without asking", async () => {
  const { el, dialog } = await open(stubApi(vi.fn().mockResolvedValue(ANSWER)));
  await type(el, KEY);
  button(el, "change-backup-key")!.click();
  await expect.poll(() => button(el, "close-backup-key")).not.toBeNull();
  const closed = dialogClosed(dialog);
  button(el, "close-backup-key")!.click();
  await closed;
  expect(el.isOpen).toBe(false);
});
