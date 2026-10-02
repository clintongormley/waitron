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

describe("query controller recovery", () => {
  const outage = { code: "connection.failed" };
  function failing(key: string) {
    let down = true;
    return {
      query: {
        key,
        dependencies: [{ type: key }],
        read: vi.fn(async () => {
          if (down) throw outage;
          return key;
        }),
      },
      up: () => {
        down = false;
      },
    };
  }

  it("tells the view once a failed read has applied a value again", async () => {
    const data = new LiveData();
    const order: string[] = [];
    const recovered = vi.fn(() => order.push("recovered"));
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    const jobs = failing("jobs");
    await expect(
      controller.watch("jobs", jobs.query, (value) => {
        order.push(`apply ${value}`);
      }),
    ).rejects.toEqual(outage);
    expect(recovered).not.toHaveBeenCalled();
    jobs.up();
    data.refresh();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledWith(outage));
    expect(order).toEqual(["apply jobs", "recovered"]);
    data.refresh();
    await vi.waitFor(() => expect(order).toEqual(["apply jobs", "recovered", "apply jobs"]));
    expect(recovered).toHaveBeenCalledTimes(1);
    controller.hostDisconnected();
  });

  it("waits for every failed slot before telling the view", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    const jobs = failing("jobs");
    const printers = failing("printers");
    await expect(controller.watch("jobs", jobs.query, () => {})).rejects.toEqual(outage);
    await expect(controller.watch("printers", printers.query, () => {})).rejects.toEqual(outage);
    jobs.up();
    data.refresh();
    await vi.waitFor(() => expect(jobs.query.read).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(printers.query.read).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(recovered).not.toHaveBeenCalled();
    printers.up();
    data.refresh();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
    controller.hostDisconnected();
  });

  it("never tells the view about applies that followed no failure", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    const read = vi.fn(async () => 1);
    await controller.watch("jobs", { key: "jobs", dependencies: [], read }, () => {});
    data.refresh();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(recovered).not.toHaveBeenCalled();
    controller.hostDisconnected();
  });

  it("counts a view's own apply failure, and recovers when a later apply succeeds", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const error = vi.fn();
    const controller = new QueryController(host(), () => data, error, recovered);
    const refused = new Error("apply refused");
    let refuse = true;
    await expect(
      controller.watch("jobs", { key: "jobs", dependencies: [], read: async () => 1 }, () => {
        if (refuse) throw refused;
      }),
    ).rejects.toBe(refused);
    expect(error).toHaveBeenCalledWith(refused);
    refuse = false;
    data.refresh();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledWith(refused));
    controller.hostDisconnected();
  });

  it("recovers through a replacement watch of the same slot", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    const old = failing("jobs?status=failed");
    await expect(controller.watch("jobs", old.query, () => {})).rejects.toEqual(outage);
    await controller.watch(
      "jobs",
      { key: "jobs?status=all", dependencies: [], read: async () => 2 },
      () => {},
    );
    expect(recovered).toHaveBeenCalledWith(outage);
    controller.hostDisconnected();
  });

  it("forgets a released slot's failure, so the others' recovery is still reported", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    const jobs = failing("jobs");
    const printers = failing("printers");
    await expect(controller.watch("jobs", jobs.query, () => {})).rejects.toEqual(outage);
    await expect(controller.watch("printers", printers.query, () => {})).rejects.toEqual(outage);
    controller.release("jobs");
    printers.up();
    data.refresh();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
    controller.hostDisconnected();
  });

  it("forgets every failure when the view disconnects", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const owner = host();
    const controller = new QueryController(owner, () => data, vi.fn(), recovered);
    const jobs = failing("jobs");
    await expect(controller.watch("jobs", jobs.query, () => {})).rejects.toEqual(outage);
    owner.disconnect();
    const printers = failing("printers");
    await expect(controller.watch("printers", printers.query, () => {})).rejects.toEqual(outage);
    printers.up();
    data.refresh();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
    owner.disconnect();
  });

  it("does not count an apply that finished after a newer read failed as a recovery", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    let next: "fail" | "ok" | "slow" = "fail";
    const read = vi.fn(async () => {
      if (next === "fail") throw outage;
      return next;
    });
    let finishApply!: () => void;
    const apply = vi.fn((value: string) =>
      value === "slow"
        ? new Promise<void>((resolve) => {
            finishApply = resolve;
          })
        : undefined,
    );
    await expect(
      controller.watch("jobs", { key: "jobs", dependencies: [], read }, apply),
    ).rejects.toEqual(outage);
    next = "slow";
    data.refresh();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith("slow"));
    next = "fail";
    data.refresh();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishApply();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recovered).not.toHaveBeenCalled();
    next = "ok";
    data.refresh();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
    controller.hostDisconnected();
  });

  it("does not announce recovery from an apply its slot's replacement outlived", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    const old = failing("jobs?status=failed");
    let finishOldApply!: () => void;
    const oldApply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOldApply = resolve;
        }),
    );
    await expect(controller.watch("jobs", old.query, oldApply)).rejects.toEqual(outage);
    old.up();
    data.refresh();
    await vi.waitFor(() => expect(oldApply).toHaveBeenCalledTimes(1));
    let deliver!: (value: number) => void;
    const replacementApply = vi.fn();
    const replacement = controller.watch(
      "jobs",
      {
        key: "jobs?status=all",
        dependencies: [],
        read: () =>
          new Promise<number>((resolve) => {
            deliver = resolve;
          }),
      },
      replacementApply,
    );
    finishOldApply();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recovered).not.toHaveBeenCalled();
    deliver(2);
    await replacement;
    expect(replacementApply).toHaveBeenCalledWith(2);
    expect(recovered).toHaveBeenCalledTimes(1);
    controller.hostDisconnected();
  });

  it("reports the most recent failure it showed the view", async () => {
    const data = new LiveData();
    const recovered = vi.fn();
    const controller = new QueryController(host(), () => data, vi.fn(), recovered);
    const first = { code: "connection.failed" };
    const second = { code: "server.internal" };
    let next: unknown = first;
    const read = vi.fn(async () => {
      if (next !== undefined) throw next;
      return 1;
    });
    await expect(
      controller.watch("jobs", { key: "jobs", dependencies: [], read }, () => {}),
    ).rejects.toBe(first);
    next = second;
    data.refresh();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    next = undefined;
    data.refresh();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledWith(second));
    controller.hostDisconnected();
  });
});
