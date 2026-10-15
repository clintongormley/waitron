import { expect, it } from "vitest";
import { SetupApi } from "./client.js";

it("discovers the host offering for the selected territory without sending a wizard draft", async () => {
  let sent: unknown;
  const api = new SetupApi("", async (url, init) => {
    sent = { url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) };
    return Response.json({ modules: [{ module: "example-module", version: "2" }] });
  });
  expect(await api.firstSetupOfferings("GB-vat")).toEqual({
    modules: [{ module: "example-module", version: "2" }],
  });
  expect(sent).toEqual({
    url: "/setup-api/first-setup/offerings",
    method: "POST",
    body: { fiscalTerritory: "GB-vat" },
  });
});
