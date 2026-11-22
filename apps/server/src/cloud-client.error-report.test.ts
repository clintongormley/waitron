import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";

const operationId = "a88eb60a-ab63-4b60-88a3-de6f67663735";
const body =
  '{"code":"storage.disk_full","source":"backup","version":"1.10.0","time":1700000000000,"count":3,"logs":[]}';

it("signs the original error-report body and requires an accepted reply", async () => {
  let accepted = true;
  const received: unknown[] = [];
  const cloud = await installationFixture(undefined, {
    errorReport: (claims, _saved, request, response, envelope) => {
      received.push([request.method, request.url, claims[4], claims[7], Object.keys(envelope)]);
      response.end(JSON.stringify({ accepted }));
    },
  });
  try {
    expect(typeof cloud.client.errorReportRegistration).toBe("function");
    const registration = (await cloud.client.errorReportRegistration())!;
    await cloud.client.sendErrorReport(registration, operationId, body);
    expect(received).toEqual([
      ["POST", "/api/installations/error-report", operationId, body, ["payload", "signature"]],
    ]);
    accepted = false;
    await expect(
      cloud.client.sendErrorReport(registration, operationId, body),
    ).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    await cloud.close();
  }
});
