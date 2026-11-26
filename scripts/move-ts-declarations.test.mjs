import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./move-ts-declarations.mjs";

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "move-ts-declarations-"));
  writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"module":"NodeNext"}}');
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
});

afterEach(() => {
  rmSync(root, { recursive: true });
});

function write(file, text) {
  writeFileSync(join(root, file), text);
}

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

async function move(source, targets, keep = [], lift) {
  write(
    "moves.json",
    JSON.stringify({ tsconfig: "tsconfig.json", moves: [{ source, targets, keep, lift }] }),
  );
  return main(["moves.json"], root);
}

describe("move-ts-declarations", () => {
  describe("client classes", () => {
    const editedMethod = [
      "  readTicket(): Ticket {",
      '    return this.#request<Ticket>("/ticket/branch-edit");',
      "  }",
    ].join("\n");
    const client = [
      'import type { Request } from "./request.js";',
      "export interface Ticket {",
      "  amount: number;",
      "}",
      "export class Api {",
      "  readonly #request: Request;",
      "  constructor(request: Request) {",
      "    this.#request = request;",
      "  }",
      editedMethod,
      "}",
      "",
    ].join("\n");

    beforeEach(() => {
      write("request.ts", "export type Request = <T>(url: string) => T;\n");
      write("client.ts", client);
    });

    async function moveClient(methods, otherKept = [], classOptions = {}) {
      write(
        "moves.json",
        JSON.stringify({
          tsconfig: "tsconfig.json",
          moves: [
            {
              source: "client.ts",
              keep: ["Api"],
              targets: { "tickets.ts": ["Ticket", "TicketApi"] },
              classLift: {
                name: "Api",
                request: "Request",
                keep: ["#request", "constructor", ...otherKept],
                groups: { TicketApi: methods },
                ...classOptions,
              },
            },
          ],
        }),
      );
      await main(["moves.json"], root);
    }

    it("preserves a branch-edited member and redirects an inline type import", async () => {
      write(
        "receipt-types.d.ts",
        'declare module "receipt-types" { export type Currency = string; }\n',
      );
      const external = 'export type Currency = import("receipt-types").Currency;\n';
      write("consumer.ts", 'export type Bill = import("./client.js").Ticket;\n' + external);

      await moveClient(["readTicket"]);

      expect(read("tickets.ts")).toContain(editedMethod);
      expect(read("consumer.ts")).toBe(
        'export type Bill = import("./tickets.js").Ticket;\n' + external,
      );
      expect(read("client.ts")).toContain("export class Api extends TicketApi");
      expect(read("client.ts")).not.toContain("readTicket");
      const program = ts.createProgram(
        ["client.ts", "consumer.ts", "receipt-types.d.ts"].map((file) => join(root, file)),
        {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.NodeNext,
        },
      );
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, "\n")),
      ).toEqual([]);
    });

    it("preserves the original source of an aliased package type re-export", async () => {
      write("request.ts", read("request.ts") + "export type TicketAmount = number;\n");
      write(
        "client.ts",
        'import type { TicketAmount as Amount } from "./request.js";\n' +
          "export type { Amount };\n" +
          'export type { Request } from "./request.js";\n' +
          client.replace("amount: number;", "amount: Amount;"),
      );

      await moveClient(["readTicket"]);

      expect(read("client.ts")).toContain(
        'export type { TicketAmount as Amount } from "./request.js";',
      );
      expect(read("client.ts")).toContain('export type { Request } from "./request.js";');
      expect(read("tickets.ts")).toContain("amount: Amount;");
    });

    it("removes an import used only by a package type re-export", async () => {
      write("request.ts", read("request.ts") + "export type TicketAmount = number;\n");
      write(
        "client.ts",
        'import type { TicketAmount } from "./request.js";\n' +
          "export type { TicketAmount };\n" +
          client,
      );

      await moveClient(["readTicket"]);

      expect(read("client.ts")).toContain('export type { TicketAmount } from "./request.js";');
      expect(read("client.ts")).not.toContain("import type { TicketAmount }");
    });

    it("uses a type-only import when the retained client uses a moved type", async () => {
      write(
        "tsconfig.json",
        '{"compilerOptions":{"module":"NodeNext","verbatimModuleSyntax":true}}',
      );
      write(
        "client.ts",
        client.replace(
          editedMethod,
          editedMethod + "\n  emptyTicket(): Ticket {\n    return { amount: 0 };\n  }",
        ),
      );

      await moveClient(["readTicket"], ["emptyTicket"]);

      expect(read("client.ts")).toContain('import { TicketApi, type Ticket } from "./tickets.js";');
    });

    it("refuses a type import that closes a cycle through the client", async () => {
      const cyclic = client.replace("amount: number", "api: Api");
      write("client.ts", cyclic);

      await expect(moveClient(["readTicket"])).rejects.toThrow(/client import cycle/);

      expect(read("client.ts")).toBe(cyclic);
      expect(() => read("tickets.ts")).toThrow(/ENOENT/);
    });

    it("refuses a runtime import cycle through a helper outside the split", async () => {
      const source =
        'import { validate } from "./helper.js";\n' +
        client.replace(
          'return this.#request<Ticket>("/ticket/branch-edit");',
          'return validate(this.#request<Ticket>("/ticket/branch-edit"));',
        );
      write("client.ts", source);
      write(
        "helper.ts",
        'import { Api } from "./client.js";\n' +
          "export function validate<T>(value: T): T {\n" +
          '  if (value instanceof Api) throw new TypeError("Expected a ticket.");\n' +
          "  return value;\n}\n",
      );

      await expect(moveClient(["readTicket"])).rejects.toThrow(/client import cycle/);

      expect(read("client.ts")).toBe(source);
      expect(() => read("tickets.ts")).toThrow(/ENOENT/);
    });

    it("keeps the same request through both area constructors", async () => {
      write(
        "tsconfig.json",
        '{"compilerOptions":{"module":"NodeNext","verbatimModuleSyntax":true}}',
      );
      const retained = ["  makeBlankTicket(): Ticket {", "    return { amount: 0 };", "  }"].join(
        "\n",
      );
      const second = [
        "  readTotal(): number {",
        '    return this.#request<number>("/total", true);',
        "  }",
      ].join("\n");
      write("request.ts", "export type Request = <T>(url: string, passive?: boolean) => T;\n");
      write("receipt-setup.ts", "(globalThis as Record<string, unknown>).ticketSetup = 11;\n");
      write(
        "client.ts",
        'import "./receipt-setup.js";\n' +
          client
            .replace("amount: number;", "amount: number;\n  api?: Api;")
            .replace(editedMethod, [editedMethod, second, retained].join("\n")),
      );
      write(
        "moves.json",
        JSON.stringify({
          tsconfig: "tsconfig.json",
          moves: [
            {
              source: "client.ts",
              keep: ["Api"],
              targets: { "tickets.ts": ["Ticket", "TicketApi"], "totals.ts": ["TotalApi"] },
              classLift: {
                name: "Api",
                request: "Request",
                keep: ["#request", "constructor", "makeBlankTicket"],
                groups: { TicketApi: ["readTicket"], TotalApi: ["readTotal"] },
                allowClientTypeFrom: "tickets.ts",
              },
            },
          ],
        }),
      );

      await main(["moves.json"], root);

      const program = ts.createProgram([join(root, "client.ts")], {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        noEmitOnError: true,
        verbatimModuleSyntax: true,
      });
      expect(program.emit().emitSkipped).toBe(false);
      const run = [
        'import { Api } from "./client.js";',
        "const calls = [];",
        "const api = new Api((...args) => {",
        "  calls.push(args);",
        "  return args[1] ? 7 : { amount: 12 };",
        "});",
        "console.log(JSON.stringify([api.readTicket(), api.readTotal(), api.makeBlankTicket(), globalThis.ticketSetup, calls]));",
      ].join("\n");
      const result = execFileSync(process.execPath, ["--input-type=module", "-e", run], {
        cwd: root,
        encoding: "utf8",
      });
      expect(JSON.parse(result)).toEqual([
        { amount: 12 },
        7,
        { amount: 0 },
        11,
        [["/ticket/branch-edit"], ["/total", true]],
      ]);
    });

    it("refuses formatting that changes a moved method body", async () => {
      const source = client.replace("return this.", "return  this.");
      write("client.ts", source);

      await expect(moveClient(["readTicket"])).rejects.toThrow(
        /changed a method signature or body/,
      );

      expect(read("client.ts")).toBe(source);
      expect(() => read("tickets.ts")).toThrow(/ENOENT/);
    });

    it.each([
      {
        methods: ["readTicket", "readReceipt"],
        options: {},
        reason: /missing client member readReceipt/,
      },
      { methods: ["readTicket", "readTicket"], options: {}, reason: /duplicate client member/ },
      {
        methods: ["readTicket", "constructor"],
        options: { keep: ["#request"] },
        reason: /keep the client constructor/,
      },
      {
        methods: ["readTicket"],
        options: { name: "ReceiptApi" },
        reason: /expected a client class named ReceiptApi/,
      },
    ])("refuses a stale client map with $reason", async ({ methods, options, reason }) => {
      await expect(moveClient(methods, [], options)).rejects.toThrow(reason);

      expect(read("client.ts")).toBe(client);
      expect(() => read("tickets.ts")).toThrow(/ENOENT/);
    });

    it("refuses an unassigned client member before changing any files", async () => {
      await expect(moveClient([])).rejects.toThrow(/unmapped client member readTicket/);

      expect(read("client.ts")).toBe(client);
      expect(() => read("tickets.ts")).toThrow(/ENOENT/);
    });
  });

  const route = [
    "  // Keep the branch's callback and comment together.",
    '  app.post("/start", () => throttle.claim("branch edit"));',
  ].join("\n");
  const mount = [
    'import type { Router, Throttle } from "./router.js";',
    "",
    "export function mount(app: Router, throttle: Throttle, otherThrottle: Throttle) {",
    '  app.get("/before", () => otherThrottle.claim("before"));',
    "",
    route,
    "",
    '  app.get("/after", () => otherThrottle.claim("after"));',
    "}\n",
  ].join("\n");
  const lift = {
    mount: "mount",
    groups: {
      mountStart: {
        first: "post /start",
        last: "post /start",
        parameters: { app: "Router", throttle: "Throttle" },
      },
    },
  };

  it("lifts an edited route callback and passes the original shared throttle in order", async () => {
    write("original.ts", mount);
    write(
      "router.ts",
      [
        "export interface Throttle { claim(value: string): string }",
        "export interface Router {",
        "  get(path: string, handler: () => string): void;",
        "  post(path: string, handler: () => string): void;",
        "}\n",
      ].join("\n"),
    );

    await move("original.ts", { "start.ts": ["mountStart"] }, ["mount"], lift);

    expect(read("start.ts")).toContain(`{\n${route}\n}`);
    expect(read("original.ts")).toContain(
      [
        '  app.get("/before", () => otherThrottle.claim("before"));',
        "",
        "  mountStart(app, throttle);",
        "",
        '  app.get("/after", () => otherThrottle.claim("after"));',
      ].join("\n"),
    );
  });

  it("keeps a moved route type out of the mount's runtime imports", async () => {
    const compilerOptions = {
      module: "ESNext",
      moduleResolution: "Bundler",
      verbatimModuleSyntax: true,
    };
    write("tsconfig.json", JSON.stringify({ compilerOptions }));
    write(
      "original.ts",
      [
        "interface Options {",
        "  label: string;",
        "}",
        "",
        "interface Router {",
        "  post(path: string, handler: () => string): void;",
        "}",
        "",
        "function readLabel(options: Options) {",
        "  return options.label;",
        "}",
        "",
        "export function mount(app: Router, options: Options) {",
        '  app.post("/start", () => readLabel(options));',
        "}",
      ].join("\n"),
    );
    const withOptions = {
      mount: "mount",
      groups: {
        mountStart: {
          first: "post /start",
          last: "post /start",
          parameters: { app: "Router", options: "Options" },
        },
      },
    };

    await move(
      "original.ts",
      { "options.ts": ["Options", "Router", "readLabel"], "start.ts": ["mountStart"] },
      ["mount"],
      withOptions,
    );

    const program = ts.createProgram(
      [join(root, "original.ts")],
      ts.convertCompilerOptionsFromJson(compilerOptions, root).options,
    );
    const problems = ts
      .getPreEmitDiagnostics(program)
      .map(
        ({ code, messageText }) => `${code}: ${ts.flattenDiagnosticMessageText(messageText, "\n")}`,
      );
    expect(problems).toEqual([]);
  });

  it.each([
    ["missing", mount, "post /missing", /route anchor post \/missing, found 0/i],
    ["ambiguous", mount.replace(route, `${route}\n\n${route}`), "post /start", /found 2/i],
  ])("refuses a route anchor when it is %s", async (_reason, source, last, error) => {
    write("original.ts", source);
    const badLift = {
      ...lift,
      groups: { mountStart: { ...lift.groups.mountStart, last } },
    };

    await expect(
      move("original.ts", { "start.ts": ["mountStart"] }, ["mount"], badLift),
    ).rejects.toThrow(error);
    expect(read("original.ts")).toBe(source);
    expect(() => read("start.ts")).toThrow(/ENOENT/);
  });

  it("refuses formatting that would change a lifted callback", async () => {
    const source = mount.replace('claim("branch edit")', 'claim(  "branch edit")');
    write("original.ts", source);

    await expect(
      move("original.ts", { "start.ts": ["mountStart"] }, ["mount"], lift),
    ).rejects.toThrow(/mountStart.*changed body/i);
    expect(read("original.ts")).toBe(source);
    expect(() => read("start.ts")).toThrow(/ENOENT/);
  });

  it("keeps a shared closure in the mount before passing it to lifted routes", async () => {
    const closure = '  const read = () => throttle.claim("shared");';
    const finish = '  app.post("/finish", () => read());';
    const source = mount.replace(route, [route, closure, finish].join("\n\n"));
    write("original.ts", source);
    const withClosure = {
      ...lift,
      groups: {
        mountStart: {
          ...lift.groups.mountStart,
          last: "post /finish",
          parameters: { ...lift.groups.mountStart.parameters, read: "() => string" },
          hoist: "read",
        },
      },
    };

    await move("original.ts", { "start.ts": ["mountStart"] }, ["mount"], withClosure);

    expect(read("start.ts")).toContain(`{\n${route}\n\n${finish}\n}`);
    expect(read("original.ts")).toContain(`${closure}\n\n  mountStart(app, throttle, read);`);
  });

  it("lifts a named local and its route while keeping earlier routes in order", async () => {
    const local = '  const claim = () => throttle.claim("chosen at mount");';
    const start = '  app.post("/start", claim);';
    write("original.ts", mount.replace(route, [local, start].join("\n")));
    const withLocal = {
      ...lift,
      groups: {
        mountStart: { ...lift.groups.mountStart, first: "local claim" },
      },
    };

    await move("original.ts", { "start.ts": ["mountStart"] }, ["mount"], withLocal);

    expect(read("start.ts")).toContain(`{\n${local}\n${start}\n}`);
    expect(read("original.ts")).toContain(
      [
        '  app.get("/before", () => otherThrottle.claim("before"));',
        "",
        "  mountStart(app, throttle);",
        "",
        '  app.get("/after", () => otherThrottle.claim("after"));',
      ].join("\n"),
    );
  });

  it("refuses a range whose end route comes before its start", async () => {
    write("original.ts", mount);
    const reversed = {
      ...lift,
      groups: { mountStart: { ...lift.groups.mountStart, last: "get /before" } },
    };

    await expect(
      move("original.ts", { "start.ts": ["mountStart"] }, ["mount"], reversed),
    ).rejects.toThrow(/out-of-order.*mountStart/i);
    expect(read("original.ts")).toBe(mount);
    expect(() => read("start.ts")).toThrow(/ENOENT/);
  });

  it("takes a moved function's alias, body and comment to their new homes", async () => {
    const declaration = [
      "// The order in this tuple is part of the return value.",
      "export function parts(total: number) {",
      "  return [total, total + 1] as const;",
      "}",
    ].join("\n");
    write("original.ts", `${declaration}\n\nexport const stay = 2;\n`);
    write(
      "consumer.ts",
      'import { parts as split, stay } from "./original.js";\n\nexport const value = split(stay);\n',
    );

    await move("original.ts", { "parts.ts": ["parts"] }, ["stay"]);

    expect(read("parts.ts")).toBe(`${declaration}\n`);
    expect(read("original.ts")).toBe("export const stay = 2;\n");
    expect(read("consumer.ts")).toBe(
      'import { stay } from "./original.js";\nimport { parts as split } from "./parts.js";\n\nexport const value = split(stay);\n',
    );
  });

  it("uses the branch's named destination for a declaration added between existing ones", async () => {
    write(
      "original.ts",
      "export function read() {\n  return branchAmount;\n}\n\nconst branchAmount = 75;\n\nexport const keepHere = 1;\n",
    );
    write(
      "consumer.ts",
      'export { read as renamed, keepHere as retained } from "./original.js";\n',
    );

    await move("original.ts", { "reading.ts": ["read"], "branch.ts": ["branchAmount"] }, [
      "keepHere",
    ]);

    expect(read("original.ts")).toBe("export const keepHere = 1;\n");
    expect(read("reading.ts")).toBe(
      'import { branchAmount } from "./branch.js";\n\nexport function read() {\n  return branchAmount;\n}\n',
    );
    expect(read("branch.ts")).toBe("export const branchAmount = 75;\n");
    expect(read("consumer.ts")).toBe(
      'export { keepHere as retained } from "./original.js";\nexport { read as renamed } from "./reading.js";\n',
    );
  });

  it("keeps a titled test block byte for byte while importing its fixture", async () => {
    const block =
      'describe("receipts", () => {\n  it("prints the amount", () => {\n    expect(amount).toBe(75);\n  });\n});';
    write("original.test.ts", `const amount = 75;\n\n${block}\n`);

    await move("original.test.ts", { "receipt.test.ts": ["describe:receipts"] }, ["amount"]);

    expect(read("receipt.test.ts")).toBe(
      `import { amount } from "./original.test.js";\n\n${block}\n`,
    );
    expect(read("original.test.ts")).toBe("export const amount = 75;\n");
  });

  it.each([
    ["a missing declaration", ["absent"], ["read"], /missing.*absent/i],
    ["an unmapped declaration", ["read"], [], /unmapped.*amount/i],
  ])("refuses %s before changing any file", async (_label, names, keep, error) => {
    const source = "export function read() {\n  return amount;\n}\n\nconst amount = 75;\n";
    write("original.ts", source);

    await expect(move("original.ts", { "reading.ts": names }, keep)).rejects.toThrow(error);

    expect(read("original.ts")).toBe(source);
    expect(() => read("reading.ts")).toThrow(/ENOENT/);
  });

  it("refuses formatting that would change a moved body and leaves the files alone", async () => {
    const source = "export function pounds() { return 7 }\n";
    write("original.ts", source);

    await expect(move("original.ts", { "pounds.ts": ["pounds"] })).rejects.toThrow(/pounds.*body/i);
    expect(read("original.ts")).toBe(source);
    expect(() => read("pounds.ts")).toThrow(/ENOENT/);
  });

  it("allows Prettier to wrap a signature after TypeScript adds export", async () => {
    const declaration = [
      "// A long parameter list exercises signature formatting when the function becomes public.",
      "function charge(firstAmount: number, secondAmount: number, thirdAmount: number, fourthAmount: number) {",
      "  return firstAmount + secondAmount + thirdAmount + fourthAmount;",
      "}",
    ].join("\n");
    write("original.ts", `${declaration}\n\nexport const total = charge(1, 2, 3, 4);\n`);

    await move("original.ts", { "charge.ts": ["charge"] }, ["total"]);

    expect(read("charge.ts")).toBe(
      [
        "// A long parameter list exercises signature formatting when the function becomes public.",
        "export function charge(",
        "  firstAmount: number,",
        "  secondAmount: number,",
        "  thirdAmount: number,",
        "  fourthAmount: number,",
        ") {",
        "  return firstAmount + secondAmount + thirdAmount + fourthAmount;",
        "}\n",
      ].join("\n"),
    );
  });

  it("keeps an inline object type when adding export wraps its members", async () => {
    write(".prettierrc.json", '{"printWidth":100,"trailingComma":"all"}');
    const body = "{\n  return group.displayNumber;\n}";
    write(
      "original.ts",
      `function groupNumberIdentity(group: { displayNumber: number; numberPartyId: string | null }): number ${body}\n\nexport const number = groupNumberIdentity({ displayNumber: 7, numberPartyId: null });\n`,
    );

    await move("original.ts", { "numbers.ts": ["groupNumberIdentity"] }, ["number"]);

    expect(read("numbers.ts")).toBe(
      `export function groupNumberIdentity(group: {\n  displayNumber: number;\n  numberPartyId: string | null;\n}): number ${body}\n`,
    );
  });

  it("refuses a signature change outside the trailing type-literal delimiter exception", async () => {
    write(".prettierrc.json", '{"printWidth":100,"trailingComma":"all"}');
    const source =
      'type CourseCaptionCopies = { [K in "starters course" | "mains course" | "dessert course"]: string };\n\nexport const captions: CourseCaptionCopies | undefined = undefined;\n';
    write("original.ts", source);

    await expect(
      move("original.ts", { "captions.ts": ["CourseCaptionCopies"] }, ["captions"]),
    ).rejects.toThrow(/CourseCaptionCopies changed signature or comments/);
    expect(read("original.ts")).toBe(source);
    expect(() => read("captions.ts")).toThrow(/ENOENT/);
  });

  it("drops an intermediate import when two declarations move to the same destination", async () => {
    write(
      "original.ts",
      "const base = 7;\n\nexport const stay = 4;\n\nexport function total() {\n  return base + 20;\n}\n",
    );
    write(
      "consumer.ts",
      'import { total } from "./original.js";\n\nexport const charge = total();\n',
    );

    await move("original.ts", { "amounts.ts": ["total", "base"] }, ["stay"]);

    expect(read("amounts.ts")).toBe(
      "const base = 7;\n\nexport function total() {\n  return base + 20;\n}\n",
    );
    expect(read("consumer.ts")).toContain('import { total } from "./amounts.js";');
  });

  it("checks the implementation body when moving overloads", async () => {
    const source = [
      "export function read(value: string): string;",
      "export function read(value: number): number;",
      "export function read(value: string | number) { return value }\n",
    ].join("\n");
    write("original.ts", source);

    await expect(move("original.ts", { "reading.ts": ["read"] })).rejects.toThrow(/read.*body/i);
    expect(read("original.ts")).toBe(source);
    expect(() => read("reading.ts")).toThrow(/ENOENT/);
  });

  it("moves related declarations together even when another declaration separates them", async () => {
    write(
      "original.ts",
      [
        "export function bump() {",
        "  return advance();",
        "}",
        "",
        "export const limit = 7;",
        "",
        "export function advance() {",
        "  return limit + 1;",
        "}\n",
      ].join("\n"),
    );

    await move("original.ts", { "ticket.ts": ["bump", "advance"] }, ["limit"]);

    expect(read("ticket.ts")).toContain('import { limit } from "./original.js";');
    expect(read("ticket.ts")).not.toContain("import { advance");
    expect(read("original.ts")).toBe("export const limit = 7;\n");
  });

  it("checks the body bytes of a function stored in a const", async () => {
    const source = "export const bump = (step: number) => {  return step; };\n";
    write("original.ts", source);

    await expect(move("original.ts", { "bump.ts": ["bump"] })).rejects.toThrow(/bump.*body/i);
    expect(read("original.ts")).toBe(source);
    expect(() => read("bump.ts")).toThrow(/ENOENT/);
  });

  it("imports the binding referenced only by a shorthand property", async () => {
    write("amounts.ts", "export const fired = 7;\n");
    write(
      "original.ts",
      [
        'import { fired } from "./amounts.js";',
        "",
        "export function ticket() {",
        "  return { fired };",
        "}\n",
      ].join("\n"),
    );

    await move("original.ts", { "ticket.ts": ["ticket"] });

    expect(read("ticket.ts")).toBe(
      [
        'import { fired } from "./amounts.js";',
        "",
        "export function ticket() {",
        "  return { fired };",
        "}\n",
      ].join("\n"),
    );
  });

  it("keeps the shorthand property when its binding moves out", async () => {
    write(
      "original.ts",
      ["const fired = 7;", "", "export function ticket() {", "  return { fired };", "}\n"].join(
        "\n",
      ),
    );

    await move("original.ts", { "amounts.ts": ["fired"] }, ["ticket"]);

    expect(read("amounts.ts")).toBe("export const fired = 7;\n");
    expect(read("original.ts")).toBe(
      'import { fired } from "./amounts.js";\n\nexport function ticket() {\n  return { fired };\n}\n',
    );
  });

  it("refuses a declaration assigned to both the source and a destination", async () => {
    const source = "export const fired = 7;\n";
    write("original.ts", source);

    await expect(move("original.ts", { "amounts.ts": ["fired"] }, ["fired"])).rejects.toThrow(
      /fired.*more than once/i,
    );
    expect(read("original.ts")).toBe(source);
    expect(() => read("amounts.ts")).toThrow(/ENOENT/);
  });

  it("compiles a split with the Server's module settings", async () => {
    const compilerOptions = {
      module: "ESNext",
      moduleResolution: "Bundler",
      verbatimModuleSyntax: true,
    };
    write("tsconfig.json", JSON.stringify({ compilerOptions }));
    write(
      "original.ts",
      [
        "export interface Row {",
        "  price: number;",
        "}",
        "",
        "export const fees = { small: { price: 7 } };",
        "",
        "export function fee(row: Row) {",
        "  return row.price;",
        "}",
        "",
        "export function readFee(size: keyof typeof fees): number {",
        "  return fee(fees[size]);",
        "}\n",
      ].join("\n"),
    );

    await move("original.ts", { "ticket.ts": ["Row", "fee"], "fees.ts": ["fees"] }, ["readFee"]);

    const program = ts.createProgram(
      [join(root, "original.ts")],
      ts.convertCompilerOptionsFromJson(compilerOptions, root).options,
    );
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map(
          ({ code, messageText }) =>
            `${code}: ${ts.flattenDiagnosticMessageText(messageText, "\n")}`,
        ),
    ).toEqual([]);
  });
});
