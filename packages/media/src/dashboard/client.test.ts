import { html, render, nothing } from "lit";
import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { expect, it, vi } from "vitest";
import { ImageApi } from "./client.js";
import type { DashboardRequest } from "@waitron/dashboard-kit";

it("encodes filters, sends multipart uploads and makes automatic reads passive", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = new ImageApi(request as DashboardRequest);
  await api.listImages({
    search: "bread & cheese",
    language: "en-GB",
    sort: "name",
    direction: "desc",
    offset: 24,
    limit: 24,
  });
  expect(request).toHaveBeenLastCalledWith(
    "/management-api/images?search=bread+%26+cheese&language=en-GB&sort=name&direction=desc&offset=24&limit=24",
    "GET",
    undefined,
    { passive: false },
  );
  await api.background.listImages({
    search: "",
    language: "es-ES",
    sort: "name",
    offset: 0,
    limit: 24,
  });
  expect(request).toHaveBeenLastCalledWith(
    "/management-api/images?search=&language=es-ES&sort=name&offset=0&limit=24",
    "GET",
    undefined,
    { passive: true },
  );
  await api.background.getImage("a/b");
  expect(request).toHaveBeenLastCalledWith("/management-api/images/a%2Fb", "GET", undefined, {
    passive: true,
  });
  const metadata = { names: { es: "Pan" } };
  const file = new File(["photo"], "bread.png", { type: "image/png" });
  await api.uploadImage(file, metadata);
  const form = request.mock.calls.at(-1)![2] as FormData;
  expect(form.get("file")).toEqual(file);
  expect(form.get("names")).toBe(JSON.stringify(metadata.names));
  expect([...form.keys()].sort()).toEqual(["file", "names"]);
  const edit = { ...metadata, framing: { x: 0, y: 10000, zoom: 200 }, expectedRevision: 0 };
  await api.updateImage("a/b", edit);
  expect(request).toHaveBeenLastCalledWith("/management-api/images/a%2Fb", "PATCH", edit);
  await api.deleteImage("a/b");
  expect(request).toHaveBeenLastCalledWith("/management-api/images/a%2Fb", "DELETE");
});

it("sends one multipart edit with replacement, accepted framing and revision zero", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = new ImageApi(request as DashboardRequest);
  const file = new File(["replacement"], "new.png", { type: "image/png" });
  await api.updateImage(
    "a/b",
    { names: { en: "Kept name" }, framing: { x: 2500, y: 7500, zoom: 200 }, expectedRevision: 0 },
    file,
  );
  expect(request).toHaveBeenCalledTimes(1);
  const [path, method, form] = request.mock.calls[0]!;
  expect(path).toBe("/management-api/images/a%2Fb");
  expect(method).toBe("PATCH");
  expect(form).toBeInstanceOf(FormData);
  expect([...(form as FormData).keys()].sort()).toEqual([
    "expectedRevision",
    "file",
    "framing",
    "names",
  ]);
  expect((form as FormData).get("file")).toEqual(file);
  expect((form as FormData).get("expectedRevision")).toBe("0");
  expect((form as FormData).get("names")).toBe('{"en":"Kept name"}');
  expect((form as FormData).get("framing")).toBe('{"x":2500,"y":7500,"zoom":200}');
});

it("refreshes mounted photo presentations only after a successful edit", async () => {
  const reference = `${"e".repeat(64)}.webp`;
  const host = document.createElement("div");
  document.body.append(host);
  const entry = (name: string) => ({
    id: "photo",
    revision: 1,
    source: `/media/${name}.webp`,
    square: `/media/${name}-square.webp`,
    till: `/media/${name}-till.webp`,
    display: `/media/${name}-display.webp`,
  });
  const network = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(JSON.stringify({ images: { [reference]: entry("before") } })),
    );
  vi.stubGlobal("fetch", network);
  try {
    render(html`<img src=${liveMediaImage(reference, "square")} />`, host);
    const src = () => host.querySelector("img")!.getAttribute("src");
    await vi.waitFor(() => expect(src()).toBe("/media/before-square.webp"));
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce({ image: { id: "photo" } });
    const api = new ImageApi(request as DashboardRequest);
    const edit = {
      names: { en: "Edited" },
      framing: { x: 0, y: 0, zoom: 100 },
      expectedRevision: 0,
    };
    await expect(api.updateImage("photo", edit)).rejects.toThrow("refused");
    expect(network).toHaveBeenCalledTimes(1);
    network.mockImplementation(
      async () => new Response(JSON.stringify({ images: { [reference]: entry("after") } })),
    );
    await api.updateImage("photo", edit);
    await vi.waitFor(() => expect(src()).toBe("/media/after-square.webp"));
    expect(network).toHaveBeenCalledTimes(2);
  } finally {
    render(nothing, host);
    host.remove();
    vi.unstubAllGlobals();
  }
});
