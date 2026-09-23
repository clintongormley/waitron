import { describe, expect, it, vi } from "vitest";
import type { ReactiveController } from "lit";
import { LiveData } from "./live-data.js";
import { QueryController } from "./query-controller.js";

function host() {
  const controllers: ReactiveController[] = [];
  return {
    addController: (controller: ReactiveController) => controllers.push(controller),
    removeController() {},
    requestUpdate() {},
    updateComplete: Promise.resolve(true),
    disconnect: () => controllers.forEach((controller) => controller.hostDisconnected?.()),
  };
}

describe("query controller", () => {
  it("rejects an initial failure so the view's loading error path still runs", async () => {
    const error = { code: "server.internal" };
    const controller = new QueryController(
      host(),
      () => new LiveData(),
      () => {},
    );
    await expect(
      controller.watch(
        "jobs",
        {
          key: "jobs",
          dependencies: [],
          read: async () => {
            throw error;
          },
        },
        () => {},
      ),
    ).rejects.toEqual(error);
    controller.hostDisconnected();
  });
  it("applies observed snapshots without recreating the host, and stops on disconnect", async () => {
    const data = new LiveData();
    const owner = host();
    const apply = vi.fn();
    const controller = new QueryController(
      owner,
      () => data,
      () => {},
    );
    let pending = 0;
    const query = {
      key: "jobs",
      dependencies: [{ type: "print_jobs" }],
      read: vi.fn(async () => pending),
    };
    await controller.watch("jobs", query, apply);
    expect(apply).toHaveBeenLastCalledWith(0);
    pending = 2;
    data.invalidate([{ type: "print_jobs", id: "new-job" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(2));
    owner.disconnect();
    data.invalidate([{ type: "print_jobs" }]);
    await Promise.resolve();
    expect(query.read).toHaveBeenCalledTimes(2);
  });

  it("replaces a query's filters and ignores the old query's later result", async () => {
    const data = new LiveData();
    const apply = vi.fn();
    const controller = new QueryController(
      host(),
      () => data,
      () => {},
    );
    let complete!: (value: string) => void;
    const old = controller.watch(
      "jobs",
      {
        key: "jobs?status=failed",
        dependencies: [{ type: "print_jobs" }],
        read: () =>
          new Promise<string>((resolve) => {
            complete = resolve;
          }),
      },
      apply,
    );
    await Promise.resolve();
    await controller.watch(
      "jobs",
      { key: "jobs?status=done", dependencies: [{ type: "print_jobs" }], read: async () => "done" },
      apply,
    );
    complete("failed");
    await old;
    expect(apply).toHaveBeenCalledExactlyOnceWith("done");
    controller.hostDisconnected();
  });

  it("reports refresh failures without replacing the last displayed value", async () => {
    const data = new LiveData();
    const apply = vi.fn();
    const error = vi.fn();
    const controller = new QueryController(host(), () => data, error);
    const read = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockRejectedValue({ code: "server.internal" });
    await controller.watch(
      "jobs",
      { key: "jobs", dependencies: [{ type: "print_jobs" }], read },
      apply,
    );
    data.invalidate([{ type: "print_jobs" }]);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith({ code: "server.internal" }));
    expect(apply).toHaveBeenCalledExactlyOnceWith(1);
    controller.hostDisconnected();
  });

  it("reports and rejects when applying the initial value throws", async () => {
    const error = vi.fn();
    const controller = new QueryController(host(), () => new LiveData(), error);
    const failure = new Error("render failed");
    await expect(
      controller.watch("jobs", { key: "jobs", dependencies: [], read: async () => 1 }, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(error).toHaveBeenCalledExactlyOnceWith(failure);
    controller.hostDisconnected();
  });
});

it("releases a slot when its view has no selection", async () => {
  const data = new LiveData();
  const controller = new QueryController(
    host(),
    () => data,
    () => {},
  );
  const read = vi.fn(async () => 1);
  await controller.watch("selected", { key: "a", dependencies: [{ type: "a" }], read }, () => {});
  controller.release("selected");
  controller.release("missing");
  expect(data.interests).toEqual([]);
  data.invalidate([{ type: "a" }]);
  await Promise.resolve();
  expect(read).toHaveBeenCalledOnce();
});

describe("query controller without a live-data session", () => {
  it("reads once and applies the value", async () => {
    const apply = vi.fn();
    const controller = new QueryController(
      host(),
      () => undefined,
      () => {},
    );
    const read = vi.fn(async () => 3);
    await controller.watch("jobs", { key: "jobs", dependencies: [], read }, apply);
    expect(read).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledExactlyOnceWith(3);
    controller.hostDisconnected();
  });

  it("drops a released slot's late value and late failure without reporting either", async () => {
    const apply = vi.fn();
    const error = vi.fn();
    const controller = new QueryController(host(), () => undefined, error);
    let complete!: (value: number) => void;
    const kept = controller.watch(
      "kept",
      {
        key: "kept",
        dependencies: [],
        read: () =>
          new Promise<number>((resolve) => {
            complete = resolve;
          }),
      },
      apply,
    );
    let fail!: (reason: unknown) => void;
    const failed = controller.watch(
      "failed",
      {
        key: "failed",
        dependencies: [],
        read: () =>
          new Promise<number>((_, reject) => {
            fail = reject;
          }),
      },
      apply,
    );
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
    controller.hostDisconnected();
    complete(1);
    fail({ code: "server.internal" });
    await expect(kept).resolves.toBeUndefined();
    await expect(failed).resolves.toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
