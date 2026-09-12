import { expect, it, vi } from "vitest";
import { ImageApi } from "./client.js";
import type { DashboardRequest } from "@waitron/dashboard-kit";

it("encodes filters, sends multipart uploads and makes automatic reads passive", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = new ImageApi(request as DashboardRequest);
  await api.listImages({
    search: "bread & cheese",
    label: "Summer menu",
    language: "en-GB",
    sort: "name",
    direction: "desc",
    offset: 24,
    limit: 24,
  });
  expect(request).toHaveBeenLastCalledWith(
    "/management-api/images?search=bread+%26+cheese&label=Summer+menu&language=en-GB&sort=name&direction=desc&offset=24&limit=24",
    "GET",
    undefined,
    { passive: false },
  );
  await api.background.listImages({
    search: "",
    label: "",
    language: "es-ES",
    sort: "name",
    offset: 0,
    limit: 24,
  });
  expect(request).toHaveBeenLastCalledWith(
    "/management-api/images?search=&label=&language=es-ES&sort=name&offset=0&limit=24",
    "GET",
    undefined,
    { passive: true },
  );
  await api.background.listLabels();
  expect(request).toHaveBeenLastCalledWith("/management-api/image-labels", "GET", undefined, {
    passive: true,
  });
  await api.background.getImage("a/b");
  expect(request).toHaveBeenLastCalledWith("/management-api/images/a%2Fb", "GET", undefined, {
    passive: true,
  });
  const metadata = { names: { es: "Pan" }, altText: { es: "Pan" }, labels: ["Food"] };
  const file = new File(["photo"], "bread.png", { type: "image/png" });
  await api.uploadImage(file, metadata);
  const form = request.mock.calls.at(-1)![2] as FormData;
  expect(form.get("file")).toEqual(file);
  expect(form.get("names")).toBe(JSON.stringify(metadata.names));
  expect(form.get("altText")).toBe(JSON.stringify(metadata.altText));
  expect(form.get("labels")).toBe(JSON.stringify(metadata.labels));
  await api.updateImage("a/b", metadata);
  expect(request).toHaveBeenLastCalledWith("/management-api/images/a%2Fb", "PATCH", metadata);
  await api.deleteImage("a/b");
  expect(request).toHaveBeenLastCalledWith("/management-api/images/a%2Fb", "DELETE");
});
