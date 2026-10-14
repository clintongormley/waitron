import { afterEach, describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";
import { ServerRouter, withServerTarget } from "./server-router.js";
import {
  DEV_DEVICE_HEADER,
  clearDevDeviceId,
  setDevDeviceId,
  withDevDeviceHeader,
} from "./dev-device.js";

const state = {
  personId: "operator",
  locationId: "venue",
  businessDay: "2026-10-14",
  state: "working",
  activeLocationId: "venue",
  lastEntryId: "entry",
  firstClockIn: false,
};
afterEach(() => clearDevDeviceId());

describe("own clock client", () => {
  it.each([
    ["getClockState", "state", "GET"],
    ["clockIn", "in", "POST"],
    ["clockOut", "out", "POST"],
    ["startBreak", "break-start", "POST"],
    ["endBreak", "break-end", "POST"],
  ] as const)(
    "%s sends no person or timestamp and carries its abort signal",
    async (method, path, verb) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(state)));
      const api = new TillApi("https://box.test", fetcher);
      const signal = new AbortController().signal;
      const answer =
        method === "getClockState"
          ? await api[method]({ signal })
          : await api[method](null, { signal });
      expect(answer).toEqual(state);
      expect(fetcher.mock.calls).toEqual([
        [
          `https://box.test/api/clock/${path}`,
          {
            method: verb,
            credentials: "include",
            signal,
            ...(verb === "POST"
              ? {
                  headers: { "content-type": "application/json" },
                  body: '{"expectedEntryId":null}',
                }
              : {}),
          },
        ],
      ]);
    },
  );

  it("keeps routing and the dev-device header without replaying a refused POST", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "attendance.state_changed", params: {} } }), {
        status: 409,
      }),
    );
    const router = new ServerRouter({
      origin: "https://primary.test",
      fetchImpl: fetcher,
      storage: { getItem: () => null, setItem: () => {} },
    });
    setDevDeviceId("clock-device");
    const api = new TillApi("", withDevDeviceHeader(withServerTarget(fetcher, router)));
    await expect(api.clockOut("old-entry")).rejects.toEqual({
      code: "attendance.state_changed",
      status: 409,
    });
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls[0]![0]).toBe("https://primary.test/api/clock/out");
    const init = fetcher.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get(DEV_DEVICE_HEADER)).toBe("clock-device");
    expect(init.body).toBe('{"expectedEntryId":"old-entry"}');
    expect(init.method).toBe("POST");
  });

  it("never replays a POST whose response is lost", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection lost"));
    await expect(new TillApi("", fetcher).clockIn(null)).rejects.toBeInstanceOf(TypeError);
    expect(fetcher.mock.calls).toHaveLength(1);
  });
});
