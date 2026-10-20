import { describe, expect, it } from "vitest";
import { SetupApi } from "./client.js";

const owner = {
  attemptId: "bd185bdc-b7dd-4abb-991a-a9c3d613d38e",
  revision: 7,
  ownerGeneration: 2,
  capability: "owner-capability",
};
const headers = {
  "X-Waitron-Setup-Owner": "owner-capability",
  "X-Waitron-Setup-Attempt": "bd185bdc-b7dd-4abb-991a-a9c3d613d38e",
  "X-Waitron-Setup-Revision": "7",
  "X-Waitron-Setup-Generation": "2",
};
function transport() {
  const requests: { url: string; init: RequestInit }[] = [];
  const api = new SetupApi("https://box.test", async (input, init) => {
    requests.push({ url: String(input), init: init! });
    return new Response(JSON.stringify({ result: "response" }));
  });
  return { api, requests };
}
describe("first setup HTTP client", () => {
  it("checks public claim status without an owner, and sends owner headers on a status read", async () => {
    const { api, requests } = transport();
    await expect(api.firstSetupStatus()).resolves.toEqual({ result: "response" });
    await api.firstSetupStatus(owner);
    expect(requests).toEqual([
      {
        url: "https://box.test/setup-api/first-setup/status",
        init: { method: "GET", credentials: "include" },
      },
      {
        url: "https://box.test/setup-api/first-setup/status",
        init: { method: "GET", credentials: "include", headers },
      },
    ]);
  });

  it("claims with a nonce and venue, and resumes with the same nonce and password without a stale capability", async () => {
    const { api, requests } = transport();
    const venue = { legalName: "Olivo" } as Parameters<SetupApi["claimFirstSetup"]>[1];
    await api.claimFirstSetup("client-nonce", venue, "es");
    await api.resumeFirstSetup("client-nonce", "administrator password");
    expect(requests).toEqual([
      {
        url: "https://box.test/setup-api/first-setup/claim",
        init: {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "accept-language": "es" },
          body: JSON.stringify({ clientClaimNonce: "client-nonce", venue }),
        },
      },
      {
        url: "https://box.test/setup-api/first-setup/resume",
        init: {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientClaimNonce: "client-nonce",
            password: "administrator password",
          }),
        },
      },
    ]);
  });

  it("binds each public module action to the owner revision and keeps enrolment separate from imported input", async () => {
    const { api, requests } = transport();
    await api.reconfirmFirstSetup(owner, "administrator password", "block-use");
    await api.firstSetupCandidates(owner, "example-module", { serials: [9] }, "block-proof");
    await api.firstSetupRequest(owner);
    await api.firstSetupImport(owner, "example-module", { allocation: "public-input" });
    await api.firstSetupEnrol(
      owner,
      "example-module",
      { publicKey: "public-key" },
      "independent-fingerprint",
    );
    await api.reconfirmFirstSetup(owner, "administrator password", "activation");
    await api.firstSetupConfirm(
      owner,
      "example-module",
      { incidentRecord: "ink record" },
      "activation-proof",
    );
    await api.abandonFirstSetup(owner);
    const expected = [
      ["reconfirm", { password: "administrator password", purpose: "block-use" }],
      [
        "candidates",
        { module: "example-module", proposal: { serials: [9] }, reconfirmation: "block-proof" },
      ],
      ["request", undefined],
      ["input", { module: "example-module", input: { allocation: "public-input" } }],
      [
        "enrol",
        {
          module: "example-module",
          publicKey: { publicKey: "public-key" },
          comparison: "independent-fingerprint",
        },
      ],
      ["reconfirm", { password: "administrator password", purpose: "activation" }],
      [
        "current-master",
        {
          module: "example-module",
          statement: { incidentRecord: "ink record" },
          reconfirmation: "activation-proof",
        },
      ],
      ["abandon", {}],
    ];
    expect(requests).toEqual(
      expected.map(([path, body]) => ({
        url: `https://box.test/setup-api/first-setup/${String(path)}`,
        init:
          body === undefined
            ? { method: "GET", credentials: "include", headers }
            : {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json", ...headers },
                body: JSON.stringify(body),
              },
      })),
    );
  });

  it("sends only the frozen attempt reference and publication settings to readiness and activation", async () => {
    const { api, requests } = transport();
    const body = {
      mode: "live" as const,
      firstSetup: { attemptId: owner.attemptId, revision: 7 },
      aeatCert: {
        pfxBase64: "certificate",
        passphrase: "certificate passphrase",
        certKind: "sello" as const,
      },
    };
    await api.runFirstSetupFiscalTest(owner, body);
    await api.provisionFirstSetup(owner, body, "es");
    expect(requests).toEqual([
      {
        url: "https://box.test/setup-api/fiscal-test",
        init: {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
      },
      {
        url: "https://box.test/setup-api/provision",
        init: {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", ...headers, "accept-language": "es" },
          body: JSON.stringify(body),
        },
      },
    ]);
  });

  it("preserves value-free refusal details and never automatically retries a failed activation", async () => {
    const requests: string[] = [];
    const api = new SetupApi("", async (input) => {
      requests.push(String(input));
      return Response.json(
        { error: { code: "setup.attempt_uncertain", params: {} } },
        { status: 409 },
      );
    });
    await expect(
      api.provisionFirstSetup(owner, {
        mode: "live",
        firstSetup: { attemptId: owner.attemptId, revision: 7 },
      }),
    ).rejects.toEqual({ code: "setup.attempt_uncertain", params: {}, status: 409 });
    expect(requests).toEqual(["/setup-api/provision"]);
  });
});

it("transports opaque preparation proposals with the exact owner binding", async () => {
  const { api, requests } = transport();
  await expect(
    api.firstSetupPreparation(owner, "example-module", { action: "clock-challenge" }),
  ).resolves.toEqual({ result: "response" });
  expect(requests).toEqual([
    {
      url: "https://box.test/setup-api/first-setup/preparation",
      init: {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ module: "example-module", proposal: { action: "clock-challenge" } }),
      },
    },
  ]);
});

it("requests key reissue with the original password and current owner without another allocation action", async () => {
  const { api, requests } = transport();
  await expect(api.reissueFirstSetupNodeKey(owner, "original password")).resolves.toEqual({
    result: "response",
  });
  expect(requests).toEqual([
    {
      url: "https://box.test/setup-api/first-setup/node-key-reissue",
      init: {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ password: "original password" }),
      },
    },
  ]);
});

it("finishes through the dedicated resolution endpoint with the exact recovered owner and snapshot", async () => {
  const { api, requests } = transport();
  const snapshot = { inspectionId: "a".repeat(64), revision: 7, ownerGeneration: 2 };
  const publication = {
    mode: "live" as const,
    email: {
      server: "smtp.example.test",
      port: 465,
      encryption: "tls" as const,
      user: "",
      password: "",
      from: "venue@example.test",
    },
  };
  await api.finishFirstSetup(owner, snapshot, publication);
  expect(requests).toEqual([
    {
      url: "https://box.test/setup-api/first-setup/resolution/finish",
      init: {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ ...snapshot, publication }),
      },
    },
  ]);
});
