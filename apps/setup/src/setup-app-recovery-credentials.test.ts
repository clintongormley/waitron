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
const hourContext = {
  selectedSourceId: "selected-copy-digest",
  oldBoxGone: true,
  soleRecovery: true,
};
it.each(["archive", "bucket", "cloud"])(
  "the shell retains independent hour-recovery context in the %s HTTP body",
  async (kind) => {
    const posts: Request[] = [];
    const api = new SetupApi("https://box.example.test", async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST") {
        posts.push(request);
        return Response.json({ restoreStaged: true, restarting: true });
      }
      return Response.json(
        new URL(request.url).pathname.endsWith("/status")
          ? { environment: "production", needs: ["venue"] }
          : {},
      );
    });
    const { el } = await mountWidget<SetupApp>("setup-app", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("setup-mode-screen")).not.toBeNull(),
    );
    Object.assign(el, {
      screen:
        kind === "archive" ? "restore" : kind === "bucket" ? "restore-bucket" : "cloud-restore",
      cloudRecoveryView: {
        requestId: "request",
        state: "approved",
        code: "12345678",
        expiresAt: "2026-10-18T23:00:00Z",
        openCloudUrl: "https://cloud.example.test",
        point: { id: "point", venueId: "venue", capturedAt: "2026-10-17T12:30:00Z", modules: {} },
      },
    });
    await el.updateComplete;
    const owner = el.shadowRoot!.querySelector(
      kind === "archive"
        ? "setup-restore-screen"
        : kind === "bucket"
          ? "setup-restore-bucket-screen"
          : "setup-cloud-restore-screen",
    )!;
    const common = { ...credentials, recoveryContext: hourContext, oldBoxGone: true };
    owner.dispatchEvent(
      new CustomEvent(
        kind === "archive"
          ? "restore-requested"
          : kind === "bucket"
            ? "bucket-restore-requested"
            : "cloud-restore-action",
        {
          bubbles: true,
          composed: true,
          detail:
            kind === "cloud"
              ? { action: "restore", pointId: "point", ...common }
              : {
                  request:
                    kind === "archive"
                      ? {
                          artifact: new File(["encrypted"], "copy.backup"),
                          recoveryKey: "archive password",
                          environment: "production",
                          ...common,
                        }
                      : {
                          kit: "private kit",
                          environment: "production",
                          venueConfirmed: null,
                          ...common,
                        },
                },
        },
      ),
    );
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const request = posts[0]!;
    const body =
      kind === "archive"
        ? JSON.parse(String((await request.formData()).get("recoveryContext")))
        : ((await request.json()) as { recoveryContext: unknown }).recoveryContext;
    expect(body).toEqual(hourContext);
  },
);
it.each(["archive", "bucket"])(
  "a refused %s keeps no earlier hour-recovery declarations",
  async (kind) => {
    const api = new SetupApi("https://box.example.test", async (input, init) => {
      const request = new Request(input, init);
      return request.method === "POST"
        ? Response.json(
            { error: { code: "setup.request_invalid", params: { field: "nodeRecoverySecret" } } },
            { status: 400 },
          )
        : Response.json(
            new URL(request.url).pathname.endsWith("/status")
              ? { environment: "production", needs: ["venue"] }
              : {},
          );
    });
    const { el } = await mountWidget<SetupApp>("setup-app", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("setup-mode-screen")).not.toBeNull(),
    );
    Object.assign(el, { screen: kind === "archive" ? "restore" : "restore-bucket" });
    await el.updateComplete;
    el.shadowRoot!.querySelector(
      kind === "archive" ? "setup-restore-screen" : "setup-restore-bucket-screen",
    )!.dispatchEvent(
      new CustomEvent(kind === "archive" ? "restore-requested" : "bucket-restore-requested", {
        bubbles: true,
        composed: true,
        detail: {
          request: {
            ...credentials,
            recoveryContext: hourContext,
            oldBoxGone: true,
            environment: "production",
            ...(kind === "archive"
              ? {
                  artifact: new File(["encrypted"], "copy.backup"),
                  recoveryKey: "archive password",
                }
              : { kit: "private kit", venueConfirmed: null }),
          },
        },
      }),
    );
    const kept = () =>
      (
        el as unknown as {
          restoreRequest?: Record<string, unknown>;
          bucketRequest?: Record<string, unknown>;
        }
      )[kind === "archive" ? "restoreRequest" : "bucketRequest"];
    await vi.waitFor(() => expect(kept()).toBeDefined());
    expect(kept()!.recoveryContext).toBeUndefined();
  },
);
it.each(["archive", "bucket", "cloud"])(
  "the %s screen identifies the real named-key authentication refusal",
  async (kind) => {
    const api = new SetupApi("https://box.example.test", async (input, init) => {
      const request = new Request(input, init);
      return request.method === "POST"
        ? Response.json(
            { error: { code: "promotion.break_glass_invalid", params: {} } },
            { status: 403 },
          )
        : Response.json(
            new URL(request.url).pathname.endsWith("/status")
              ? { environment: "production", needs: ["venue"] }
              : {},
          );
    });
    const { el } = await mountWidget<SetupApp>("setup-app", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("setup-mode-screen")).not.toBeNull(),
    );
    const selector =
      kind === "archive"
        ? "setup-restore-screen"
        : kind === "bucket"
          ? "setup-restore-bucket-screen"
          : "setup-cloud-restore-screen";
    Object.assign(el, {
      screen:
        kind === "archive" ? "restore" : kind === "bucket" ? "restore-bucket" : "cloud-restore",
      cloudRecoveryView: {
        requestId: "request",
        state: "approved",
        code: "12345678",
        expiresAt: "2026-10-18T23:00:00Z",
        openCloudUrl: "https://cloud.example.test",
        point: { id: "point", venueId: "venue", capturedAt: "2026-10-17T12:30:00Z", modules: {} },
      },
    });
    await el.updateComplete;
    const common = { ...credentials, recoveryContext: hourContext, oldBoxGone: true };
    el.shadowRoot!.querySelector(selector)!.dispatchEvent(
      new CustomEvent(
        kind === "archive"
          ? "restore-requested"
          : kind === "bucket"
            ? "bucket-restore-requested"
            : "cloud-restore-action",
        {
          bubbles: true,
          composed: true,
          detail:
            kind === "cloud"
              ? { action: "restore", pointId: "point", ...common }
              : {
                  request:
                    kind === "archive"
                      ? {
                          artifact: new File(["encrypted"], "copy.backup"),
                          recoveryKey: "archive password",
                          environment: "production",
                          ...common,
                        }
                      : {
                          kit: "private kit",
                          environment: "production",
                          venueConfirmed: null,
                          ...common,
                        },
                },
        },
      ),
    );
    await vi.waitFor(() =>
      expect(
        (el.shadowRoot!.querySelector(selector) as HTMLElement & { invalidField?: string })
          ?.invalidField,
      ).toBe("nodeRecoverySecret"),
    );
  },
);
