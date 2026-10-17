import { html, render, nothing } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { liveMediaImage, invalidateMediaImages } from "./live-media-image.js";
import "./components/wt-data-table.js";
import type { WtDataTable } from "./components/wt-data-table.js";

let a: string;
let b: string;
let referenceSequence = 0;
let host: HTMLDivElement;
let network: ReturnType<typeof vi.fn<typeof fetch>>;
let visible = true;
function entry(version: string) {
  return {
    id: version,
    revision: 1,
    source: `/media/${version}.webp`,
    square: `/media/${version}-square.webp`,
    till: `/media/${version}-till.webp`,
    display: `/media/${version}-display.webp`,
  };
}
function reply(images: Record<string, ReturnType<typeof entry>>) {
  return new Response(JSON.stringify({ images }), {
    headers: { "Content-Type": "application/json" },
  });
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
beforeEach(() => {
  a = `${(10_000 + ++referenceSequence).toString(16).padStart(64, "0")}.webp`;
  b = `${(10_000 + ++referenceSequence).toString(16).padStart(64, "0")}.png`;
  visible = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden",
  );
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  host = document.createElement("div");
  document.body.append(host);
  network = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => reply({ [a]: entry("A"), [b]: entry("B") }));
  vi.stubGlobal("fetch", network);
});
it("shows the last successful picture on remount while a refresh is pending or fails", async () => {
  render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
  render(nothing, host);
  let fail!: (reason: unknown) => void;
  network.mockImplementationOnce(() => new Promise((_yes, no) => (fail = no)));
  render(html`<img src=${liveMediaImage(a, "till")} />`, host);
  expect(src()).toBe("/media/A-till.webp");
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  fail(new Error("offline"));
  await frame();
  expect(src()).toBe("/media/A-till.webp");
  network.mockResolvedValueOnce(reply({}));
  invalidateMediaImages();
  await vi.waitFor(() => expect(src()).toBeNull());
  render(nothing, host);
  render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  expect(src()).toBeNull();
});
it("bounds remembered inactive presentations while retaining all mounted pictures", async () => {
  const references = Array.from(
    { length: 257 },
    (_, i) => `${i.toString(16).padStart(64, "0")}.webp`,
  );
  network.mockImplementation(async (url) => {
    const refs = new URL(String(url), location.origin).searchParams.get("references")!.split(",");
    return reply(Object.fromEntries(refs.map((ref) => [ref, entry("kept")])));
  });
  render(
    html`${references.map((ref) => html`<img src=${liveMediaImage(ref, "square")} />`)}`,
    host,
  );
  await vi.waitFor(() =>
    expect(
      [...host.querySelectorAll("img")].every(
        (image) => image.getAttribute("src") === "/media/kept-square.webp",
      ),
    ).toBe(true),
  );
  render(nothing, host);
  render(
    html`${references.map((ref) => html`<img src=${liveMediaImage(ref, "square")} />`)}`,
    host,
  );
  const pictures = [...host.querySelectorAll("img")].map((image) => image.getAttribute("src"));
  expect(pictures.filter((value) => value === null)).toHaveLength(1);
  expect(pictures.filter((value) => value === "/media/kept-square.webp")).toHaveLength(256);
});
afterEach(() => {
  render(nothing, host);
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const src = (index = 0) => host.querySelectorAll("img")[index]!.getAttribute("src");
it("batches duplicate mounted consumers and resolves each shape without an empty src", async () => {
  render(
    html`<img src=${liveMediaImage(a, "square")} /><img src=${liveMediaImage(a, "till")} /><img
        src=${liveMediaImage(b, "source")}
      />`,
    host,
  );
  expect(src()).toBeNull();
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
  expect(src(1)).toBe("/media/A-till.webp");
  expect(src(2)).toBe("/media/B.webp");
  expect(network).toHaveBeenCalledTimes(1);
  const [url, options] = network.mock.calls[0]!;
  expect(String(url)).toBe(`/media/presentations?references=${a}%2C${b}`);
  expect(options).toMatchObject({ credentials: "same-origin", cache: "no-store" });
});
it("chunks 201 distinct references into at most 100 per passive public request", async () => {
  const references = Array.from(
    { length: 201 },
    (_, i) => `${i.toString(16).padStart(64, "0")}.webp`,
  );
  render(
    html`${references.map((ref) => html`<img src=${liveMediaImage(ref, "square")} />`)}`,
    host,
  );
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(3));
  const chunks = network.mock.calls.map(([url]) =>
    new URL(String(url), location.origin).searchParams.get("references")!.split(","),
  );
  expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 1]);
  expect(chunks.flat()).toEqual(references);
});
it("polls at 15 seconds, stops when hidden and refreshes immediately on return and online", async () => {
  const started = Date.now();
  render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
  await vi.advanceTimersByTimeAsync(14_999 - (Date.now() - started));
  expect(network).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  visible = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(network).toHaveBeenCalledTimes(2);
  visible = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(3));
  window.dispatchEvent(new Event("online"));
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(4));
});
it("keeps the last successful URL after a failed refresh and clears an explicitly missing image", async () => {
  render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
  network.mockRejectedValueOnce(new Error("offline"));
  invalidateMediaImages();
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  await frame();
  expect(src()).toBe("/media/A-square.webp");
  network.mockResolvedValueOnce(reply({}));
  invalidateMediaImages();
  await vi.waitFor(() => expect(src()).toBeNull());
});
it("ignores an older refresh after a newer successful response", async () => {
  let answer!: (value: Response) => void;
  network.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
  network.mockResolvedValueOnce(reply({ [a]: entry("new") }));
  invalidateMediaImages();
  await vi.waitFor(() => expect(src()).toBe("/media/new-square.webp"));
  answer(reply({ [a]: entry("old") }));
  await frame();
  expect(src()).toBe("/media/new-square.webp");
});
it("unsubscribes replaced references and drops late answers after all consumers disconnect", async () => {
  let answer!: (value: Response) => void;
  network.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  const template = (ref: string) => html`<img src=${liveMediaImage(ref, "display")} />`;
  render(template(a), host);
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
  render(template(b), host);
  await vi.waitFor(() => expect(src()).toBe("/media/B-display.webp"));
  answer(reply({ [a]: entry("late") }));
  await frame();
  expect(src()).toBe("/media/B-display.webp");
  render(nothing, host);
  const calls = network.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  window.dispatchEvent(new Event("online"));
  invalidateMediaImages();
  await frame();
  expect(network).toHaveBeenCalledTimes(calls);
});
it("refreshes when a Lit tree reconnects", async () => {
  const root = render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
  root.setConnected(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(network).toHaveBeenCalledTimes(1);
  network.mockResolvedValueOnce(reply({ [a]: entry("returned") }));
  root.setConnected(true);
  await vi.waitFor(() => expect(src()).toBe("/media/returned-square.webp"));
});
it("updates image cells inside the real data table shadow root", async () => {
  render(html`<wt-data-table></wt-data-table>`, host);
  const table = host.querySelector<WtDataTable<{ id: string }>>("wt-data-table")!;
  table.columns = [
    {
      key: "photo",
      label: "Photo",
      cell: () => html`<img part="photo" alt="Bread" src=${liveMediaImage(a, "square")} />`,
    },
  ];
  table.rows = [{ id: "bread" }];
  table.rowKey = (row) => row.id;
  await table.updateComplete;
  await vi.waitFor(() =>
    expect(table.shadowRoot!.querySelector("img")?.getAttribute("src")).toBe(
      "/media/A-square.webp",
    ),
  );
  network.mockResolvedValueOnce(reply({ [a]: entry("saved") }));
  invalidateMediaImages();
  await vi.waitFor(() =>
    expect(table.shadowRoot!.querySelector("img")?.getAttribute("src")).toBe(
      "/media/saved-square.webp",
    ),
  );
});
it("does not request invalid or empty references or start work for a hidden page", async () => {
  visible = false;
  render(
    html`<img src=${liveMediaImage(a, "square")} /><img src=${liveMediaImage("", "square")} /><img
        src=${liveMediaImage("../bad", "square")}
      />`,
    host,
  );
  await frame();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(network).not.toHaveBeenCalled();
  expect(src()).toBeNull();
  visible = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
  expect(network).toHaveBeenCalledTimes(1);
  expect(src(1)).toBeNull();
  expect(src(2)).toBeNull();
});
it("keeps the prior presentation across HTTP, JSON and entry-shape refusals", async () => {
  render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
  const malformed = [
    null,
    [],
    {},
    { images: null },
    { images: [] },
    { images: { [a]: { ...entry("bad"), revision: -1 } } },
    { images: { [a]: { ...entry("bad"), square: "https://elsewhere.invalid/photo" } } },
    { images: { [a]: { ...entry("bad"), till: "/media/\\invalid" } } },
    { images: { [a]: null } },
    { images: { [a]: [] } },
  ];
  for (const body of malformed) {
    network.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    const before = network.mock.calls.length;
    invalidateMediaImages();
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(before + 1));
    await frame();
    expect(src()).toBe("/media/A-square.webp");
  }
  for (const response of [
    new Response("unavailable", { status: 503 }),
    new Response("broken JSON"),
  ]) {
    network.mockResolvedValueOnce(response);
    const before = network.mock.calls.length;
    invalidateMediaImages();
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(before + 1));
    await frame();
    expect(src()).toBe("/media/A-square.webp");
  }
});
it("never publishes an in-flight answer while hidden, then retries on visibility return", async () => {
  let answer!: (value: Response) => void;
  network.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  render(html`<img src=${liveMediaImage(a, "square")} />`, host);
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
  visible = false;
  document.dispatchEvent(new Event("visibilitychange"));
  answer(reply({ [a]: entry("hidden") }));
  await frame();
  expect(src()).toBeNull();
  visible = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
});
it("finishes an in-flight lookup when another thumbnail arrives, then resolves the new row", async () => {
  let firstAnswer!: (value: Response) => void;
  let nextAnswer: ((value: Response) => void) | undefined;
  network.mockImplementationOnce(() => new Promise<Response>((yes) => (firstAnswer = yes)));
  network.mockImplementationOnce(() => new Promise<Response>((yes) => (nextAnswer = yes)));
  const template = (refs: string[]) =>
    html`${refs.map((ref) => html`<img src=${liveMediaImage(ref, "square")} />`)}`;
  render(template([a]), host);
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
  try {
    render(template([a, b]), host);
    await frame();
    firstAnswer(reply({ [a]: entry("A") }));
    await vi.waitFor(() => expect(src()).toBe("/media/A-square.webp"));
    expect(src(1)).toBeNull();
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
    nextAnswer!(reply({ [a]: entry("A"), [b]: entry("B") }));
    await vi.waitFor(() => expect(src(1)).toBe("/media/B-square.webp"));
  } finally {
    firstAnswer(reply({ [a]: entry("A") }));
    nextAnswer?.(reply({ [a]: entry("A"), [b]: entry("B") }));
  }
});
