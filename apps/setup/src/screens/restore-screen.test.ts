import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { RestoreRequestDetail } from "../events.js";
import { SetupRestoreScreen } from "./restore-screen.js";

afterEach(cleanupWidgets);
const q = <T extends HTMLElement>(el: SetupRestoreScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

describe("SetupRestoreScreen", () => {
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
    });
  });
});
