import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";
import { createRequestPlan, type RequestPlan } from "./aws-request-plan.js";
import {
  installSendGate,
  markRunnerClient,
  openRequestScope,
  setSendGateStrict,
  uninstallSendGate,
} from "./aws-send-gate.js";

const BUCKET = "waitron-rehearsal-waitron-abcdefghijkl";
const PREFIX = "rehearsal-run1/loop/";
const OUTSIDE_KEY = "unissued-outside-key";

function recording() {
  let handled = 0;
  const requestHandler = {
    async handle() {
      handled += 1;
      return {
        response: { statusCode: 200, headers: { etag: '"v1"' }, body: Readable.from([]) },
      };
    },
  };
  const client = new S3Client({
    region: "eu-north-1",
    credentials: { accessKeyId: "AKIAEXAMPLE0000", secretAccessKey: "not-a-real-secret" },
    requestHandler,
  });
  return { client, handled: () => handled };
}

function plan(): RequestPlan {
  return createRequestPlan({
    bucket: BUCKET,
    apis: ["PutObject"],
    prefixes: () => new Set([PREFIX]),
  });
}

const planned = () => new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}a`, Body: "x" });
const unplanned = () => new PutObjectCommand({ Bucket: BUCKET, Key: OUTSIDE_KEY, Body: "x" });

const sendProto = Object.getPrototypeOf(S3Client.prototype) as { send: unknown };
let original: unknown;

beforeAll(() => {
  original = sendProto.send;
  installSendGate();
});

afterEach(() => {
  setSendGateStrict(false);
});

afterAll(() => {
  uninstallSendGate();
  expect(sendProto.send).toBe(original);
});

describe("the send gate", () => {
  it("lets a planned request reach the handler", async () => {
    const { client, handled } = recording();
    const scope = openRequestScope({ plan: plan(), mode: "enforce" });
    await scope.run(() => client.send(planned()));
    expect(handled()).toBe(1);
    expect(scope.refusals()).toEqual({ count: 0, first: undefined });
  });

  it("refuses an unplanned request before it reaches the handler", async () => {
    const { client, handled } = recording();
    const refused: [string, string][] = [];
    const scope = openRequestScope({
      plan: plan(),
      mode: "enforce",
      onRefused: (detail, api) => refused.push([detail, api]),
    });
    const error = await scope.run(() => client.send(unplanned())).catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("request-unplanned");
    expect((error as Error).message).toContain(
      "every key in a scenario's PutObject must be under a prefix this run issued",
    );
    expect((error as Error).message).not.toContain(OUTSIDE_KEY);
    expect(refused).toEqual([
      ["every key in a scenario's PutObject must be under a prefix this run issued", "PutObject"],
    ]);
    expect(scope.refusals()).toEqual({
      count: 1,
      first: "every key in a scenario's PutObject must be under a prefix this run issued",
    });
  });

  it("checks a runner-marked client against the runner's rules", async () => {
    const { client, handled } = recording();
    markRunnerClient(client);
    const scope = openRequestScope({ plan: plan(), mode: "enforce" });
    await scope.run(() => client.send(new CreateBucketCommand({ Bucket: BUCKET })));
    expect(handled()).toBe(1);
    const error = await scope
      .run(() => client.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}a` })))
      .catch((e: unknown) => e);
    expect(handled()).toBe(1);
    expect((error as Error).message).toContain(
      "the runner may send GetObject only for the ownership marker",
    );
  });

  it("passes a scope-less request through when the gate is not strict", async () => {
    const { client, handled } = recording();
    await client.send(unplanned());
    expect(handled()).toBe(1);
  });

  it("refuses a scope-less request when the gate is strict", async () => {
    const { client, handled } = recording();
    setSendGateStrict(true);
    const error = await client.send(unplanned()).catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("request-unplanned");
    expect((error as Error).message).toContain("PutObject was sent outside a rehearsal run");
  });

  it("hands a refusal to the callback form without calling the real send", async () => {
    const { client, handled } = recording();
    const scope = openRequestScope({ plan: plan(), mode: "enforce" });
    const viaCallback = (command: PutObjectCommand, withOptions: boolean) =>
      new Promise<unknown>((resolve) => {
        const cb = (err: unknown) => resolve(err);
        scope.run(() => {
          if (withOptions) client.send(command, {}, cb);
          else client.send(command, cb);
        });
      });
    expect(await viaCallback(unplanned(), false)).toBeInstanceOf(AwsRehearsalRefused);
    expect(await viaCallback(unplanned(), true)).toBeInstanceOf(AwsRehearsalRefused);
    expect(handled()).toBe(0);
    expect(await viaCallback(planned(), false)).toBeNull();
    expect(handled()).toBe(1);
  });

  it("wraps send once however many times it is installed", async () => {
    installSendGate();
    installSendGate();
    const { client, handled } = recording();
    let calls = 0;
    const scope = openRequestScope({
      plan: plan(),
      mode: "enforce",
      onRefused: () => {
        calls += 1;
      },
    });
    await scope.run(() => client.send(unplanned())).catch(() => undefined);
    expect(calls).toBe(1);
    expect(scope.refusals().count).toBe(1);
    await scope.run(() => client.send(planned()));
    expect(handled()).toBe(1);
  });

  it("refuses everything after the scope is closed, even inside a callback it started", async () => {
    const { client, handled } = recording();
    const refused: string[] = [];
    const scope = openRequestScope({
      plan: plan(),
      mode: "enforce",
      onRefused: (detail) => refused.push(detail),
    });
    const late = scope.run(async () => {
      await sleep(20);
      return client.send(planned());
    });
    scope.close();
    const error = await late.catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect((error as Error).message).toContain("the run has ended");
    expect(refused).toEqual(["PutObject was sent after the run has ended"]);
    expect(() =>
      scope.check("scenario", "PutObject", { Bucket: BUCKET, Key: `${PREFIX}a` }),
    ).toThrow("the run has ended");
  });

  it("checks a client created before the scope was opened", async () => {
    const { client, handled } = recording();
    const scope = openRequestScope({ plan: plan(), mode: "enforce" });
    await scope.run(() => client.send(unplanned())).catch(() => undefined);
    expect(handled()).toBe(0);
  });

  it("exposes the same check send makes", () => {
    const scope = openRequestScope({ plan: plan(), mode: "enforce" });
    expect(() =>
      scope.check("scenario", "PutObject", { Bucket: BUCKET, Key: `${PREFIX}a` }),
    ).not.toThrow();
    expect(() =>
      scope.check("scenario", "PutObject", { Bucket: BUCKET, Key: OUTSIDE_KEY }),
    ).toThrow(AwsRehearsalRefused);
    expect(scope.refusals().count).toBe(1);
  });

  it("in record mode lets every request through and lists what it saw", async () => {
    const { client, handled } = recording();
    const runner = recording();
    markRunnerClient(runner.client);
    const scope = openRequestScope({ plan: plan(), mode: "record" });
    await scope.run(async () => {
      await client.send(unplanned());
      await client.send(unplanned());
      await client.send(new GetObjectCommand({ Bucket: "foreign-bucket", Key: OUTSIDE_KEY }));
      await runner.client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    });
    expect(handled()).toBe(3);
    expect(runner.handled()).toBe(1);
    expect(scope.seen()).toEqual([
      { sender: "scenario", api: "PutObject" },
      { sender: "scenario", api: "GetObject" },
      { sender: "runner", api: "CreateBucket" },
    ]);
    expect(scope.refusals().count).toBe(0);
  });
});
