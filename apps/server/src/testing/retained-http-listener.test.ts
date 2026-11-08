import { connect, createServer, type Server } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpsServer, get as getHttps } from "node:https";
import { expect, it } from "vitest";
import {
  retainHttpListener,
  retainedHttpPreload,
  transferRetainedListeners,
} from "./retained-http-listener.js";
import { adoptRetainedListeners } from "./retained-http-adoption.mjs";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";

function bind(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

it("keeps its selected port unavailable to a competing listener until released", async () => {
  const held = await retainHttpListener();
  const port = held.port;
  const competitor = createServer();
  try {
    await expect(bind(competitor, port)).rejects.toMatchObject({ code: "EADDRINUSE" });
  } finally {
    if (competitor.listening)
      await new Promise<void>((resolve) => competitor.close(() => resolve()));
    await held.close();
  }
});

it("closes an early connection instead of leaving a readiness read hanging", async () => {
  const held = await retainHttpListener();
  const socket = connect({ host: held.host, port: held.port });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("close", () => resolve());
      timer = setTimeout(
        () => reject(new Error("the holder kept the early connection open")),
        1_000,
      );
    });
  } finally {
    clearTimeout(timer);
    socket.destroy();
    await held.close();
  }
});

it("serves real HTTP on the retained port and releases it when the real server closes", async () => {
  const held = await retainHttpListener();
  const server = createHttpServer((_request, response) => response.end("retained HTTP"));
  const after = createServer();
  const adoption = adoptRetainedListeners([held]);
  try {
    await expect(bind(server, held.port)).resolves.toBeUndefined();
    const response = await fetch(`http://${held.host}:${held.port}`, {
      signal: AbortSignal.timeout(5_000),
    });
    expect(await response.text()).toBe("retained HTTP");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await held.close();
    await expect(bind(after, held.port)).resolves.toBeUndefined();
  } finally {
    adoption.restore();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (held.server.listening) await held.close();
    if (after.listening) await new Promise<void>((resolve) => after.close(() => resolve()));
  }
});

it.each(["http", "https"] as const)(
  "passes paired held sockets to a real %s child on their configured ports",
  async (scheme) => {
    const held = await retainHttpListener();
    const landing = await retainHttpListener();
    const tls =
      scheme === "https"
        ? mintSelfSignedServerCert({
            hostnames: ["localhost"],
            ipAddresses: ["127.0.0.1"],
            now: new Date(),
          })
        : undefined;
    const child = spawn(
      process.execPath,
      [
        "--import",
        retainedHttpPreload,
        "--input-type=module",
        "-e",
        `import { createServer } from "node:${scheme}";
import { createServer as createLanding } from "node:http";
const server = createServer(${JSON.stringify(tls === undefined ? {} : { key: tls.serverKeyPem, cert: tls.serverCertPem })}, (_request, response) => response.end("child HTTP"));
const landing = createLanding((_request, response) => response.end("child landing"));
process.on("SIGTERM", () => Promise.all([server, landing].map((item) => new Promise((resolve) => item.close(resolve)))).then(() => process.exit(0)));
let bound = 0;
const ready = () => { if (++bound === 2) process.stdout.write("READY\\n"); };
server.listen(Number(process.env.WAITRON_HTTP_PORT), "127.0.0.1", ready);
landing.listen(Number(process.env.WAITRON_HTTP_LANDING_PORT), "127.0.0.1", ready);`,
      ],
      {
        env: {
          ...process.env,
          WAITRON_HTTP_PORT: String(held.port),
          WAITRON_HTTP_LANDING_PORT: String(landing.port),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    const closed = once(child, "close");
    let output = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    child.stderr!.on("data", (bytes: Buffer) => (output += bytes.toString()));
    try {
      await transferRetainedListeners(child, [held, landing], 5_000);
      await new Promise<void>((resolve, reject) => {
        child.stdout!.on("data", (bytes: Buffer) => {
          output += bytes.toString();
          if (output.includes("READY\n")) resolve();
        });
        child.once("exit", () => reject(new Error(`child exited before binding: ${output}`)));
        timer = setTimeout(() => reject(new Error(`child did not bind: ${output}`)), 5_000);
      });
      const text =
        tls === undefined
          ? await (
              await fetch(`http://${held.host}:${held.port}`, {
                signal: AbortSignal.timeout(5_000),
              })
            ).text()
          : await new Promise<string>((resolve, reject) => {
              getHttps({ hostname: held.host, port: held.port, ca: tls.caCertPem }, (response) => {
                let body = "";
                response.on("data", (bytes: Buffer) => (body += bytes.toString()));
                response.once("end", () => resolve(body));
                response.once("error", reject);
              }).once("error", reject);
            });
      expect(text).toBe("child HTTP");
      const landingResponse = await fetch(`http://${landing.host}:${landing.port}`, {
        signal: AbortSignal.timeout(5_000),
      });
      expect(await landingResponse.text()).toBe("child landing");
      if (child.connected) await once(child, "disconnect");
      expect(child.connected).toBe(false);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await closed;
      if (held.server.listening) await held.close();
      if (landing.server.listening) await landing.close();
    }
    for (const port of [held.port, landing.port]) {
      const released = createServer();
      try {
        await expect(bind(released, port)).resolves.toBeUndefined();
      } finally {
        if (released.listening)
          await new Promise<void>((resolve) => released.close(() => resolve()));
      }
    }
  },
);

it("refuses to move a retained loopback socket to a requested wildcard host", async () => {
  const held = await retainHttpListener();
  const server = createHttpServer();
  const adoption = adoptRetainedListeners([held]);
  try {
    expect(() => server.listen(held.port, "0.0.0.0")).toThrow("retained listener host mismatch");
  } finally {
    adoption.restore();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await held.close();
  }
});

it("refuses metadata naming a port other than the one the socket holds", async () => {
  const held = await retainHttpListener();
  let adoption: ReturnType<typeof adoptRetainedListeners> | undefined;
  try {
    expect(() => {
      adoption = adoptRetainedListeners([
        { ...held, port: held.port === 65_535 ? 65_534 : held.port + 1 },
      ]);
    }).toThrow("retained listener address mismatch");
  } finally {
    adoption?.restore();
    await held.close();
  }
});

it("adopts a same-process HTTPS listener on the exact retained port", async () => {
  const held = await retainHttpListener();
  const tls = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  const server = createHttpsServer(
    { key: tls.serverKeyPem, cert: tls.serverCertPem },
    (_request, response) => response.end("retained HTTPS"),
  );
  const adoption = adoptRetainedListeners([held]);
  try {
    await bind(server, held.port);
    expect(await adoption.bound).toEqual([server]);
    const text = await new Promise<string>((resolve, reject) => {
      getHttps({ hostname: held.host, port: held.port, ca: tls.caCertPem }, (response) => {
        let body = "";
        response.on("data", (bytes: Buffer) => (body += bytes.toString()));
        response.once("end", () => resolve(body));
        response.once("error", reject);
      }).once("error", reject);
    });
    expect(text).toBe("retained HTTPS");
  } finally {
    adoption.restore();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await held.close();
  }
});

it.each(["exit", "disconnect", "silent"] as const)(
  "releases the parent's socket when the child handoff fails by %s",
  async (failure) => {
    const held = await retainHttpListener();
    const child = spawn(
      process.execPath,
      [
        "-e",
        failure === "exit"
          ? "process.exit(23)"
          : failure === "disconnect"
            ? 'process.send({ kind: "retained-listeners.request" }); setInterval(() => {}, 1000);'
            : "setInterval(() => {}, 1000);",
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const exited = once(child, "exit");
    if (failure === "disconnect") child.prependOnceListener("message", () => child.disconnect());
    try {
      const handoff = transferRetainedListeners(child, [held], failure === "silent" ? 50 : 5_000);
      if (failure === "disconnect")
        await expect(handoff).rejects.toMatchObject({ code: "ERR_IPC_CHANNEL_CLOSED" });
      else
        await expect(handoff).rejects.toThrow(
          failure === "exit" ? "child exited" : "handoff timed out",
        );
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await exited;
      if (held.server.listening) await held.close();
    }
    const reusable = createServer();
    try {
      await expect(bind(reusable, held.port)).resolves.toBeUndefined();
    } finally {
      if (reusable.listening) await new Promise<void>((resolve) => reusable.close(() => resolve()));
    }
  },
);

it("keeps unrelated binds and a later configured rebind on Node's original listen path", async () => {
  const held = await retainHttpListener();
  const unrelated = createServer();
  const first = createHttpServer();
  const second = createHttpServer();
  const adoption = adoptRetainedListeners([held]);
  try {
    await bind(unrelated, 0);
    expect((unrelated.address() as { port: number }).port).not.toBe(held.port);
    await bind(first, held.port);
    await new Promise<void>((resolve) => first.close(() => resolve()));
    await held.close();
    await expect(bind(second, held.port)).resolves.toBeUndefined();
  } finally {
    adoption.restore();
    for (const server of [unrelated, first, second, held.server]) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
