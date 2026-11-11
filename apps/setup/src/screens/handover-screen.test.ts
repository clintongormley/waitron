import { afterEach, expect, it, vi } from "vitest";
import { SetupApi } from "../api/client.js";
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
