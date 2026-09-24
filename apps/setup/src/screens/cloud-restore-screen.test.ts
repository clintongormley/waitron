import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { SetupCloudRestoreScreen } from "./cloud-restore-screen.js";
import "./cloud-restore-screen.js";

afterEach(cleanupWidgets);
const q = (el: SetupCloudRestoreScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
describe("Cloud restore screen", () => {
  it("starts pairing and shows only the code, link and deadline", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>(
      "setup-cloud-restore-screen",
      {},
    );
    const listener = vi.fn();
    host.addEventListener("cloud-restore-action", listener);
    q(el, "[data-test=start]")!.click();
    expect(listener.mock.calls[0]?.[0].detail.action).toBe("start");
    el.view = {
      requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      code: "12345678",
      openCloudUrl:
        "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "awaiting_owner",
    };
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("12345678");
    expect(q(el, "[data-test=open-cloud]")?.getAttribute("href")).toBe(el.view.openCloudUrl);
    expect(q(el, "[data-test=check]")).not.toBeNull();
    q(el, "[data-test=check]")!.click();
    expect(listener.mock.calls.at(-1)?.[0].detail.action).toBe("status");
  });
  it("requires a local acknowledgement of the approved snapshot before restoring", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>(
      "setup-cloud-restore-screen",
      {},
    );
    el.view = {
      requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      code: "12345678",
      openCloudUrl:
        "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "approved",
      point: {
        id: "e8722eb0-3f02-4f35-920b-9b5f6bfb05e8",
        venueId: "fe78bc70-b66f-4b2f-970d-7acbd3739977",
        capturedAt: "2026-09-24T10:00:00.000Z",
        modules: { core: 1 },
      },
    };
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("cloud-restore-action", listener);
    q(el, "[data-test=restore]")!.click();
    expect(listener).not.toHaveBeenCalled();
    const checkbox = q(el, "[data-test=acknowledge]") as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await el.updateComplete;
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls[0]?.[0].detail).toEqual({
      action: "restore",
      pointId: el.view.point!.id,
    });
    expect(el.shadowRoot!.textContent).toContain("2026-09-24");
  });
  it("offers a new request only when the displayed request has expired", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>(
      "setup-cloud-restore-screen",
      {},
    );
    const listener = vi.fn();
    host.addEventListener("cloud-restore-action", listener);
    el.view = {
      requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      code: "12345678",
      openCloudUrl:
        "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "expired",
    };
    await el.updateComplete;
    expect(q(el, "[data-test=start-again]")).not.toBeNull();
    expect(q(el, "[data-test=open-cloud]")).toBeNull();
    q(el, "[data-test=start-again]")!.click();
    expect(listener.mock.calls[0]?.[0].detail.action).toBe("start-again");
  });
});
