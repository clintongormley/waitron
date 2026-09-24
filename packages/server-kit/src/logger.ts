export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;
