import { afterEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { SetupApi } from "../api/client.js";
import { handoverEs } from "../i18n/strings/handover.js";
import type { SetupHandoverScreen } from "./handover-screen.js";
import "./handover-screen.js";

const status = {
  operationId: "move one",
  role: "destination",
  scenario: "controlled",
  state: "filing_assumed",
  sourceNodeId: "old",
  destinationNodeId: "new",
  waitingReason: null,
  copyPlaced: true,
};
afterEach(() => vi.restoreAllMocks());
it("the Spanish handover words call the box «servidor», never «equipo»", () => {
  expect(Object.values(handoverEs).filter((words) => /equipo/i.test(words))).toEqual([]);
  expect(handoverEs["handover.starting"]).toBe("Iniciando el local en este servidor…");
});
it("reads operation status without extending a session, and cancels on leaving", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ body: status })));
  const controller = new AbortController();
  const api = new SetupApi("", fetcher);
  expect(await api.handoverStatus("move one", controller.signal)).toEqual(status);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/node/handover/move%20one",
    expect.objectContaining({ signal: controller.signal, credentials: "omit", cache: "no-store" }),
  );
});
it("posts the selected operation and sign-in separately from the clock proposal", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ status: "selected" })),
  );
  const api = new SetupApi("", fetcher);
  const signIn = { email: "owner@example.com", password: "secret", totp: "123456" };
  const moduleOperation = {
    binding: {
      module: "fiscal-verifactu",
      action: "promote",
      eventId: "move one",
      sourceId: "old",
      targetNodeId: "new",
    },
    input: {},
  };
  await api.prepareHandover("move one", signIn, moduleOperation.binding, { action: "select" });
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    signIn,
    moduleOperation: { binding: moduleOperation.binding, input: null },
    proposal: { action: "select" },
  });
  await api.activateHandover("move one", signIn, moduleOperation);
  expect(fetcher.mock.calls[1]![0]).toBe("/api/node/handover/move%20one/activate");
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
    signIn,
    moduleOperation,
  });
});

it("does not expose clock selection until the final copy is actually placed", async () => {
  const { mountWidget, cleanupWidgets } = await import("../widgets/test-helpers.js");
  const api = new SetupApi(
    "",
    vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ body: { ...status, copyPlaced: undefined } })),
    ),
  );
  const { el } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
    api,
    operationId: "move one",
  });
  try {
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("Preparing the final copy"),
    );
    expect(el.shadowRoot!.querySelector('[name="handover-password"]')).toBeNull();
    expect(el.shadowRoot!.querySelector("vf-recovery-hour")).toBeNull();
  } finally {
    cleanupWidgets();
  }
});

it("cancels a pending read on disconnect and ignores its late answer on reopening", async () => {
  const { mountWidget, cleanupWidgets } = await import("../widgets/test-helpers.js");
  let release!: (value: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(new Response(JSON.stringify({ body: { ...status, state: "activated" } })));
  const { el, host } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
    api: new SetupApi("", fetcher),
    operationId: "move one",
  });
  try {
    el.remove();
    expect((fetcher.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true);
    host.append(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
    );
    release(new Response(JSON.stringify({ body: status })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.shadowRoot!.querySelector('[name="handover-password"]')).toBeNull();
  } finally {
    cleanupWidgets();
  }
});

describe("This device on the handover's clock step", () => {
  const binding = {
    module: "fiscal-verifactu",
    action: "promote",
    eventId: "move one",
    sourceId: "old",
    targetNodeId: "new",
  };
  const now = Date.now();
  const reading = (source: string, ms: number) => ({ source, lowerMs: ms, upperMs: ms });
  const clock = (agree: boolean) => ({
    usable: [reading("box", now), reading("browser", agree ? now : now + 5 * 60_000)],
    unavailable: [],
    secondClock: true,
    disagreement: !agree,
    releaseBlocked: false,
    rangeBlocked: false,
  });
  const input = {
    allocation: {
      installationIdentity: "0CSQW",
      series: [{ code: "A-0CSQW", purpose: "standard" }],
    },
  };
  async function mount(answer: unknown) {
    const { mountWidget } = await import("../widgets/test-helpers.js");
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    let set = false;
    let state = status.state;
    const fetcher = vi.fn<typeof fetch>(async (path, init) => {
      if (init?.method === "GET")
        return new Response(JSON.stringify({ body: { ...status, state } }));
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      posts.push({ path: String(path), body });
      if (String(path).endsWith("/activate")) {
        state = "activated";
        return new Response(JSON.stringify({ activated: true, restarting: true }));
      }
      const action = (body.proposal as { action: string }).action;
      if (action === "set-clock") set = (answer as { status: string }).status === "set";
      const result =
        action === "clock-challenge"
          ? { id: "challenge" }
          : action === "compare-clocks"
            ? { id: "comparison", clock: clock(set) }
            : action === "set-clock"
              ? answer
              : { status: "selected", identity: "0CSQW", binding, input };
      return new Response(JSON.stringify(result));
    });
    const { el } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
      api: new SetupApi("", fetcher),
      operationId: "move one",
    });
    const q = <T extends HTMLElement>(root: HTMLElement, selector: string) =>
      root.shadowRoot!.querySelector<T>(selector)!;
    await vi.waitFor(() => expect(q(el, '[name="handover-password"]')).not.toBeNull());
    for (const [name, value] of [
      ["handover-email", "owner@example.com"],
      ["handover-password", "correct horse"],
      ["handover-code", "123456"],
    ] as const) {
      const field = q<LitElement>(el, `[name="${name}"]`);
      await field.updateComplete;
      const native = field.shadowRoot!.querySelector("input")!;
      native.value = value;
      native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    await el.updateComplete;
    q(el, "[data-test=authenticate]").click();
    await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
    const entry = q<LitElement>(el, "vf-recovery-hour");
    await entry.updateComplete;
    const tick = q<HTMLInputElement>(entry, '[name="recovery-details-confirmed"]');
    tick.checked = true;
    tick.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(q<HTMLElement & { disabled: boolean }>(entry, "[data-test=compare]").disabled).toBe(
        false,
      ),
    );
    q(entry, "[data-test=compare]").click();
    await vi.waitFor(() => expect(q(entry, "[data-test=device-correct]")).not.toBeNull());
    q(entry, "[data-test=device-correct]").click();
    return { el, entry, posts };
  }
  afterEach(async () => (await import("../widgets/test-helpers.js")).cleanupWidgets());
  const actions = (posts: { body: Record<string, unknown> }[]) =>
    posts.map(
      (post) => (post.body.proposal as { action?: string } | undefined)?.action ?? "activate",
    );

  it("sends the set under the administrator's sign-in, then starts the venue with nobody pressing", async () => {
    const { el, posts } = await mount({ status: "set" });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
    );
    expect(actions(posts)).toEqual([
      "clock-challenge",
      "compare-clocks",
      "clock-challenge",
      "set-clock",
      "clock-challenge",
      "compare-clocks",
      "select",
      "activate",
    ]);
    const set = posts[3]!;
    expect(set.path).toBe("/api/node/handover/move%20one/preparation");
    expect(set.body.signIn).toEqual({
      email: "owner@example.com",
      password: "correct horse",
      totp: "123456",
    });
    expect(set.body.moduleOperation).toEqual({ binding, input: null });
  });

  it("a spare whose start the internet confirmed says its time is right and what to do", async () => {
    const { entry, posts } = await mount({ status: "refused", reason: "not_stopped" });
    await vi.waitFor(() =>
      expect(entry.shadowRoot!.querySelector("[data-test=device-clock]")?.textContent?.trim()).toBe(
        "The server keeps its time over the internet, so its time is right. Correct the time on this device, then reconnect to the server.",
      ),
    );
    expect(actions(posts)).not.toContain("select");
  });
});
