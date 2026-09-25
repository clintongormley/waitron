import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { RestoreRequestDetail } from "../events.js";
import { SetupRestoreScreen } from "./restore-screen.js";

afterEach(cleanupWidgets);
const q = <T extends HTMLElement>(el: SetupRestoreScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

const BACKUP = new File(["encrypted"], "waitron.backup");

async function fill(
  el: SetupRestoreScreen,
  decisions: { artifact?: boolean; recoveryKey?: boolean; acknowledge?: boolean },
): Promise<void> {
  if (decisions.artifact) {
    const file = q<HTMLInputElement>(el, "[data-test=artifact]")!;
    Object.defineProperty(file, "files", { value: [BACKUP] });
    file.dispatchEvent(new Event("change"));
  }
  if (decisions.recoveryKey) {
    const key = q<HTMLInputElement>(el, "[data-test=recovery-key]")!;
    key.value = "recovery-key";
    key.dispatchEvent(new Event("input"));
  }
  if (decisions.acknowledge) {
    const ack = q<HTMLInputElement>(el, "[data-test=acknowledge]")!;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
  }
  await el.updateComplete;
}

async function summaryItems(el: SetupRestoreScreen): Promise<string[]> {
  const summary = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "[data-test=error]");
  if (summary === null) return [];
  await summary.updateComplete;
  return [...summary.shadowRoot!.querySelectorAll("li")].map((li) => li.textContent!.trim());
}

describe("SetupRestoreScreen", () => {
  it("opens guided Cloud recovery from backup file restore", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const navigation = vi.fn();
    host.addEventListener("setup-goto", navigation);
    q(el, "[data-test=cloud-restore]")!.click();
    expect(navigation.mock.calls[0]?.[0].detail).toEqual({ screen: "cloud-restore" });
  });

  it("marks every required decision and emits nothing when blank", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    const summary = el.shadowRoot!.querySelector("wt-form-error-summary") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await summary.updateComplete;
    expect(summary.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[required]")).toHaveLength(4);
  });

  it("emits the artifact, recovery key, environment and acknowledgement", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const artifact = new File(["encrypted"], "waitron.backup");
    const file = q<HTMLInputElement>(el, "[data-test=artifact]")!;
    Object.defineProperty(file, "files", { value: [artifact] });
    file.dispatchEvent(new Event("change"));
    const key = q<HTMLInputElement>(el, "[data-test=recovery-key]")!;
    key.value = "recovery-key";
    key.dispatchEvent(new Event("input"));
    const ack = q<HTMLInputElement>(el, "[data-test=acknowledge]")!;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await el.updateComplete;

    const outcome = new Promise<RestoreRequestDetail>((resolve) =>
      host.addEventListener("restore-requested", (event: Event) => {
        resolve((event as CustomEvent<{ request: RestoreRequestDetail }>).detail.request);
      }),
    );
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({
      artifact,
      recoveryKey: "recovery-key",
      environment: "production",
      oldBoxGone: false,
    });
  });

  it("restores a preparation backup when the operator picks that environment", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    const environment = q<HTMLSelectElement>(el, "[data-test=environment]")!;
    environment.value = "preproduction";
    environment.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      {
        artifact: BACKUP,
        recoveryKey: "recovery-key",
        environment: "preproduction",
        oldBoxGone: false,
      },
    ]);
  });

  it.each([
    ["the backup file", { recoveryKey: true, acknowledge: true }, "Choose a backup file."],
    ["the recovery key", { artifact: true, acknowledge: true }, "Enter the recovery key."],
    [
      "the confirmation",
      { artifact: true, recoveryKey: true },
      "Confirm that no other running server has newer data.",
    ],
  ])("lists only %s when it is the one decision missing", async (_, decisions, message) => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await fill(el, decisions);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(await summaryItems(el)).toEqual([message]);
  });

  it("asks the old-server question when the old server wrote recently, and sends the answer", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("2026-09-23T11:58:00.000Z");
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(await summaryItems(el)).toEqual([
      "Confirm that the old server is switched off for good.",
    ]);
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(
      "Confirm that the old server is switched off for good.",
    );
    const box = q<HTMLInputElement>(el, "[data-test=old-box-gone]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
    q(el, "[data-test=restore]")!.click();
    expect(listener).toHaveBeenCalledOnce();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ request: RestoreRequestDetail }>).detail.request
        .oldBoxGone,
    ).toBe(true);
  });

  it("asks the same question when whether the old server is writing could not be checked", async () => {
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      liveUnknown: true,
    });
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("could not be checked");
    expect(q(el, "[data-test=old-box-gone]")).not.toBeNull();
  });

  it("sends no old-server answer when it was not asked", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ request: RestoreRequestDetail }>).detail.request
        .oldBoxGone,
    ).toBe(false);
  });

  // The old-server question is answered by sending the same backup again; the shell hands the last
  // request back so the file does not have to be chosen and the key typed a second time.
  it("comes back from a refusal with the backup, the key and the answers kept", async () => {
    const request: RestoreRequestDetail = {
      artifact: BACKUP,
      recoveryKey: "recovery-key",
      environment: "preproduction",
      oldBoxGone: false,
    };
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      request,
      liveUnknown: true,
    });
    expect(q<HTMLInputElement>(el, "[data-test=artifact]")!.files?.[0]).toBe(BACKUP);
    expect(q<HTMLInputElement>(el, "[data-test=recovery-key]")!.value).toBe("recovery-key");
    expect(q<HTMLSelectElement>(el, "[data-test=environment]")!.value).toBe("preproduction");
    expect(q<HTMLInputElement>(el, "[data-test=acknowledge]")!.checked).toBe(true);
    const box = q<HTMLInputElement>(el, "[data-test=old-box-gone]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { ...request, oldBoxGone: true },
    ]);
  });

  // The old-server check was made on the backup that was sent; another file is another copy.
  it("drops the old-server answer when a different backup file is chosen", async () => {
    const request: RestoreRequestDetail = {
      artifact: BACKUP,
      recoveryKey: "recovery-key",
      environment: "production",
      oldBoxGone: true,
    };
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      request,
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    expect(q<HTMLInputElement>(el, "[data-test=old-box-gone]")!.checked).toBe(true);
    const other = new File(["other"], "other.backup");
    const file = q<HTMLInputElement>(el, "[data-test=artifact]")!;
    Object.defineProperty(file, "files", { value: [other] });
    file.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { ...request, artifact: other, oldBoxGone: false },
    ]);
  });

  it("steps back to the role screen", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    q(el, "[data-test=back]")!.click();
    expect(goto.mock.calls.map(([event]) => (event as CustomEvent).detail.screen)).toEqual([
      "role",
    ]);
  });
});
