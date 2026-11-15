import { afterEach, expect, it, vi } from "vitest";
import { TableRequestController } from "./table-request-controller.js";

const host = () => ({
  addController() {},
  removeController() {},
  requestUpdate() {},
  updateComplete: Promise.resolve(true),
});
const initial = { search: "", sortKey: "name", status: "all" };
afterEach(() => vi.useRealTimers());

it("debounces typing, resets changed queries, and retains pages for action reloads", async () => {
  vi.useFakeTimers();
  const reads: unknown[] = [];
  const requests = new TableRequestController(
    host(),
    async (query: typeof initial, page: number) => {
      reads.push([query, page]);
    },
  );
  requests.setQuery(initial);
  expect(reads).toEqual([[initial, 0]]);
  requests.move(2);
  requests.setQuery({ ...initial, search: "a" });
  await vi.advanceTimersByTimeAsync(199);
  expect(reads).toHaveLength(2);
  requests.setQuery({ ...initial, search: "ada" });
  await vi.advanceTimersByTimeAsync(200);
  expect(reads.at(-1)).toEqual([{ ...initial, search: "ada" }, 0]);
  requests.move(1);
  await requests.reload();
  expect(reads.slice(-2)).toEqual([
    [{ ...initial, search: "ada" }, 1],
    [{ ...initial, search: "ada" }, 1],
  ]);
  const filtered = { ...initial, search: "ada", status: "active" };
  requests.setQuery(filtered);
  expect(reads.at(-1)).toEqual([filtered, 0]);
  const count = reads.length;
  requests.setQuery({ ...filtered });
  requests.move(0);
  expect(reads).toHaveLength(count);
});

it("does not delay a sort while typing and cancels pending work when disconnected", async () => {
  vi.useFakeTimers();
  const reads: unknown[] = [];
  const requests = new TableRequestController(
    host(),
    async (query: typeof initial, page: number) => {
      reads.push([query, page]);
    },
  );
  requests.setQuery(initial);
  requests.setQuery({ ...initial, search: "ada" });
  const sorted = { ...initial, search: "ada", sortKey: "email" };
  requests.setQuery(sorted);
  expect(reads.at(-1)).toEqual([sorted, 0]);
  requests.page = 3;
  expect(reads).toHaveLength(2);
  requests.setQuery({ ...sorted, search: "bea" });
  requests.hostDisconnected();
  await vi.advanceTimersByTimeAsync(200);
  expect(reads).toHaveLength(2);
});
