export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * The structured-log sink `createErrorBoundary` writes through — a callable that takes a level, an
 * event name and optional structured fields. Only the type the boundary depends on lives here; the
 * concrete `createLogger` implementation stays in `apps/server` (`logger.ts`), which is the process
 * that owns a real output stream. A caller passes its own logger, structurally compatible with this.
 */
export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;
