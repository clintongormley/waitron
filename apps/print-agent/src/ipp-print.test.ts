import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import type { PageHold } from "@waitron/print-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeIpp } from "./ipp-http.js";
import {
  IPP_POLL_LIMIT_MS,
  IPP_POLL_REQUEST_TIMEOUT_MS,
  IPP_SUBMIT_TIMEOUT_MS,
  printOverIpp,
  type IppPrintOptions,
  type IppPrintOutcome,
} from "./ipp-print.js";

/**
 * While `stalled.on` is set, every client request gets a connection that never opens, as a
 * switched-off printer's address gives; nothing it is handed reaches any listener.
 */
const stalled = vi.hoisted(() => ({ on: false, dials: 0 }));
/** Every HTTP request the module under test has started. */
const client = vi.hoisted(() => ({ requests: 0 }));
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  const request = (options: RequestOptions, callback?: (res: IncomingMessage) => void) => {
    client.requests++;
    return actual.request(
      stalled.on
        ? {
            ...options,
            // Node consults `createConnection` only when no agent is named.
            agent: undefined,
            createConnection: () => {
              stalled.dials++;
              return new Duplex({ read() {}, write() {} }) as never;
            },
          }
        : options,
      callback,
    );
  };
  return { ...actual, request };
});

type Attr = { tag: number; name: string; value: Buffer };

/** One request the fake printer received, read by a decoder independent of the module under test. */
type Received = {
  url?: string;
  headers: IncomingHttpHeaders;
  operation: number;
  requestId: number;
  attrs: Attr[];
  data: Buffer;
};

function decodeRequest(body: Buffer, raw: IncomingMessage): Received {
  const attrs: Attr[] = [];
  let offset = 8;
  let name = "";
  for (;;) {
    const tag = body[offset++]!;
    if (tag === 0x03) break;
    if (tag < 0x10) continue;
    const n = body.readUInt16BE(offset);
    offset += 2;
    if (n > 0) name = body.toString("utf8", offset, offset + n);
    offset += n;
    const length = body.readUInt16BE(offset);
    offset += 2;
    attrs.push({ tag, name, value: body.subarray(offset, offset + length) });
    offset += length;
  }
  return {
    url: raw.url,
    headers: raw.headers,
    operation: body.readUInt16BE(2),
    requestId: body.readUInt32BE(4),
    attrs,
    data: body.subarray(offset),
  };
}

const text = (attrs: Attr[], name: string): string[] =>
  attrs.filter((a) => a.name === name).map((a) => a.value.toString("utf8"));

function int(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

/**
 * An IPP reply writer independent of the module under test. Values in `job` go in the job group,
 * or in the group `groupTag` names.
 */
function ippReply(
  status: number,
  requestId: number,
  job: Array<{ tag: number; name: string; value: string | Buffer }> = [],
  groupTag = 0x02,
): Buffer {
  const attribute = ({
    tag,
    name,
    value,
  }: {
    tag: number;
    name: string;
    value: string | Buffer;
  }) => {
    const n = Buffer.from(name);
    const v = Buffer.from(value);
    const head = Buffer.alloc(3);
    head[0] = tag;
    head.writeUInt16BE(n.length, 1);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(v.length);
    return Buffer.concat([head, n, length, v]);
  };
  const header = Buffer.alloc(8);
  header[0] = 2;
  header.writeUInt16BE(status, 2);
  header.writeUInt32BE(requestId, 4);
  return Buffer.concat([
    header,
    Buffer.from([0x01]),
    attribute({ tag: 0x47, name: "attributes-charset", value: "utf-8" }),
    attribute({ tag: 0x48, name: "attributes-natural-language", value: "en" }),
    ...(job.length > 0 ? [Buffer.from([groupTag]), ...job.map(attribute)] : []),
    Buffer.from([0x03]),
  ]);
}

const PENDING = 3;
const PROCESSING = 5;
const CANCELED = 7;
const ABORTED = 8;
const COMPLETED = 9;

/** The job group a printer answers with: id, state and its reasons as a 1setOf keyword. */
function jobGroup(jobId: number | undefined, state: number | undefined, reasons: string[] = []) {
  return [
    ...(jobId === undefined ? [] : [{ tag: 0x21, name: "job-id", value: int(jobId) }]),
    ...(state === undefined ? [] : [{ tag: 0x23, name: "job-state", value: int(state) }]),
    ...reasons.map((value, i) => ({ tag: 0x44, name: i === 0 ? "job-state-reasons" : "", value })),
  ];
}

const accepted = (req: Received, jobId = 42, state = PENDING, reasons: string[] = []) =>
  ippReply(0x0000, req.requestId, jobGroup(jobId, state, reasons));
const jobState = (req: Received, state: number, reasons: string[] = []) =>
  ippReply(0x0000, req.requestId, jobGroup(undefined, state, reasons));

const PRINTER_PROCESSING = 4;
const PRINTER_STOPPED = 5;
/** A Get-Printer-Attributes answer: the printer group's state and its reasons as a 1setOf keyword. */
const printerState = (req: Received, state: number | undefined, reasons: string[] = []) =>
  ippReply(
    0x0000,
    req.requestId,
    [
      ...(state === undefined ? [] : [{ tag: 0x23, name: "printer-state", value: int(state) }]),
      ...reasons.map((value, i) => ({
        tag: 0x44,
        name: i === 0 ? "printer-state-reasons" : "",
        value,
      })),
    ],
    0x04,
  );

type Answer = (req: Received, res: ServerResponse, raw: IncomingMessage) => void;
const PRINT_JOB = 0x0002;
const GET_JOB_ATTRIBUTES = 0x0009;
const GET_PRINTER_ATTRIBUTES = 0x000b;

/**
 * An in-process IPP printer on a free loopback port that records every request it reads. Unless
 * told otherwise it answers a Get-Printer-Attributes as a printer that is printing.
 */
async function fakePrinter(
  onPrintJob: Answer,
  onPoll: Answer = () => {},
  onPrinter: Answer = (req, res) => res.end(printerState(req, PRINTER_PROCESSING, ["none"])),
) {
  const requests: Received[] = [];
  let arrived = 0;
  let accepted = 0;
  let open = 0;
  const server = createServer((raw, res) => {
    arrived++;
    const chunks: Buffer[] = [];
    raw.on("data", (chunk: Buffer) => chunks.push(chunk));
    raw.on("end", () => {
      const req = decodeRequest(Buffer.concat(chunks), raw);
      requests.push(req);
      const answer =
        req.operation === PRINT_JOB
          ? onPrintJob
          : req.operation === GET_PRINTER_ATTRIBUTES
            ? onPrinter
            : onPoll;
      answer(req, res, raw);
    });
  });
  server.on("connection", (socket) => {
    accepted++;
    open++;
    socket.on("close", () => open--);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  servers.push(server);
  return {
    port,
    requests,
    /** Every HTTP request that reached the printer, read or not. */
    arrived: () => arrived,
    /** Whether every connection the agent has opened was accepted here and has closed. */
    settled: () => accepted === client.requests && open === 0,
    printJobs: () => requests.filter((r) => r.operation === PRINT_JOB),
    polls: () => requests.filter((r) => r.operation === GET_JOB_ATTRIBUTES),
    printerQueries: () => requests.filter((r) => r.operation === GET_PRINTER_ATTRIBUTES),
  };
}

/**
 * Waits in real time for `check` to pass. `vi.waitFor` is not used beside fake timers because it
 * advances them on every check, which would spend the bound under test.
 */
async function until(check: () => boolean): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 2000) throw new Error("condition not met within 2 s");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  stalled.on = false;
  stalled.dials = 0;
  client.requests = 0;
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const DOCUMENT = Buffer.from("%PDF-1.7 synthetic invoice page\n");
const target = (port: number, documentFormat = "application/pdf") => ({
  host: "127.0.0.1",
  port,
  resourcePath: "/ipp/print",
  documentFormat,
});
/** Short bounds so the cases run in well under a second each; the defaults have their own cases. */
const quick: IppPrintOptions = { submitTimeoutMs: 1000, pollLimitMs: 1000, pollIntervalMs: 5 };

const sent: IppPrintOutcome = { status: "sent" };
const refused: IppPrintOutcome = { status: "failed", failureCode: "printer_refused" };
const unreachable: IppPrintOutcome = { status: "failed", failureCode: "printer_unreachable" };
const aborted: IppPrintOutcome = { status: "unknown", failureCode: "printer_aborted" };
const timedOut: IppPrintOutcome = { status: "unknown", failureCode: "timeout" };

describe("printOverIpp — submission", () => {
  it("sends one Print-Job with the stored format, a fixed job name and the document, then polls that job until it completes", async () => {
    let polls = 0;
    const printer = await fakePrinter(
      (req, res) => res.writeHead(200, { "content-type": "application/ipp" }).end(accepted(req)),
      (req, res) => {
        polls++;
        res.end(jobState(req, polls < 3 ? PROCESSING : COMPLETED, ["job-completed-successfully"]));
      },
    );
    expect(await printOverIpp(target(printer.port, "image/urf"), DOCUMENT, quick)).toEqual(sent);

    const [job, ...others] = printer.printJobs();
    expect(others).toEqual([]);
    expect(job!.url).toBe("/ipp/print");
    expect(job!.data).toEqual(DOCUMENT);
    expect(text(job!.attrs, "printer-uri")).toEqual([`ipp://127.0.0.1:${printer.port}/ipp/print`]);
    expect(text(job!.attrs, "document-format")).toEqual(["image/urf"]);
    expect(text(job!.attrs, "job-name")).toEqual(["Waitron invoice"]);
    expect(job!.attrs.map((a) => a.name)).toEqual([
      "attributes-charset",
      "attributes-natural-language",
      "printer-uri",
      "requesting-user-name",
      "job-name",
      "document-format",
    ]);

    expect(printer.polls()).toHaveLength(3);
    for (const poll of printer.polls()) {
      expect(poll.url).toBe("/ipp/print");
      expect(poll.data).toHaveLength(0);
      expect(poll.attrs.find((a) => a.name === "job-id")?.value).toEqual(int(42));
      expect(text(poll.attrs, "printer-uri")).toEqual([
        `ipp://127.0.0.1:${printer.port}/ipp/print`,
      ]);
    }
    expect(new Set(printer.requests.map((r) => r.requestId)).size).toBe(printer.requests.length);
    expect(printer.printerQueries()).toHaveLength(2);
  });

  it("sends the Print-Job and every poll as a chunked body with no content-length", async () => {
    let polls = 0;
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(jobState(req, ++polls < 2 ? PROCESSING : COMPLETED)),
    );
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(sent);

    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(2);
    for (const request of printer.requests) {
      expect(request.headers["transfer-encoding"]).toBe("chunked");
      expect(request.headers).not.toHaveProperty("content-length");
    }
  });

  it("answers sent without polling when the Print-Job reply already says completed", async () => {
    const printer = await fakePrinter((req, res) => res.end(accepted(req, 7, COMPLETED)));
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(sent);
    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(0);
  });

  it.each([
    ["client-error-document-format-not-supported", 0x040a],
    ["client-error-not-authorized", 0x0403],
    ["server-error-busy", 0x0507],
    ["redirection-other-site", 0x0300],
  ])(
    "answers failed/printer_refused for an IPP %s status, and never polls",
    async (_label, status) => {
      const printer = await fakePrinter((req, res) => res.end(ippReply(status, req.requestId)));
      expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(refused);
      expect(printer.printJobs()).toHaveLength(1);
      expect(printer.polls()).toHaveLength(0);
    },
  );

  it.each([401, 426, 500])(
    "answers failed/printer_refused for HTTP %i, even with an accepting body",
    async (code) => {
      const printer = await fakePrinter((req, res) => res.writeHead(code).end(accepted(req)));
      expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(refused);
      expect(printer.printJobs()).toHaveLength(1);
      expect(printer.polls()).toHaveLength(0);
    },
  );

  it("answers failed/printer_unreachable when the connection is refused", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await printOverIpp(target(port), DOCUMENT, quick)).toEqual(unreachable);
  });

  it.each([
    ["a host name the HTTP client refuses", { host: "bad\nhost" }],
    ["a host too long to encode", { host: "a".repeat(70_000) }],
    ["a queue path the HTTP client refuses", { resourcePath: "/ipp/a b" }],
  ])("answers failed/printer_unreachable, rather than throwing, for %s", async (_label, change) => {
    await expect(printOverIpp({ ...target(631), ...change }, DOCUMENT, quick)).resolves.toEqual(
      unreachable,
    );
  });

  it("answers failed/printer_unreachable when the connection never opens within the submission bound", async () => {
    stalled.on = true;
    const started = Date.now();
    expect(await printOverIpp(target(631), DOCUMENT, { ...quick, submitTimeoutMs: 100 })).toEqual(
      unreachable,
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(stalled.dials).toBe(1);
  });

  it("answers unknown/timeout when the printer takes the job and never answers", async () => {
    const printer = await fakePrinter(() => {});
    const started = Date.now();
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, { ...quick, submitTimeoutMs: 100 }),
    ).toEqual(timedOut);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(0);
  });

  it("answers unknown/timeout when the printer drops the connection after reading the job", async () => {
    const printer = await fakePrinter((_req, _res, raw) => raw.socket.destroy());
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(timedOut);
    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(0);
  });

  it.each([
    ["bytes that are not IPP", () => Buffer.from("<html>ok</html>")],
    ["an accepting reply with no job id", (req: Received) => ippReply(0, req.requestId, [])],
    [
      "a job id of the wrong length",
      (req: Received) =>
        ippReply(0, req.requestId, [{ tag: 0x21, name: "job-id", value: Buffer.from([1]) }]),
    ],
  ])("answers unknown/timeout for HTTP 200 carrying %s, and never polls", async (_label, body) => {
    const printer = await fakePrinter((req, res) => res.end(body(req)));
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(timedOut);
    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(0);
  });

  it("bounds submission to 30 seconds by default", async () => {
    expect(IPP_SUBMIT_TIMEOUT_MS).toBe(30_000);
    const printer = await fakePrinter(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let outcome: IppPrintOutcome | undefined;
    void printOverIpp(target(printer.port), DOCUMENT).then((o) => (outcome = o));
    await until(() => printer.printJobs().length === 1);
    await vi.advanceTimersByTimeAsync(29_999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await until(() => outcome !== undefined);
    expect(outcome).toEqual(timedOut);
  });
});

describe("printOverIpp — after the printer accepts", () => {
  it.each([
    ["aborted", ABORTED],
    ["canceled", CANCELED],
  ])("answers unknown/printer_aborted when the job ends %s", async (_label, state) => {
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(jobState(req, state, ["aborted-by-system"])),
    );
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(aborted);
    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(1);
  });

  it.each([
    ["job-completed-with-errors"],
    ["job-canceled-at-device"],
    ["job-canceled-by-user"],
    ["aborted-by-system"],
  ])(
    "answers unknown/printer_aborted for a completed job whose reasons include %s",
    async (reason) => {
      const printer = await fakePrinter(
        (req, res) => res.end(accepted(req)),
        (req, res) => res.end(jobState(req, COMPLETED, ["job-completed-with-warnings", reason])),
      );
      expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(aborted);
    },
  );

  it("answers sent for a completed job whose reasons name only a successful or warned completion", async () => {
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(jobState(req, COMPLETED, ["job-completed-with-warnings", "none"])),
    );
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(sent);
  });

  it("answers unknown/printer_aborted when the Print-Job reply already says aborted", async () => {
    const printer = await fakePrinter((req, res) => res.end(accepted(req, 7, ABORTED)));
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(aborted);
    expect(printer.polls()).toHaveLength(0);
  });

  it("keeps polling past a poll the printer refuses, drops, garbles or leaves without a state", async () => {
    const answers: Answer[] = [
      (req, res) => res.end(ippReply(0x0500, req.requestId)),
      (req, res) => res.end(ippReply(0x0400, req.requestId)),
      (_req, _res, raw) => raw.socket.destroy(),
      (_req, res) => res.end(Buffer.from("not ipp")),
      (_req, res) => res.writeHead(503).end(),
      (req, res) => res.end(ippReply(0, req.requestId, jobGroup(42, undefined))),
      (req, res) => res.end(jobState(req, PROCESSING)),
      (req, res) => res.end(jobState(req, COMPLETED)),
    ];
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res, raw) => answers[printer.polls().length - 1]!(req, res, raw),
    );
    expect(await printOverIpp(target(printer.port), DOCUMENT, quick)).toEqual(sent);
    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(answers.length);
  });

  it.each([
    ["client-error-not-found", 0x0406],
    ["client-error-gone", 0x0407],
  ])("ends polling at once, unknown/timeout, when a poll answers %s", async (_label, status) => {
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(ippReply(status, req.requestId)),
    );
    const started = Date.now();
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, { ...quick, pollLimitMs: 5000 }),
    ).toEqual(timedOut);
    expect(Date.now() - started).toBeLessThan(1000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.polls()).toHaveLength(1);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it("answers unknown/timeout once the poll bound passes, and polls no more", async () => {
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(jobState(req, PROCESSING, ["job-printing"])),
    );
    const started = Date.now();
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, { ...quick, pollLimitMs: 200 }),
    ).toEqual(timedOut);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(1000);
    // A poll sent before the bound may not have been read yet by the in-process printer.
    await until(() => printer.settled());
    const polled = printer.polls().length;
    expect(polled).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.polls()).toHaveLength(polled);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it("ends a poll the printer never answers when the poll bound passes", async () => {
    const printer = await fakePrinter((req, res) => res.end(accepted(req)));
    const started = Date.now();
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, { ...quick, pollLimitMs: 150 }),
    ).toEqual(timedOut);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(printer.polls()).toHaveLength(1);
  });

  it("bounds polling to 120 seconds by default", async () => {
    expect(IPP_POLL_LIMIT_MS).toBe(120_000);
    const printer = await fakePrinter((req, res) => res.end(accepted(req)));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let outcome: IppPrintOutcome | undefined;
    void printOverIpp(target(printer.port), DOCUMENT).then((o) => (outcome = o));
    await until(() => printer.polls().length === 1);
    await vi.advanceTimersByTimeAsync(119_999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await until(() => outcome !== undefined);
    expect(outcome).toEqual(timedOut);
    expect(printer.printJobs()).toHaveLength(1);
  });
});

describe("printOverIpp — a job the printer is holding", () => {
  const PENDING_HELD = 4;
  const PROCESSING_STOPPED = 6;
  /** What the owner's HP answered with an empty tray (questions.md, 2026-10-12 ~17:10). */
  const HP_EMPTY_TRAY = ["media-empty-error", "media-needed"];
  const heldJob = (req: Received) => jobState(req, PROCESSING_STOPPED, ["printer-stopped"]);
  const emptyTray = (req: Received) => printerState(req, PRINTER_STOPPED, HP_EMPTY_TRAY);
  const stoppedForPaper: Answer = (req, res) => res.end(emptyTray(req));
  /** A short bound, and held polls as quick as the others. */
  const holding: IppPrintOptions = { ...quick, pollLimitMs: 200, heldPollIntervalMs: 5 };
  const since = (started: number) => Date.now() - started;

  it("follows the HP's empty-tray job past the bound, reports paper_out once, and answers sent once paper goes in", async () => {
    const holds: Array<PageHold | null> = [];
    const started = Date.now();
    const paperIn = () => since(started) > 500;
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req, 922, PROCESSING)),
      (req, res) => {
        if (!paperIn()) return void res.end(heldJob(req));
        res.end(jobState(req, holds.at(-1) === null ? COMPLETED : PROCESSING, ["job-printing"]));
      },
      (req, res) =>
        res.end(paperIn() ? printerState(req, PRINTER_PROCESSING, ["none"]) : emptyTray(req)),
    );
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      onHold: (hold) => holds.push(hold),
    });

    expect(outcome).toEqual(sent);
    expect(holds).toEqual(["paper_out", null]);
    expect(since(started)).toBeGreaterThan(500);
    expect(printer.printJobs()).toHaveLength(1);
    const [query] = printer.printerQueries();
    expect(query!.url).toBe("/ipp/print");
    expect(query!.data).toHaveLength(0);
    expect(text(query!.attrs, "printer-uri")).toEqual([
      `ipp://127.0.0.1:${printer.port}/ipp/print`,
    ]);
    expect(text(query!.attrs, "requested-attributes")).toEqual([
      "printer-state",
      "printer-state-reasons",
    ]);
    expect(new Set(printer.requests.map((r) => r.requestId)).size).toBe(printer.requests.length);
  });

  it("carries on, and still answers, when the onHold callback throws", async () => {
    const holds: Array<PageHold | null> = [];
    let polls = 0;
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => {
        polls++;
        res.end(polls < 3 ? heldJob(req) : jobState(req, polls < 5 ? PROCESSING : COMPLETED));
      },
      (req, res) =>
        res.end(
          printer.printerQueries().length < 3
            ? emptyTray(req)
            : printerState(req, PRINTER_PROCESSING, ["none"]),
        ),
    );
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      onHold: (hold) => {
        holds.push(hold);
        throw new Error("the caller's own failure");
      },
    });
    expect(outcome).toEqual(sent);
    expect(holds).toEqual(["paper_out", null]);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it.each([
    ["pending-held", PENDING_HELD, []],
    ["processing-stopped", PROCESSING_STOPPED, []],
    ["processing, with the reason printer-stopped", PROCESSING, ["printer-stopped"]],
  ])(
    "asks the printer about a %s job long before the bound, and holds it",
    async (_label, state, reasons) => {
      const holds: Array<PageHold | null> = [];
      const printer = await fakePrinter(
        (req, res) => res.end(accepted(req)),
        (req, res) => res.end(jobState(req, holds.length > 0 ? COMPLETED : state, reasons)),
        stoppedForPaper,
      );
      const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
        ...holding,
        pollLimitMs: IPP_POLL_REQUEST_TIMEOUT_MS + 5000,
        onHold: (hold) => holds.push(hold),
      });
      expect(outcome).toEqual(sent);
      expect(holds).toEqual(["paper_out"]);
      expect(printer.printerQueries()).toHaveLength(1);
      expect(printer.printJobs()).toHaveLength(1);
    },
  );

  it("reports each change of reason while held, and only a change", async () => {
    const holds: Array<PageHold | null> = [];
    const answers = [
      ["media-empty-error"],
      ["media-needed"],
      ["media-jam-error"],
      ["media-jam-error", "media-needed"],
    ];
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) =>
        res.end(
          printer.printerQueries().length > answers.length
            ? jobState(req, COMPLETED)
            : heldJob(req),
        ),
      (req, res) => {
        const reasons = answers[printer.printerQueries().length - 1];
        res.end(
          reasons === undefined
            ? printerState(req, PRINTER_PROCESSING)
            : printerState(req, PRINTER_STOPPED, reasons),
        );
      },
    );
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      onHold: (hold) => holds.push(hold),
    });
    expect(outcome).toEqual(sent);
    expect(holds).toEqual(["paper_out", "paper_jam", null]);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it("keeps asking while it holds a printing job, and reports null when the printer lets it go", async () => {
    const holds: Array<PageHold | null> = [];
    const started = Date.now();
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => {
        if (since(started) > 500) return void res.end(jobState(req, COMPLETED));
        res.end(printer.printerQueries().length < 2 ? heldJob(req) : jobState(req, PROCESSING));
      },
      (req, res) =>
        res.end(
          printer.printerQueries().length <= 2
            ? emptyTray(req)
            : printerState(req, PRINTER_PROCESSING, ["none"]),
        ),
    );
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      pollLimitMs: IPP_POLL_REQUEST_TIMEOUT_MS + 5000,
      onHold: (hold) => holds.push(hold),
    });
    expect(outcome).toEqual(sent);
    expect(holds).toEqual(["paper_out", null]);
    expect(printer.printerQueries()).toHaveLength(3);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it("answers unknown/timeout at once when the printer forgets a job it was holding", async () => {
    const holds: Array<PageHold | null> = [];
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) =>
        res.end(printer.polls().length > 3 ? ippReply(0x0406, req.requestId) : heldJob(req)),
      stoppedForPaper,
    );
    const started = Date.now();
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      pollLimitMs: 5000,
      onHold: (hold) => holds.push(hold),
    });
    expect(outcome).toEqual(timedOut);
    expect(since(started)).toBeLessThan(1000);
    expect(holds).toEqual(["paper_out"]);
    expect(printer.polls()).toHaveLength(4);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it.each([
    ["every request fails", true],
    ["only the printer's own answer fails", false],
  ])(
    "answers unknown/timeout one bound after the last held answer when %s",
    async (_label, jobPollsFail) => {
      const holds: Array<PageHold | null> = [];
      let lastHeld = 0;
      const printer = await fakePrinter(
        (req, res) => res.end(accepted(req)),
        (req, res, raw) => {
          if (jobPollsFail && printer.printerQueries().length > 0) return void raw.socket.destroy();
          res.end(heldJob(req));
        },
        (req, res, raw) => {
          if (printer.printerQueries().length > 1) return void raw.socket.destroy();
          lastHeld = Date.now();
          res.end(emptyTray(req));
        },
      );
      const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
        ...holding,
        onHold: (hold) => holds.push(hold),
      });
      expect(outcome).toEqual(timedOut);
      expect(since(lastHeld)).toBeGreaterThanOrEqual(190);
      expect(since(lastHeld)).toBeLessThan(1000);
      expect(holds).toEqual(["paper_out"]);
      expect(printer.polls().length).toBeGreaterThan(2);
      expect(printer.printJobs()).toHaveLength(1);
    },
  );

  it("keeps following a held job through a silence shorter than the bound", async () => {
    const holds: Array<PageHold | null> = [];
    const started = Date.now();
    const silent = () => since(started) > 50 && since(started) < 200;
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res, raw) => {
        if (silent()) return void raw.socket.destroy();
        res.end(since(started) > 400 ? jobState(req, COMPLETED) : heldJob(req));
      },
      (req, res, raw) => (silent() ? raw.socket.destroy() : res.end(emptyTray(req))),
    );
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      pollLimitMs: 300,
      onHold: (hold) => holds.push(hold),
    });
    expect(outcome).toEqual(sent);
    expect(since(started)).toBeGreaterThan(400);
    expect(holds).toEqual(["paper_out"]);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it.each([
    ["is printing", (req: Received) => printerState(req, PRINTER_PROCESSING, ["none"])],
    ["names no state", (req: Received) => printerState(req, undefined, ["media-empty-error"])],
    ["refuses the question", (req: Received) => ippReply(0x0400, req.requestId)],
  ])(
    "ends a processing-stopped job at the bound, as before, when the printer %s",
    async (_label, answer) => {
      const holds: Array<PageHold | null> = [];
      const printer = await fakePrinter(
        (req, res) => res.end(accepted(req)),
        (req, res) => res.end(heldJob(req)),
        (req, res) => res.end(answer(req)),
      );
      const started = Date.now();
      const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
        ...holding,
        onHold: (hold) => holds.push(hold),
      });
      expect(outcome).toEqual(timedOut);
      expect(since(started)).toBeGreaterThanOrEqual(190);
      expect(since(started)).toBeLessThan(1000);
      expect(holds).toEqual([]);
      expect(printer.printerQueries().length).toBeGreaterThan(1);
      expect(printer.printJobs()).toHaveLength(1);
    },
  );

  it("asks about a printing job only near the bound, and holds it when the printer is stopped", async () => {
    const holds: Array<PageHold | null> = [];
    const asked: number[] = [];
    const started = Date.now();
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) =>
        res.end(jobState(req, since(started) > 700 ? COMPLETED : PROCESSING, ["job-printing"])),
      (req, res) => {
        asked.push(since(started));
        res.end(printerState(req, PRINTER_STOPPED, ["media-jam-error"]));
      },
    );
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      pollLimitMs: IPP_POLL_REQUEST_TIMEOUT_MS + 300,
      onHold: (hold) => holds.push(hold),
    });
    expect(outcome).toEqual(sent);
    expect(holds).toEqual(["paper_jam"]);
    expect(asked[0]).toBeGreaterThanOrEqual(250);
    expect(
      printer.polls().filter((p) => p.requestId < printer.printerQueries()[0]!.requestId).length,
    ).toBeGreaterThan(5);
    expect(printer.printJobs()).toHaveLength(1);
  });

  const KEYWORDS: Array<[string, PageHold]> = [
    ["media-jam", "paper_jam"],
    ["cover-open", "cover_open"],
    ["door-open", "cover_open"],
    ["interlock-open", "cover_open"],
    ["media-empty", "paper_out"],
    ["media-needed", "paper_out"],
    ["input-tray-missing", "tray_missing"],
    ["marker-supply-empty", "ink_or_toner_out"],
    ["toner-empty", "ink_or_toner_out"],
    ["output-area-full", "output_full"],
    ["output-tray-missing", "output_full"],
    ["paused", "paused"],
    ["moving-to-paused", "paused"],
  ];
  it.each<[string, PageHold]>([
    ...KEYWORDS.flatMap(([keyword, hold]): Array<[string, PageHold]> => [
      [keyword, hold],
      [`${keyword}-error`, hold],
      [`${keyword}-warning`, "stopped"],
      [`${keyword}-report`, "stopped"],
    ]),
    ["", "stopped"],
    ["none", "stopped"],
    ["spool-area-full-error", "stopped"],
    ["media-needed,media-jam-error", "paper_jam"],
    ["paused,door-open", "cover_open"],
    ["toner-empty-warning,media-empty-report,marker-supply-empty", "ink_or_toner_out"],
  ])("holds a stopped printer's job with reasons [%s] as %s", async (reasons, expected) => {
    const holds: Array<PageHold | null> = [];
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(holds.length > 0 ? jobState(req, COMPLETED) : heldJob(req)),
      (req, res) =>
        res.end(printerState(req, PRINTER_STOPPED, reasons === "" ? [] : reasons.split(","))),
    );
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      onHold: (hold) => holds.push(hold),
    });
    expect(outcome).toEqual(sent);
    expect(holds).toEqual([expected]);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it("stops following a held job at once when the signal aborts", async () => {
    const controller = new AbortController();
    const holds: Array<PageHold | null> = [];
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(heldJob(req)),
      (req, res) => {
        if (printer.printerQueries().length === 3) controller.abort();
        res.end(emptyTray(req));
      },
    );
    const started = Date.now();
    const outcome = await printOverIpp(target(printer.port), DOCUMENT, {
      ...holding,
      pollLimitMs: 5000,
      signal: controller.signal,
      onHold: (hold) => holds.push(hold),
    });
    expect(outcome).toEqual(timedOut);
    expect(since(started)).toBeLessThan(1000);
    expect(holds).toEqual(["paper_out"]);
    const asked = printer.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(printer.requests).toHaveLength(asked);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it("polls a held job 10 seconds apart by default", async () => {
    const controller = new AbortController();
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(heldJob(req)),
      stoppedForPaper,
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let outcome: IppPrintOutcome | undefined;
    const holds: Array<PageHold | null> = [];
    void printOverIpp(target(printer.port), DOCUMENT, {
      signal: controller.signal,
      onHold: (hold) => holds.push(hold),
    }).then((o) => (outcome = o));
    await until(() => holds.length === 1);
    await vi.advanceTimersByTimeAsync(9_999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(printer.polls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => printer.polls().length === 2);
    controller.abort();
    await until(() => outcome !== undefined);
    expect(outcome).toEqual(timedOut);
    expect(printer.printJobs()).toHaveLength(1);
  });
});

describe("printOverIpp — the abort signal", () => {
  it("stops polling at once and answers unknown/timeout", async () => {
    const controller = new AbortController();
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => {
        if (printer.polls().length === 2) controller.abort();
        res.end(jobState(req, PROCESSING));
      },
    );
    const started = Date.now();
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, {
        ...quick,
        pollLimitMs: 5000,
        pollIntervalMs: 20,
        signal: controller.signal,
      }),
    ).toEqual(timedOut);
    expect(Date.now() - started).toBeLessThan(1000);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(printer.polls()).toHaveLength(2);
    expect(printer.printJobs()).toHaveLength(1);
  });

  it("ends a poll in flight when the signal aborts", async () => {
    const controller = new AbortController();
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      () => controller.abort(),
    );
    const started = Date.now();
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, {
        ...quick,
        pollLimitMs: 5000,
        signal: controller.signal,
      }),
    ).toEqual(timedOut);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(printer.polls()).toHaveLength(1);
  });

  it("sends nothing when the signal aborted before submission, and answers unknown/timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const printer = await fakePrinter(
      (req, res) => res.end(accepted(req)),
      (req, res) => res.end(jobState(req, COMPLETED)),
    );
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, { ...quick, signal: controller.signal }),
    ).toEqual(timedOut);
    expect(printer.requests).toHaveLength(0);
  });

  it("does not cut a submission short: an abort while the printer reads the job ends only the polling", async () => {
    const controller = new AbortController();
    const printer = await fakePrinter(
      (req, res) => {
        controller.abort();
        setTimeout(() => res.end(accepted(req)), 20);
      },
      (req, res) => res.end(jobState(req, COMPLETED)),
    );
    expect(
      await printOverIpp(target(printer.port), DOCUMENT, { ...quick, signal: controller.signal }),
    ).toEqual(timedOut);
    expect(printer.printJobs()).toHaveLength(1);
    expect(printer.polls()).toHaveLength(0);
  });
});

describe("exchangeIpp", () => {
  /** A request with a header and no attributes, enough for the fake printer to read. */
  const EMPTY_REQUEST = Buffer.from([2, 0, 0, 9, 0, 0, 0, 1, 3]);

  it("answers unreachable when its deadline passes before the connection opens", async () => {
    stalled.on = true;
    expect(await exchangeIpp("127.0.0.1", 631, "/ipp/print", EMPTY_REQUEST, 50)).toEqual({
      kind: "unreachable",
    });
  });

  it("answers no_answer when its deadline passes after the connection opened", async () => {
    const printer = await fakePrinter(() => {});
    expect(await exchangeIpp("127.0.0.1", printer.port, "/ipp/print", EMPTY_REQUEST, 50)).toEqual({
      kind: "no_answer",
    });
    expect(printer.arrived()).toBe(1);
  });

  it("sends nothing for a signal that has already aborted", async () => {
    const printer = await fakePrinter((req, res) => res.end(accepted(req)));
    const controller = new AbortController();
    controller.abort();
    expect(
      await exchangeIpp(
        "127.0.0.1",
        printer.port,
        "/ipp/print",
        EMPTY_REQUEST,
        1000,
        controller.signal,
      ),
    ).toEqual({ kind: "unreachable" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.arrived()).toBe(0);
  });
});
