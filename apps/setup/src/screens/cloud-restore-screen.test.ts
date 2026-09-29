import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { SetupCloudRestoreScreen } from "./cloud-restore-screen.js";
import "./cloud-restore-screen.js";
import { OLD_BOX_PROBLEM } from "./old-box-question.js";

afterEach(cleanupWidgets);
const q = (el: SetupCloudRestoreScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const approvedView = (pointId = "e8722eb0-3f02-4f35-920b-9b5f6bfb05e8") => ({
  requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
  code: "12345678",
  openCloudUrl: "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
  expiresAt: "2026-09-24T12:00:00.000Z",
  state: "approved" as const,
  point: {
    id: pointId,
    venueId: "fe78bc70-b66f-4b2f-970d-7acbd3739977",
    capturedAt: "2026-09-24T10:00:00.000Z",
    modules: { core: 1 },
  },
});
const tick = async (el: SetupCloudRestoreScreen, selector: string, checked = true) => {
  const box = q(el, selector) as HTMLInputElement;
  box.checked = checked;
  box.dispatchEvent(new Event("change"));
  await el.updateComplete;
};
/** The message element `wt-form-actions` shows beside Restore, or null when there is none. */
async function bottomElement(el: SetupCloudRestoreScreen): Promise<HTMLElement | null> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector<HTMLElement>("[data-error]");
}
async function bottomOf(el: SetupCloudRestoreScreen): Promise<string> {
  return (await bottomElement(el))?.textContent?.trim() ?? "";
}
/** The messages shown under the fields, in page order. */
function fieldMessages(el: SetupCloudRestoreScreen): string[] {
  return [...el.shadowRoot!.querySelectorAll("p.error[id$='-error']")].map((p) =>
    p.textContent!.trim(),
  );
}
const FIX_FIELDS = "Correct the highlighted fields to continue.";
const ACKNOWLEDGE_PROBLEM =
  "Confirm that the old server and surviving peers are stopped, and that you accept losing changes after this snapshot.";

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
      oldBoxGone: false,
    });
    expect(q(el, "[data-test=live-warning]")).toBeNull();
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

  it("requires a fresh acknowledgement when the approved request or point changes or disappears", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>(
      "setup-cloud-restore-screen",
      {},
    );
    const listener = vi.fn();
    host.addEventListener("cloud-restore-action", listener);
    const first = {
      requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      code: "12345678",
      openCloudUrl:
        "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "approved" as const,
      point: {
        id: "e8722eb0-3f02-4f35-920b-9b5f6bfb05e8",
        venueId: "fe78bc70-b66f-4b2f-970d-7acbd3739977",
        capturedAt: "2026-09-24T10:00:00.000Z",
        modules: { core: 1 },
      },
    };
    el.view = first;
    await el.updateComplete;
    const acknowledge = () => {
      const checkbox = q(el, "[data-test=acknowledge]") as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));
    };
    acknowledge();
    await el.updateComplete;
    el.view = { ...first, point: { ...first.point, id: "e8722eb0-3f02-4f35-920b-9b5f6bfb05e9" } };
    q(el, "[data-test=restore]")!.click();
    expect(listener).not.toHaveBeenCalled();
    await el.updateComplete;
    expect((q(el, "[data-test=acknowledge]") as HTMLInputElement).checked).toBe(false);
    q(el, "[data-test=restore]")!.click();
    expect(listener).not.toHaveBeenCalled();

    acknowledge();
    await el.updateComplete;
    el.view = { ...first, requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea4" };
    await el.updateComplete;
    expect((q(el, "[data-test=acknowledge]") as HTMLInputElement).checked).toBe(false);
    q(el, "[data-test=restore]")!.click();
    expect(listener).not.toHaveBeenCalled();

    acknowledge();
    await el.updateComplete;
    el.view = { ...first, state: "awaiting_owner", point: undefined };
    await el.updateComplete;
    expect(q(el, "[data-test=restore]")).toBeNull();
    el.view = first;
    await el.updateComplete;
    expect((q(el, "[data-test=acknowledge]") as HTMLInputElement).checked).toBe(false);
    q(el, "[data-test=restore]")!.click();
    expect(listener).not.toHaveBeenCalled();
  });

  it("blocks Cloud actions while busy and allows the operator to return to backup file restore", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      busy: true,
    });
    const actions = vi.fn();
    const navigation = vi.fn();
    host.addEventListener("cloud-restore-action", actions);
    host.addEventListener("setup-goto", navigation);
    expect(q(el, "[data-test=start]")?.hasAttribute("disabled")).toBe(true);
    q(el, "[data-test=start]")!.click();
    expect(actions).not.toHaveBeenCalled();

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
    for (const selector of ["[data-test=check]", "[data-test=restore]"]) {
      expect(q(el, selector)?.hasAttribute("disabled")).toBe(true);
      q(el, selector)!.click();
    }
    expect(actions).not.toHaveBeenCalled();
    q(el, "wt-button[slot=cancel]")!.click();
    expect(navigation.mock.calls[0]?.[0].detail).toEqual({ screen: "restore" });
  });

  it("shows a server error and clears a stale confirmation prompt after approval changes", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      errorMessage: "Cloud recovery is unavailable. Try again.",
    });
    expect((await bottomElement(el))?.getAttribute("role")).toBe("alert");
    expect(await bottomOf(el)).toContain("Cloud recovery is unavailable. Try again.");
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
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([ACKNOWLEDGE_PROBLEM]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    el.view = { ...el.view, state: "awaiting_owner", point: undefined };
    await el.updateComplete;
    el.view = {
      ...el.view,
      state: "approved",
      point: {
        id: "e8722eb0-3f02-4f35-920b-9b5f6bfb05e9",
        venueId: "fe78bc70-b66f-4b2f-970d-7acbd3739977",
        capturedAt: "2026-09-24T10:00:00.000Z",
        modules: { core: 1 },
      },
    };
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([]);
    expect(await bottomOf(el)).not.toContain(FIX_FIELDS);
    expect(await bottomOf(el)).toContain("Cloud recovery is unavailable");
    el.errorMessage = undefined;
    await el.updateComplete;
    expect(q(el, "[role=alert]")).toBeNull();
    expect(await bottomElement(el)).toBeNull();
  });
});

describe("Cloud restore screen asking whether the old server is gone", () => {
  it("names when the old server last wrote, and restores only once the owner says it is gone", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    const listener = vi.fn();
    host.addEventListener("cloud-restore-action", listener);
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("2026-09-23T11:58:00.000Z");
    await tick(el, "[data-test=acknowledge]");
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(OLD_BOX_PROBLEM);
    expect(q(el, "[data-test=old-box-gone]")!.getAttribute("aria-invalid")).toBe("true");
    await tick(el, "[data-test=old-box-gone]");
    expect(q(el, "#old-box-gone-error")).toBeNull();
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => event.detail)).toEqual([
      { action: "restore", pointId: el.view!.point!.id, oldBoxGone: true },
    ]);
  });

  it("says the old server could not be checked, and still needs the acknowledgement", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
      liveUnknown: true,
    });
    const listener = vi.fn();
    host.addEventListener("cloud-restore-action", listener);
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("could not be checked");
    await tick(el, "[data-test=old-box-gone]");
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(q(el, "#old-box-gone-error")).toBeNull();
    await tick(el, "[data-test=acknowledge]");
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls[0]?.[0].detail.oldBoxGone).toBe(true);
  });

  it("asks nothing before a snapshot is approved", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: { ...approvedView(), state: "awaiting_owner", point: undefined },
      liveUnknown: true,
    });
    expect(q(el, "[data-test=live-warning]")).toBeNull();
  });

  it("needs a fresh answer when the approved snapshot changes", async () => {
    const { el, host } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
      liveUnknown: true,
    });
    const listener = vi.fn();
    host.addEventListener("cloud-restore-action", listener);
    await tick(el, "[data-test=acknowledge]");
    await tick(el, "[data-test=old-box-gone]");
    el.view = approvedView("e8722eb0-3f02-4f35-920b-9b5f6bfb05e9");
    await el.updateComplete;
    expect((q(el, "[data-test=old-box-gone]") as HTMLInputElement).checked).toBe(false);
    await tick(el, "[data-test=acknowledge]");
    q(el, "[data-test=restore]")!.click();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("Cloud restore screen listing what is still unanswered", () => {
  it("marks the acknowledgement beside the field and in one message beside Restore", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
    });
    const acknowledge = q(el, "[data-test=acknowledge]") as HTMLInputElement;
    expect(acknowledge.required).toBe(true);
    expect(acknowledge.name).toBe("no-running-server");
    expect(acknowledge.getAttribute("aria-invalid")).toBe("false");
    expect(acknowledge.hasAttribute("aria-describedby")).toBe(false);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([ACKNOWLEDGE_PROBLEM]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(acknowledge.getAttribute("aria-invalid")).toBe("true");
    expect(acknowledge.getAttribute("aria-describedby")).toBe("acknowledge-error");
    expect(q(el, "#acknowledge-error")!.textContent).toBe(ACKNOWLEDGE_PROBLEM);
  });

  it("lists both questions when neither is answered, then only the one left, then nothing", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
      liveUnknown: true,
      errorMessage: "Cloud recovery is unavailable. Try again.",
    });
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([ACKNOWLEDGE_PROBLEM, OLD_BOX_PROBLEM]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await tick(el, "[data-test=acknowledge]");
    expect(fieldMessages(el)).toEqual([OLD_BOX_PROBLEM]);
    expect(q(el, "#acknowledge-error")).toBeNull();
    const acknowledge = q(el, "[data-test=acknowledge]")!;
    expect(acknowledge.getAttribute("aria-invalid")).toBe("false");
    expect(acknowledge.hasAttribute("aria-describedby")).toBe(false);
    await tick(el, "[data-test=acknowledge]", false);
    await tick(el, "[data-test=old-box-gone]");
    expect(fieldMessages(el)).toEqual([ACKNOWLEDGE_PROBLEM]);
    await tick(el, "[data-test=acknowledge]");
    expect(fieldMessages(el)).toEqual([]);
    expect(await bottomOf(el)).toBe("");
  });

  it("says nothing and leaves Restore working before the first press", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
      liveUnknown: true,
    });
    expect(await bottomOf(el)).toBe("");
    expect(fieldMessages(el)).toEqual([]);
    expect(q(el, "wt-form-error-summary")).toBeNull();
    expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
  });

  it("focuses the first unanswered question and holds Restore until the last is answered", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
      liveUnknown: true,
    });
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(true);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=acknowledge]")),
    );
    await tick(el, "[data-test=acknowledge]");
    expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(true);
    await tick(el, "[data-test=old-box-gone]");
    expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
  });

  it("shows the server's refusal beside Restore, leaves Restore working, and drops it on the next press", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
      errorMessage: "Cloud recovery is unavailable. Try again.",
    });
    expect(await bottomOf(el)).toBe("Cloud recovery is unavailable. Try again.");
    expect(q(el, "[data-test=server-error]")).toBeNull();
    expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("shows a refusal of starting recovery in the bottom row and leaves Start working", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      errorMessage: "Cloud recovery is unavailable. Try again.",
    });
    expect(await bottomOf(el)).toBe("Cloud recovery is unavailable. Try again.");
    expect(q(el, "[data-test=start]")!.hasAttribute("disabled")).toBe(false);
  });
});

describe("Cloud restore screen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("walks through the approved snapshot in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
    });
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde Waitron Cloud");
    expect(q(el, "[data-test=open-cloud]")!.textContent).toBe("Abrir Waitron Cloud");
    expect(q(el, "[data-test=restore]")!.textContent).toBe("Restaurar esta instantánea");
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([
      "Confirma que el servidor anterior y los demás servidores que queden están detenidos, y que aceptas perder los cambios posteriores a esta instantánea.",
    ]);
    expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
  });

  it("switches language live, keeping the acknowledgement already ticked", async () => {
    const { el } = await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
      view: approvedView(),
    });
    await tick(el, "[data-test=acknowledge]");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde Waitron Cloud");
    expect((q(el, "[data-test=acknowledge]") as HTMLInputElement).checked).toBe(true);
  });
});
