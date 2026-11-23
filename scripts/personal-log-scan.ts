/** The scanner behind personal-log-params.test.ts; that file's header states its limits. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

export const ROOT = join(import.meta.dirname, "..");

export interface LogField {
  event: string;
  key: string;
}

export interface RegistryKey {
  code: string;
  key: string;
}

export interface Scan {
  isRegistry: boolean;
  registryKeys: RegistryKey[];
  registryTypes: string[];
  unrecognisedEntries: string[];
  logFields: LogField[];
  needsTypes: boolean;
  unreadableSpreads: string[];
}

export type Source = string | Scan;

const DOTTED_NAME = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/;
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

const OPAQUE_FORWARDERS = [
  {
    file: "apps/server/src/box-host-api.ts",
    code: "err.code",
    params: "err.params",
    reason: "The box-host refusal forwards the registered details for the same error code.",
  },
  {
    file: "packages/fiscal-verifactu/src/filing-overview-routes.ts",
    code: '"fiscal.filing_day_unread"',
    params: "error.params",
    reason: "The filing overview forwards details from its selected AppError codes.",
  },
  {
    file: "packages/server-kit/src/error-boundary.ts",
    code: "cause.code",
    params: "cause.params",
    reason: "The error boundary forwards the registered details for the same error code.",
  },
  {
    file: "packages/venue-service/src/season-weeks.ts",
    code: "error.code",
    params: "error.params",
    reason: "The rethrow forwards the registered details and prefixes the field path.",
  },
];

function scanSource(source: ts.SourceFile, file: string, checker?: ts.TypeChecker): Scan {
  const result: Scan = {
    isRegistry: false,
    registryKeys: [],
    registryTypes: [],
    unrecognisedEntries: [],
    logFields: [],
    needsTypes: false,
    unreadableSpreads: [],
  };

  function readRegistry(registry: ts.InterfaceDeclaration): void {
    result.isRegistry = true;
    for (const entry of registry.members) {
      if (
        !ts.isPropertySignature(entry) ||
        !ts.isStringLiteral(entry.name) ||
        !DOTTED_NAME.test(entry.name.text)
      ) {
        result.unrecognisedEntries.push(
          entry.getText(source).replace(/[;,]$/, "").replace(/\s+/g, " "),
        );
        continue;
      }
      const code = entry.name.text;
      function visitType(node: ts.Node): void {
        if (ts.isPropertySignature(node)) {
          const key = staticKey(node.name);
          if (key !== undefined) result.registryKeys.push({ code, key });
        }
        if (ts.isTypeReferenceNode(node)) result.registryTypes.push(node.typeName.getText(source));
        if (ts.isTypeQueryNode(node)) result.registryTypes.push(node.exprName.getText(source));
        if (ts.isImportTypeNode(node) && node.qualifier !== undefined) {
          result.registryTypes.push(node.qualifier.getText(source));
        }
        ts.forEachChild(node, visitType);
      }
      if (entry.type !== undefined) visitType(entry.type);
    }
  }

  function readObject(
    object: ts.ObjectLiteralExpression,
    codeOrEvent: ts.Expression | undefined,
    addKey: (name: string, key: string) => void,
    includeDirectFields: boolean,
  ): void {
    const name = stringValue(codeOrEvent) ?? file;
    function visitField(node: ts.Node): void {
      if (ts.isSpreadAssignment(node)) {
        result.needsTypes = true;
        if (checker !== undefined) {
          const type = checker.getTypeAtLocation(node.expression);
          const keys = spreadKeys(checker, type);
          if (keys === undefined) {
            const code = codeOrEvent?.getText(source);
            const params = node.expression.getText(source);
            if (
              OPAQUE_FORWARDERS.some(
                (allowed) =>
                  allowed.file === file && allowed.code === code && allowed.params === params,
              )
            )
              return;

            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            result.unreadableSpreads.push(
              `${name} (${file}:${line}): ${checker.typeToString(type)}`,
            );
          } else {
            for (const key of keys) addKey(name, key);
          }
        }
        return;
      }
      if (
        includeDirectFields &&
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      ) {
        const key = staticKey(node.name);
        if (key !== undefined) addKey(name, key);
      }
      ts.forEachChild(node, visitField);
    }
    ts.forEachChild(object, visitField);
  }

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "ErrorParams") readRegistry(node);

    if (ts.isCallExpression(node)) {
      const [level, event, fields] = node.arguments;
      const eventName = stringValue(event);
      if (
        fields !== undefined &&
        ts.isObjectLiteralExpression(fields) &&
        (LOG_LEVELS.has(stringValue(level) ?? "") || DOTTED_NAME.test(eventName ?? ""))
      ) {
        readObject(fields, event, (name, key) => result.logFields.push({ event: name, key }), true);
      }
    }

    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "AppError"
    ) {
      const [code, details] = node.arguments ?? [];
      if (details !== undefined && ts.isObjectLiteralExpression(details)) {
        readObject(
          details,
          code,
          (name, key) => result.registryKeys.push({ code: name, key }),
          false,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return result;
}

function stringValue(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : undefined;
}

function staticKey(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) ? node.text : stringValue(node);
}

function spreadKeys(checker: ts.TypeChecker, type: ts.Type): string[] | undefined {
  if (type.isUnion()) {
    const keys = new Set<string>();
    for (const member of type.types) {
      const memberKeys = spreadKeys(checker, member);
      if (memberKeys === undefined) return undefined;
      for (const key of memberKeys) keys.add(key);
    }
    return [...keys];
  }
  if ((type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) return [];
  if (
    ((type.flags & ts.TypeFlags.Object) === 0 && !type.isIntersection()) ||
    checker.getIndexInfosOfType(type).length > 0
  ) {
    return undefined;
  }
  return checker.getPropertiesOfType(type).map((property) => property.getName());
}

function spreadProgram(files: string[], text?: string): ts.Program {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  if (text !== undefined) {
    const getSourceFile = host.getSourceFile;
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
      file === files[0]
        ? ts.createSourceFile(file, text, languageVersion)
        : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  }
  return ts.createProgram(files, options, host);
}

function scanText(file: string, text: string): Scan {
  return scanSource(ts.createSourceFile(join(ROOT, file), text, ts.ScriptTarget.Latest), file);
}

export function scanFixture(file: string, source: Source): Scan {
  if (typeof source !== "string") return source;
  const scan = scanText(file, source);
  if (!scan.needsTypes) return scan;

  const path = join(ROOT, file);
  const program = spreadProgram([path], source);
  return scanSource(program.getSourceFile(path)!, file, program.getTypeChecker());
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "testing" ? [] : sourceFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

function treeSourceFiles(): string[] {
  return ["apps", "packages"]
    .flatMap((top) =>
      readdirSync(join(ROOT, top), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(ROOT, top, entry.name, "src")),
    )
    .filter((src) => existsSync(src))
    .flatMap(sourceFiles)
    .map((path) => relative(ROOT, path))
    .sort();
}

export interface TreeSource extends Scan {
  file: string;
}

function scanTree(): TreeSource[] {
  const scans = treeSourceFiles().map((file) => ({
    file,
    ...scanText(file, readFileSync(join(ROOT, file), "utf8")),
  }));
  const candidates = scans.filter(({ needsTypes }) => needsTypes);
  if (candidates.length > 0) {
    const program = spreadProgram(candidates.map(({ file }) => join(ROOT, file)));
    const checker = program.getTypeChecker();
    for (const candidate of candidates) {
      const source = program.getSourceFile(join(ROOT, candidate.file))!;
      Object.assign(candidate, scanSource(source, candidate.file, checker));
    }
  }
  return scans;
}

if (import.meta.main) process.stdout.write(JSON.stringify(scanTree()));
