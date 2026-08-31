import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LoggerEvent } from "./types.js";

export class JsonLogger {
  private readonly logFilePath: string;

  constructor(rootDir: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFilePath = join(rootDir, "artifacts", "logs", `run-${stamp}.jsonl`);
  }

  get path(): string {
    return this.logFilePath;
  }

  info(event: string, data?: unknown): void {
    this.write("info", event, data);
  }

  warn(event: string, data?: unknown): void {
    this.write("warn", event, data);
  }

  error(event: string, data?: unknown): void {
    this.write("error", event, data);
  }

  private write(level: LoggerEvent["level"], event: string, data?: unknown): void {
    const payload: LoggerEvent = {
      timestamp: new Date().toISOString(),
      level,
      event,
      data,
    };

    appendFileSync(this.logFilePath, `${JSON.stringify(payload)}\n`, "utf8");
  }
}
