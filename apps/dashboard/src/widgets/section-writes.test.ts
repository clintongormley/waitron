import { expect, it, vi } from "vitest";
import { fieldOf, ListWriteQueue } from "./section-writes.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Lets every queued step that can run, run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("places a translation refusal beside its language's name, and any other by the field it names", () => {
  expect(fieldOf({ code: "menu_section.translation_required", params: { language: "en" } })).toBe(
    "names-en",
  );
  expect(fieldOf({ code: "menu_section.invalid", params: { field: "internalName" } })).toBe(
    "internalName",
  );
  // A translation refusal naming no language falls back like any other.
  expect(fieldOf({ code: "menu_section.translation_required", params: { field: "names" } })).toBe(
    "names",
  );
  expect(fieldOf({ code: "management.request_invalid" })).toBe("_form");
  expect(fieldOf(new Error("down"))).toBe("_form");
});

it("runs each write only after the one before it has finished, in the order asked", async () => {
  const queue = new ListWriteQueue();
  const first = deferred();
  const order: string[] = [];
  queue.run("list", async () => {
    order.push("first started");
    await first.promise;
    order.push("first finished");
  });
  queue.run("other", async () => {
    order.push("second started");
  });
  await settle();
  expect(order).toEqual(["first started"]);
  first.resolve();
  await settle();
  expect(order).toEqual(["first started", "first finished", "second started"]);
});

it("reports a move as the last answer only when nothing waits behind it", async () => {
  const queue = new ListWriteQueue();
  const first = deferred<string>();
  const moved = vi.fn();
  queue.move("list", () => first.promise, moved, vi.fn());
  queue.move("list", async () => "second", moved, vi.fn());
  first.resolve("first");
  await settle();
  expect(moved.mock.calls).toEqual([
    ["first", false],
    ["second", true],
  ]);
});

it("reports a move as the last answer when the writes behind it belong to other lists", async () => {
  const queue = new ListWriteQueue();
  const first = deferred<string>();
  const moved = vi.fn();
  queue.move("list", () => first.promise, moved, vi.fn());
  queue.move("other", async () => "other", moved, vi.fn());
  queue.run("other", async () => undefined);
  first.resolve("first");
  await settle();
  expect(moved.mock.calls).toEqual([
    ["first", true],
    ["other", false],
  ]);
});

it("reports a move as not the last answer while any write in its list waits behind it", async () => {
  const queue = new ListWriteQueue();
  const first = deferred<string>();
  const moved = vi.fn();
  queue.move("list", () => first.promise, moved, vi.fn());
  queue.run("list", async () => undefined);
  first.resolve("first");
  await settle();
  expect(moved).toHaveBeenCalledExactlyOnceWith("first", false);
});

it("drops the moves queued behind a refused one in the same list, and keeps the others", async () => {
  const queue = new ListWriteQueue();
  const first = deferred<string>();
  const sent: string[] = [];
  const refused = vi.fn();
  const send = (name: string) => async () => {
    sent.push(name);
    return name;
  };
  queue.move(
    "list",
    () => {
      sent.push("refused");
      return first.promise;
    },
    vi.fn(),
    refused,
  );
  queue.move("list", send("behind, same list"), vi.fn(), vi.fn());
  queue.move("other", send("behind, other list"), vi.fn(), vi.fn());
  first.reject({ code: "menu_section.invalid" });
  await settle();
  expect(refused).toHaveBeenCalledExactlyOnceWith({ code: "menu_section.invalid" });
  queue.move("list", send("after the refusal"), vi.fn(), vi.fn());
  await settle();
  expect(sent).toEqual(["refused", "behind, other list", "after the refusal"]);
});

it("remembers a refusal in each list, not only the latest", async () => {
  const queue = new ListWriteQueue();
  const gate = deferred();
  const sent: string[] = [];
  const refuse = (name: string) => async () => {
    sent.push(name);
    await gate.promise;
    throw { code: "menu_section.invalid" };
  };
  const send = (name: string) => async () => {
    sent.push(name);
    return name;
  };
  queue.move("list", refuse("list, refused"), vi.fn(), vi.fn());
  queue.move("other", refuse("other, refused"), vi.fn(), vi.fn());
  queue.move("list", send("behind, list"), vi.fn(), vi.fn());
  queue.move("other", send("behind, other"), vi.fn(), vi.fn());
  gate.resolve();
  await settle();
  expect(sent).toEqual(["list, refused", "other, refused"]);
});

it("still sends the writes queued behind one whose own step threw", async () => {
  const queue = new ListWriteQueue();
  const sent: string[] = [];
  queue.move(
    "list",
    async () => "moved",
    () => {
      throw new Error("callback broke");
    },
    vi.fn(),
  );
  queue.move(
    "list",
    async () => {
      throw { code: "menu_section.invalid" };
    },
    vi.fn(),
    () => {
      throw new Error("callback broke");
    },
  );
  queue.run("list", async () => {
    throw new Error("task broke");
  });
  queue.run("list", async () => {
    sent.push("after");
  });
  await settle();
  expect(sent).toEqual(["after"]);
});
