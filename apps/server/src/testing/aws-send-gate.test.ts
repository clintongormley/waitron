import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
const S3_HOSTS = { s3Region: "eu-north-1" } as const;

function recording(config: ConstructorParameters<typeof S3Client>[0] = {}) {
  let handled = 0;
  const hosts: string[] = [];
  const sent: { path: string; body: string }[] = [];
  const requestHandler = {
    async handle(request: { hostname: string; path: string; body?: unknown }) {
      handled += 1;
      hosts.push(request.hostname);
      sent.push({ path: request.path, body: typeof request.body === "string" ? request.body : "" });
      return {
        response: { statusCode: 200, headers: { etag: '"v1"' }, body: Readable.from([]) },
      };
    },
  };
  const client = new S3Client({
    region: "eu-north-1",
    credentials: { accessKeyId: "AKIAEXAMPLE0000", secretAccessKey: "not-a-real-secret" },
    requestHandler,
    ...config,
  });
  return { client, handled: () => handled, hosts: () => hosts, sent: () => sent };
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
  vi.unstubAllEnvs();
});

afterAll(() => {
  uninstallSendGate();
  expect(sendProto.send).toBe(original);
});

describe("the send gate", () => {
  it("lets a planned request reach the handler", async () => {
    const { client, handled } = recording();
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
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
      hosts: S3_HOSTS,
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

  it("rejects with the refusal, not the error, when the refusal hook throws", async () => {
    const { client, handled } = recording();
    const scope = openRequestScope({
      plan: plan(),
      mode: "enforce",
      hosts: S3_HOSTS,
      onRefused: () => {
        throw new Error("hook failed");
      },
    });
    const error = await scope.run(() => client.send(unplanned())).catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("request-unplanned");
    expect(scope.refusals().count).toBe(1);
  });

  it("checks a runner-marked client against the runner's rules", async () => {
    const { client, handled } = recording();
    markRunnerClient(client);
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
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
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
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
      hosts: S3_HOSTS,
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
      hosts: S3_HOSTS,
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

  it("checks a client created before the gate was installed", async () => {
    uninstallSendGate();
    const { client, handled } = recording();
    installSendGate();
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
    const error = await scope.run(() => client.send(unplanned())).catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
  });

  it("exposes the same check send makes", () => {
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
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
    const scope = openRequestScope({ plan: plan(), mode: "record", hosts: S3_HOSTS });
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

describe("the send gate's check of what is serialised", () => {
  const KEY_REFUSAL = "every key in a scenario's PutObject must be under a prefix this run issued";

  function keyedPlan(): RequestPlan {
    return createRequestPlan({
      bucket: BUCKET,
      apis: ["PutObject", "DeleteObjects"],
      prefixes: () => new Set([PREFIX]),
    });
  }

  async function expectRefused(
    pending: Promise<unknown>,
    detail: string,
    scope: ReturnType<typeof openRequestScope>,
    handled: () => number,
  ) {
    const error = await pending.catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("request-unplanned");
    expect((error as Error).message).toContain(detail);
    expect((error as Error).message).not.toContain(OUTSIDE_KEY);
    expect(scope.refusals()).toEqual({ count: 1, first: detail });
  }

  it("refuses a PutObject whose key is changed after send, before the SDK has read it", async () => {
    const { client, handled } = recording();
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    client.middlewareStack.add(
      (next) => async (args) => {
        reached();
        await held;
        return next(args);
      },
      { step: "initialize", name: "holdBeforeSerialising" },
    );
    const refused: [string, string][] = [];
    const scope = openRequestScope({
      plan: keyedPlan(),
      mode: "enforce",
      hosts: S3_HOSTS,
      onRefused: (detail, api) => refused.push([detail, api]),
    });
    const command = planned();
    const pending = scope.run(() => client.send(command));
    await waiting;
    command.input.Key = OUTSIDE_KEY;
    release();
    await expectRefused(pending, KEY_REFUSAL, scope, handled);
    expect(refused).toEqual([[KEY_REFUSAL, "PutObject"]]);
  });

  it("refuses a DeleteObjects whose nested key is changed after send is called", async () => {
    const { client, handled } = recording();
    const scope = openRequestScope({ plan: keyedPlan(), mode: "enforce", hosts: S3_HOSTS });
    const command = new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: [{ Key: `${PREFIX}a` }] },
    });
    const pending = scope.run(() => client.send(command));
    command.input.Delete!.Objects![0]!.Key = OUTSIDE_KEY;
    await expectRefused(
      pending,
      "every key in a scenario's DeleteObjects must be under a prefix this run issued",
      scope,
      handled,
    );
  });

  it("refuses a request whose key a middleware rewrites before serialisation", async () => {
    const { client, handled } = recording();
    client.middlewareStack.add(
      (next) => async (args) => {
        (args.input as { Key?: string }).Key = OUTSIDE_KEY;
        return next(args);
      },
      { step: "initialize", name: "rewriteKey" },
    );
    const scope = openRequestScope({ plan: keyedPlan(), mode: "enforce", hosts: S3_HOSTS });
    await expectRefused(
      scope.run(() => client.send(planned())),
      KEY_REFUSAL,
      scope,
      handled,
    );
  });

  it("sends an unchanged planned request, and one a middleware moves to another planned key", async () => {
    const { client, handled, sent } = recording({ forcePathStyle: true });
    const scope = openRequestScope({ plan: keyedPlan(), mode: "enforce", hosts: S3_HOSTS });
    await scope.run(() => client.send(planned()));
    await scope.run(() =>
      client.send(
        new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: [{ Key: `${PREFIX}a` }] } }),
      ),
    );
    client.middlewareStack.add(
      (next) => async (args) => {
        (args.input as { Key?: string }).Key = `${PREFIX}moved`;
        return next(args);
      },
      { step: "initialize", name: "moveKey" },
    );
    await scope.run(() => client.send(planned()));
    expect(handled()).toBe(3);
    expect(sent().map((request) => request.path)).toEqual([
      `/${BUCKET}/${PREFIX}a`,
      `/${BUCKET}/`,
      `/${BUCKET}/${PREFIX}moved`,
    ]);
    expect(sent()[1]!.body).toContain(`<Key>${PREFIX}a</Key>`);
    expect(scope.refusals().count).toBe(0);
  });
});

describe("the send gate's host check", () => {
  const LOCAL = "http://127.0.0.1:9";
  const HOST_REFUSAL = "PutObject was sent to a host that is not this run's Amazon S3 host";

  it("refuses, before the handler, a request whose resolved host is not Amazon's", async () => {
    const { client, handled } = recording({ endpoint: LOCAL, forcePathStyle: true });
    const refused: [string, string][] = [];
    const scope = openRequestScope({
      plan: plan(),
      mode: "enforce",
      hosts: S3_HOSTS,
      onRefused: (detail, api) => refused.push([detail, api]),
    });
    const error = await scope.run(() => client.send(planned())).catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("request-unplanned");
    expect((error as Error).message).toContain(HOST_REFUSAL);
    expect((error as Error).message).not.toContain("127.0.0.1");
    expect(refused).toEqual([[HOST_REFUSAL, "PutObject"]]);
    expect(scope.refusals()).toEqual({ count: 1, first: HOST_REFUSAL });
  });

  it("refuses a host a config file's second, quoted profile header points the SDK at", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-send-gate-"));
    try {
      const config = join(dir, "config");
      await writeFile(
        config,
        "[profile waitron-rehearsal]\nregion = eu-north-1\n" +
          '[profile "waitron-rehearsal"]\nendpoint_url = http://127.0.0.1:9\n',
      );
      vi.stubEnv("AWS_CONFIG_FILE", config);
      vi.stubEnv("AWS_PROFILE", "waitron-rehearsal");
      const { client, handled } = recording({ forcePathStyle: true });
      const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
      const error = await scope.run(() => client.send(planned())).catch((e: unknown) => e);
      expect(handled()).toBe(0);
      expect((error as Error).message).toContain(HOST_REFUSAL);

      // The control: the same file, with any host allowed, does send to the local host.
      const control = recording({ forcePathStyle: true });
      const open = openRequestScope({ plan: plan(), mode: "enforce", hosts: "any" });
      await open.run(() => control.client.send(planned()));
      expect(control.hosts()).toEqual(["127.0.0.1"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lets a FIPS or dual-stack Amazon S3 host through", async () => {
    const fips = recording({ useFipsEndpoint: true });
    const dual = recording({ useDualstackEndpoint: true });
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
    await scope.run(() => fips.client.send(planned()));
    await scope.run(() => dual.client.send(planned()));
    expect([...fips.hosts(), ...dual.hosts()]).toEqual([
      `${BUCKET}.s3-fips.eu-north-1.amazonaws.com`,
      `${BUCKET}.s3.dualstack.eu-north-1.amazonaws.com`,
    ]);
    expect(scope.refusals().count).toBe(0);
  });

  it.each([
    ["an EC2 instance's public name", "http://ec2-203-0-113-1.eu-north-1.compute.amazonaws.com"],
    ["an API Gateway host", "https://abc123.execute-api.eu-north-1.amazonaws.com"],
    ["a load balancer's host", "http://my-lb-1.eu-north-1.elb.amazonaws.com"],
    ["another bucket's S3 host", "https://someone-elses.s3.eu-north-1.amazonaws.com"],
    ["another region's S3 host", "https://s3.eu-west-1.amazonaws.com"],
  ])("refuses %s, which is under amazonaws.com but not this run's S3", async (_, endpoint) => {
    const { client, handled } = recording({ endpoint, forcePathStyle: true });
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
    const error = await scope.run(() => client.send(planned())).catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect((error as Error).message).toContain(HOST_REFUSAL);
  });

  it("refuses the accelerate host, which no rehearsal client is built to use", async () => {
    const { client, handled } = recording({ useAccelerateEndpoint: true });
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
    const error = await scope.run(() => client.send(planned())).catch((e: unknown) => e);
    expect(handled()).toBe(0);
    expect((error as Error).message).toContain(HOST_REFUSAL);
  });

  it("lets through every S3 host the SDK builds for the run's bucket and region", async () => {
    const switches = [
      {},
      { forcePathStyle: true },
      { useFipsEndpoint: true },
      { useFipsEndpoint: true, forcePathStyle: true },
      { useDualstackEndpoint: true },
      { useDualstackEndpoint: true, forcePathStyle: true },
      { useFipsEndpoint: true, useDualstackEndpoint: true },
      { useFipsEndpoint: true, useDualstackEndpoint: true, forcePathStyle: true },
    ];
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
    const seen: string[] = [];
    for (const config of switches) {
      const { client, hosts } = recording(config);
      await scope.run(() => client.send(planned()));
      seen.push(...hosts());
    }
    expect(seen).toEqual([
      `${BUCKET}.s3.eu-north-1.amazonaws.com`,
      "s3.eu-north-1.amazonaws.com",
      `${BUCKET}.s3-fips.eu-north-1.amazonaws.com`,
      "s3-fips.eu-north-1.amazonaws.com",
      `${BUCKET}.s3.dualstack.eu-north-1.amazonaws.com`,
      "s3.dualstack.eu-north-1.amazonaws.com",
      `${BUCKET}.s3-fips.dualstack.eu-north-1.amazonaws.com`,
      "s3-fips.dualstack.eu-north-1.amazonaws.com",
    ]);
    expect(scope.refusals().count).toBe(0);
  });

  it("checks the host on a client that cached its middleware before its first send in a scope", async () => {
    const { client, handled } = recording({
      endpoint: LOCAL,
      forcePathStyle: true,
      cacheMiddleware: true,
    });
    await client.send(planned());
    expect(handled()).toBe(1);
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: S3_HOSTS });
    const error = await scope.run(() => client.send(planned())).catch((e: unknown) => e);
    expect(handled()).toBe(1);
    expect((error as Error).message).toContain(HOST_REFUSAL);
  });

  it("lets a local host through only when the scope allows any host", async () => {
    const { client, handled, hosts } = recording({ endpoint: LOCAL, forcePathStyle: true });
    const scope = openRequestScope({ plan: plan(), mode: "enforce", hosts: "any" });
    await scope.run(() => client.send(planned()));
    expect(handled()).toBe(1);
    expect(hosts()).toEqual(["127.0.0.1"]);
  });

  it("leaves a scope-less request to another host alone when the gate is not strict", async () => {
    const { client, handled } = recording({ endpoint: LOCAL, forcePathStyle: true });
    await client.send(planned());
    expect(handled()).toBe(1);
  });
});
