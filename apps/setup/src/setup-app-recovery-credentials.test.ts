import { afterEach, expect, it, vi } from "vitest";
import { SetupApi } from "./api/client.js";
import { SetupApp } from "./setup-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const credentials = {
  recoveryOperation: {
    binding: {
      module: "fiscal-verifactu",
      action: "restore",
      eventId: "outside-event",
      sourceId: "selected-copy-digest",
      targetNodeId: "00000000-0000-4000-8000-000000000001",
    },
    input: { allocation: "public-reservation", approval: "outside-incident" },
  },
  nodeRecoverySecret: "node-key-secret",
};
it.each(["archive", "bucket"])(
  "drops the entered node key from a refused %s request",
  async (kind) => {
    const api = new SetupApi("https://box.example.test", async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST")
        return new Response(
          JSON.stringify({
            error: { code: "setup.request_invalid", params: { field: "nodeRecoverySecret" } },
          }),
          { status: 400 },
        );
      return new Response(
        JSON.stringify(
          new URL(request.url).pathname.endsWith("/status")
            ? { environment: "preproduction", needs: ["venue"] }
            : {},
        ),
      );
    });
    const { el } = await mountWidget<SetupApp>("setup-app", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("setup-mode-screen")).not.toBeNull(),
    );
    Object.assign(el, { screen: kind === "archive" ? "restore" : "restore-bucket" });
    await el.updateComplete;
    const owner = el.shadowRoot!.querySelector(
      kind === "archive" ? "setup-restore-screen" : "setup-restore-bucket-screen",
    )!;
    owner.dispatchEvent(
      new CustomEvent(kind === "archive" ? "restore-requested" : "bucket-restore-requested", {
        bubbles: true,
        composed: true,
        detail: {
          request:
            kind === "archive"
              ? {
                  artifact: new File(["encrypted"], "copy.backup"),
                  recoveryKey: "archive-key",
                  environment: "production",
                  oldBoxGone: true,
                  ...credentials,
                }
              : {
                  kit: "outside-bucket-kit",
                  environment: "production",
                  oldBoxGone: true,
                  venueConfirmed: null,
                  ...credentials,
                },
        },
      }),
    );
    const readKept = () =>
      (
        el as unknown as {
          restoreRequest?: Record<string, unknown>;
          bucketRequest?: Record<string, unknown>;
        }
      )[kind === "archive" ? "restoreRequest" : "bucketRequest"];
    await vi.waitFor(() => expect(readKept()).toBeDefined());
    const kept = readKept();
    expect(kept).toBeDefined();
    expect(kept!.nodeRecoverySecret).toBeUndefined();
    expect(kept!.recoveryOperation).toBeUndefined();
    expect(kind === "archive" ? kept!.recoveryKey : kept!.kit).toBe(
      kind === "archive" ? "archive-key" : "outside-bucket-kit",
    );
  },
);
it.each(["archive", "cloud"])(
  "the real setup shell sends %s credentials in the request body",
  async (kind) => {
    const calls: Request[] = [];
    const api = new SetupApi("https://box.example.test", async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      const path = new URL(request.url).pathname;
      const answer = path.endsWith("/status")
        ? { environment: "preproduction", needs: ["venue"] }
        : path.endsWith("/discovery")
          ? { caDownloadAvailable: false }
          : path.endsWith("/venue-defaults")
            ? {}
            : { restoreStaged: true, restarting: true };
      return new Response(JSON.stringify(answer));
    });
    const { el } = await mountWidget<SetupApp>("setup-app", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("setup-mode-screen")).not.toBeNull(),
    );
    const cloudRecoveryView = {
      requestId: "request",
      state: "approved",
      code: "12345678",
      expiresAt: "2026-10-14T23:00:00Z",
      openCloudUrl: "https://cloud.example.test",
      point: { id: "point", venueId: "venue", capturedAt: "2026-10-01T08:00:00Z", modules: {} },
    };
    Object.assign(el, {
      screen: kind === "archive" ? "restore" : "cloud-restore",
      cloudRecoveryView,
    });
    await el.updateComplete;
    const owner = el.shadowRoot!.querySelector(
      kind === "archive" ? "setup-restore-screen" : "setup-cloud-restore-screen",
    )!;
    owner.dispatchEvent(
      new CustomEvent(kind === "archive" ? "restore-requested" : "cloud-restore-action", {
        bubbles: true,
        composed: true,
        detail:
          kind === "archive"
            ? {
                request: {
                  artifact: new File(["encrypted"], "copy.backup"),
                  recoveryKey: "archive-key",
                  environment: "production",
                  oldBoxGone: true,
                  ...credentials,
                },
              }
            : { action: "restore", pointId: "point", oldBoxGone: true, ...credentials },
      }),
    );
    await vi.waitFor(() => expect(calls.some((request) => request.method === "POST")).toBe(true));
    const request = calls.find((request) => request.method === "POST")!;
    expect(request.url).not.toContain("node-key-secret");
    if (kind === "archive") {
      expect(request.headers.get("content-type")).toContain("multipart/form-data");
      const body = await request.formData();
      expect(body.get("nodeRecoverySecret")).toBe("node-key-secret");
      expect(JSON.parse(body.get("recoveryOperation") as string)).toEqual(
        credentials.recoveryOperation,
      );
      expect(body.get("recoveryKey")).toBe("archive-key");
    } else expect(await request.json()).toMatchObject(credentials);
  },
);
