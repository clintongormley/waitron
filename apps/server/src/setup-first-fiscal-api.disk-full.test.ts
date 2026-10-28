import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

type Host = Parameters<typeof mountFirstSetupResolutionApi>[1];

const ROUTE = "https://box.test/setup-api/first-setup/resolution";
const NEARLY_FULL = 1024 * 1024;
const ROOM = 4 * FULL_DISK_BYTES;
const IDS = { inspectionId: "inspection", revision: 1, ownerGeneration: 1 };
const OWNER_HEADERS = {
  "Content-Type": "application/json",
  "X-Waitron-Setup-Owner": "capability",
  "X-Waitron-Setup-Attempt": "attempt",
  "X-Waitron-Setup-Revision": "1",
  "X-Waitron-Setup-Generation": "1",
};

const sockets: TLSSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}

/** The engine's "cannot open" refusal, as `node:sqlite` raises it. */
function cannotOpen(): Error {
  return Object.assign(new Error("unable to open database file"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 14,
  });
}

function appWith(options: {
  free: number | null | Error;
  refusal?: unknown;
  database?: string;
  authorize?: () => Promise<never>;
  log?: Parameters<typeof mountFirstSetupResolutionApi>[2];
  onFreeRead?: () => void;
}) {
  const refuse = async (): Promise<never> => {
    throw options.refusal;
  };
  const host = {
    resolution: {
      inspectFirstSetupResolution: async () => ({
        ...IDS,
        database: options.database ?? "missing",
      }),
    },
    owner: { recoverFirstSetupOwner: refuse, authorize: options.authorize ?? refuse },
  } as unknown as Host;
  const app = new Hono();
  mountFirstSetupResolutionApi(app, host, options.log ?? (() => {}), {
    startAgain: refuse,
    summary: refuse,
    withPublication: refuse,
    freeSpace: async () => {
      options.onFreeRead?.();
      if (options.free instanceof Error) throw options.free;
      return options.free;
    },
  });
  return app;
}

const STEPS = {
  password: (app: Hono) =>
    app.request(
      `${ROUTE}/recover`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...IDS, clientClaimNonce: "nonce", password: "secret" }),
      },
      tls(),
    ),
  summary: (app: Hono) =>
    app.request(
      `${ROUTE}/start-again/summary`,
      { method: "POST", headers: OWNER_HEADERS, body: JSON.stringify(IDS) },
      tls(),
    ),
  "Start again": (app: Hono) =>
    app.request(
      `${ROUTE}/start-again`,
      { method: "POST", headers: OWNER_HEADERS, body: JSON.stringify(IDS) },
      tls(),
    ),
};

async function answer(response: Response) {
  return {
    status: response.status,
    code: ((await response.json()) as { error?: { code?: string } }).error?.code,
  };
}

const DISK_FULL = { status: 507, code: "storage.disk_full" };

it.each(Object.entries(STEPS))(
  "the %s step failing with an engine full-disk error on a nearly full disk answers 507 storage.disk_full",
  async (_step, send) => {
    expect(await answer(await send(appWith({ free: NEARLY_FULL, refusal: cannotOpen() })))).toEqual(
      DISK_FULL,
    );
  },
);

it.each(Object.entries(STEPS))(
  "the %s step failing with the same engine error with room keeps 500 server.internal",
  async (_step, send) => {
    expect(await answer(await send(appWith({ free: ROOM, refusal: cannotOpen() })))).toEqual({
      status: 500,
      code: "server.internal",
    });
  },
);

it.each(Object.entries(STEPS))(
  "the %s step failing with a plain programming error on a nearly full disk keeps 500 server.internal",
  async (_step, send) => {
    expect(
      await answer(await send(appWith({ free: NEARLY_FULL, refusal: new TypeError("a bug") }))),
    ).toEqual({ status: 500, code: "server.internal" });
  },
);

it.each(Object.entries(STEPS))(
  "the %s step refused setup.attempt_invalid on a nearly full disk answers 507 storage.disk_full",
  async (_step, send) => {
    const refusal = new AppError("setup.attempt_invalid", {});
    expect(await answer(await send(appWith({ free: NEARLY_FULL, refusal })))).toEqual(DISK_FULL);
  },
);

it.each(Object.entries(STEPS))(
  "the %s step refused setup.attempt_invalid with room keeps 409 setup.attempt_invalid",
  async (_step, send) => {
    const refusal = new AppError("setup.attempt_invalid", {});
    expect(await answer(await send(appWith({ free: ROOM, refusal })))).toEqual({
      status: 409,
      code: "setup.attempt_invalid",
    });
  },
);

it.each(Object.entries(STEPS))(
  "the %s step refused setup.attempt_invalid when free space cannot be read keeps 409 setup.attempt_invalid",
  async (_step, send) => {
    const refusal = new AppError("setup.attempt_invalid", {});
    expect(await answer(await send(appWith({ free: null, refusal })))).toEqual({
      status: 409,
      code: "setup.attempt_invalid",
    });
  },
);

it("a wrong password on a nearly full disk still answers setup.owner_required", async () => {
  const refusal = new AppError("setup.owner_required", {});
  expect(await answer(await STEPS.password(appWith({ free: NEARLY_FULL, refusal })))).toEqual({
    status: 403,
    code: "setup.owner_required",
  });
});

it.each(["unknown", "partial"])(
  "GET /resolution answers 507 storage.disk_full when the inspection answers database %s on a nearly full disk",
  async (database) => {
    const response = await appWith({ free: NEARLY_FULL, database }).request(ROUTE, {}, tls());
    expect(await answer(response)).toEqual(DISK_FULL);
  },
);

it.each(["unknown", "partial"])(
  "GET /resolution answers database %s as today with room",
  async (database) => {
    const response = await appWith({ free: ROOM, database }).request(ROUTE, {}, tls());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ database });
  },
);

it("GET /resolution answers a readable database as today on a nearly full disk", async () => {
  const response = await appWith({ free: NEARLY_FULL, database: "missing" }).request(
    ROUTE,
    {},
    tls(),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ database: "missing" });
});

it("the activation routes keep their answer on a nearly full disk", async () => {
  const refusal = new AppError("setup.attempt_invalid", {});
  const app = appWith({ free: NEARLY_FULL, authorize: async () => Promise.reject(refusal) });
  const response = await app.request(
    `${ROUTE}/reconfirm`,
    {
      method: "POST",
      headers: OWNER_HEADERS,
      body: JSON.stringify({ password: "secret", purpose: "activation" }),
    },
    tls(),
  );
  expect(await answer(response)).toEqual({ status: 409, code: "setup.attempt_invalid" });
});

it("GET /resolution answers database unknown as today when free space cannot be read", async () => {
  const response = await appWith({ free: null, database: "unknown" }).request(ROUTE, {}, tls());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ database: "unknown" });
});

it("a free-space reader that throws leaves a wrong password as setup.owner_required", async () => {
  const refusal = new AppError("setup.owner_required", {});
  const app = appWith({ free: new Error("statfs failed"), refusal });
  expect(await answer(await STEPS.password(app))).toEqual({
    status: 403,
    code: "setup.owner_required",
  });
});

it("a refusal reported as a full disk logs what it was", async () => {
  const log = vi.fn();
  const refusal = new AppError("setup.attempt_invalid", {});
  await STEPS["Start again"](appWith({ free: NEARLY_FULL, refusal, log }));
  expect(log).toHaveBeenCalledWith("warn", "storage.disk_full_reported", {
    errorCode: "setup.attempt_invalid",
    errno: null,
    errcode: null,
  });
  log.mockClear();
  await STEPS.password(appWith({ free: NEARLY_FULL, refusal: cannotOpen(), log }));
  expect(log).toHaveBeenCalledWith("warn", "storage.disk_full_reported", {
    errorCode: null,
    errno: "ERR_SQLITE_ERROR",
    errcode: 14,
  });
});

it.each(Object.entries(STEPS))(
  "the %s step reads free space only for a refusal a full disk could explain",
  async (_step, send) => {
    const reads = async (refusal: unknown) => {
      const onFreeRead = vi.fn();
      await send(appWith({ free: NEARLY_FULL, refusal, onFreeRead }));
      return onFreeRead.mock.calls.length;
    };
    expect({
      ownerRequired: await reads(new AppError("setup.owner_required", {})),
      conflict: await reads(new AppError("setup.attempt_conflict", {})),
      bug: await reads(new TypeError("a bug")),
      attemptInvalid: await reads(new AppError("setup.attempt_invalid", {})),
      cannotOpen: await reads(cannotOpen()),
    }).toEqual({ ownerRequired: 0, conflict: 0, bug: 0, attemptInvalid: 1, cannotOpen: 1 });
  },
);
