import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";

const id = "a88eb60a-ab63-4b60-88a3-de6f67663735";
const time = 1_700_000_000_000;
const body =
  '{"version":"1.2.3","time":1700000000000,"logs":[],"details":{"device":"till","equipment":[],"upgradedAt":null,"hosting":"unknown"}}';

it("signs the exact attachment and distinguishes acceptance, retry and stop", async () => {
  let reply: { status: number; answer: object; date?: string } | undefined;
  const received: unknown[] = [];
  const cloud = await installationFixture(undefined, {
    staffReport: async (claims, _saved, request, response, envelope) => {
      received.push([request.url, claims[4], JSON.parse(String(claims[7])), envelope.body]);
      if (!reply) {
        request.socket.destroy();
        return;
      }
      response.writeHead(reply.status, reply.date ? { date: reply.date } : {});
      response.end(JSON.stringify(reply.answer));
    },
  });
  try {
    const registration = (await cloud.client.errorReportRegistration())!;
    expect(typeof cloud.client.sendStaffReport).toBe("function");
    const send = () => cloud.client.sendStaffReport(registration, id, body);
    const cases = [
      [200, { received: true }, "sent"],
      [200, { received: true, extra: true }, "retry"],
      [429, {}, "retry"],
      [503, {}, "retry"],
      [400, { error: "invalid_input" }, "stop"],
      [409, { error: "conflict" }, "stop"],
    ] as const;
    for (const [status, answer, result] of cases) {
      reply = { status, answer, date: new Date(time).toUTCString() };
      await expect(send()).resolves.toBe(result);
    }
    reply = {
      status: 400,
      answer: { error: "invalid_input" },
      date: new Date(time - 61_000).toUTCString(),
    };
    await expect(send()).resolves.toBe("retry");
    reply = undefined;
    await expect(send()).resolves.toBe("retry");
    expect(received).toEqual(
      Array.from({ length: 8 }, () => [
        "/api/installations/staff-report",
        id,
        { version: 1, bodySha256: createHash("sha256").update(body).digest("hex"), bodyBytes: 131 },
        body,
      ]),
    );
  } finally {
    await cloud.close();
  }
});

it("signs a separate description and retries while Cloud is missing its report", async () => {
  const description = JSON.stringify({ reportId: id, description: "Printer jammed", time });
  const operation = "e9b6d89f-625b-4dac-b81e-68513c0f69f4";
  const received: unknown[] = [];
  const cloud = await installationFixture(undefined, {
    staffReport: async (claims, _saved, request, response, envelope) => {
      received.push([request.url, claims[4], JSON.parse(String(claims[7])), envelope.body]);
      response.writeHead(received.length === 1 ? 404 : 200);
      response.end(
        JSON.stringify(received.length === 1 ? { error: "report_not_found" } : { received: true }),
      );
    },
  });
  try {
    const registration = (await cloud.client.errorReportRegistration())!;
    const send = () =>
      cloud.client.sendStaffReport(
        registration,
        operation,
        description,
        undefined,
        "staff-description",
      );
    await expect(send()).resolves.toBe("retry");
    await expect(send()).resolves.toBe("sent");
    expect(received).toEqual(
      Array.from({ length: 2 }, () => [
        "/api/installations/staff-description",
        operation,
        {
          version: 1,
          bodySha256: createHash("sha256").update(description).digest("hex"),
          bodyBytes: Buffer.byteLength(description),
        },
        description,
      ]),
    );
  } finally {
    await cloud.close();
  }
});
