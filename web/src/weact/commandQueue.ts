import { buildReadFrame, buildWriteFrame, hex } from "./bytes";
import { commandName } from "./commands";
import { WeActStreamParser } from "./parser";
import type { CommandDiagnostics, ProtocolLogEntry, WeActFrame } from "./types";

export interface ByteTransport {
  write(bytes: Uint8Array): Promise<void>;
  onBytes(listener: (bytes: Uint8Array) => void): () => void;
}

interface RequestOptions<T> {
  command: number;
  parse: (frame: WeActFrame) => T;
  priority?: number;
  timeoutMs?: number;
  retry?: boolean;
}

interface QueuedRead {
  kind: "read";
  command: number;
  parse: (frame: WeActFrame) => unknown;
  priority: number;
  timeoutMs: number;
  retry: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  attempts: number;
  sequence: number;
}

interface QueuedWrite {
  kind: "write";
  command: number;
  payload: Uint8Array;
  priority: number;
  resolve: () => void;
  reject: (error: Error) => void;
  sequence: number;
}

type QueuedTask = QueuedRead | QueuedWrite;

export class WeActCommandQueue {
  private readonly parser: WeActStreamParser;
  private readonly pending: QueuedTask[] = [];
  private active: QueuedTask | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private unsubscribe: (() => void) | undefined;
  private readonly logEntries: ProtocolLogEntry[] = [];
  private readonly diagnostics: CommandDiagnostics = {
    requests: 0,
    responses: 0,
    timeouts: 0,
    retries: 0,
    parserErrors: 0
  };

  public constructor(
    private readonly transport: ByteTransport,
    options: { useCrc?: boolean; onLog?: (entry: ProtocolLogEntry) => void } = {}
  ) {
    this.parser = new WeActStreamParser(options.useCrc ?? false);
    this.onLog = options.onLog;
    this.useCrc = options.useCrc ?? false;
    this.unsubscribe = this.transport.onBytes((bytes) => this.handleBytes(bytes));
  }

  private readonly useCrc: boolean;
  private readonly onLog: ((entry: ProtocolLogEntry) => void) | undefined;

  public get stats(): CommandDiagnostics {
    return { ...this.diagnostics };
  }

  public get logs(): ProtocolLogEntry[] {
    return [...this.logEntries];
  }

  public write(command: number, payload = new Uint8Array(), priority = 10): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.push({
        kind: "write",
        command,
        payload,
        priority,
        resolve,
        reject,
        sequence: this.sequence++
      });
      this.sortPending();
      void this.startNext();
    });
  }

  public request<T>(options: RequestOptions<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        ...options,
        kind: "read",
        priority: options.priority ?? 0,
        timeoutMs: options.timeoutMs ?? 1000,
        retry: options.retry ?? true,
        resolve: (value) => resolve(value as T),
        reject,
        attempts: 0,
        sequence: this.sequence++
      });
      this.sortPending();
      void this.startNext();
    });
  }

  public clear(reason = "Command queue cleared"): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.active) {
      this.active.reject(new Error(reason));
      this.active = undefined;
    }
    for (const request of this.pending.splice(0)) {
      request.reject(new Error(reason));
    }
    this.parser.reset();
  }

  public dispose(): void {
    this.clear("Command queue disposed");
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async startNext(): Promise<void> {
    if (this.active || this.pending.length === 0) {
      return;
    }
    this.active = this.pending.shift();
    if (!this.active) {
      return;
    }

    if (this.active.kind === "write") {
      await this.sendWrite(this.active);
      return;
    }
    await this.sendRead(this.active);
  }

  private async sendRead(request: QueuedRead): Promise<void> {
    const bytes = buildReadFrame(request.command, this.useCrc);
    request.attempts += 1;
    this.diagnostics.requests += 1;
    this.record({ timestamp: Date.now(), direction: "tx", label: commandName(request.command), bytes });

    try {
      await this.transport.write(bytes);
    } catch (error) {
      this.finishActiveError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    this.timeout = setTimeout(() => this.handleTimeout(), request.timeoutMs);
  }

  private async sendWrite(request: QueuedWrite): Promise<void> {
    const bytes = buildWriteFrame(request.command, request.payload, this.useCrc);
    this.diagnostics.requests += 1;
    this.record({ timestamp: Date.now(), direction: "tx", label: commandName(request.command), bytes });
    try {
      await this.transport.write(bytes);
      if (this.active !== request) return;
      this.active = undefined;
      request.resolve();
      void this.startNext();
    } catch (error) {
      this.finishActiveError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleTimeout(): void {
    if (!this.active || this.active.kind !== "read") {
      return;
    }
    this.diagnostics.timeouts += 1;
    if (this.active.retry && this.active.attempts === 1) {
      this.diagnostics.retries += 1;
      this.record({
        timestamp: Date.now(),
        direction: "info",
        label: commandName(this.active.command),
        detail: "Retrying read after timeout"
      });
      void this.sendRead(this.active);
      return;
    }
    this.finishActiveError(new Error(`${commandName(this.active.command)} timed out`));
  }

  private handleBytes(bytes: Uint8Array): void {
    const result = this.parser.push(bytes);
    for (const error of result.errors) {
      this.diagnostics.parserErrors += 1;
      this.record({ timestamp: Date.now(), direction: "error", label: "Parser", bytes, detail: error });
    }
    for (const frame of result.frames) {
      this.record({ timestamp: Date.now(), direction: "rx", label: commandName(frame.command), bytes: frame.raw });
      this.diagnostics.responses += 1;
      if (!this.active || this.active.kind !== "read" || frame.command !== this.active.command) {
        this.record({
          timestamp: Date.now(),
          direction: "error",
          label: commandName(frame.command),
          detail: "Unexpected response"
        });
        continue;
      }

      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = undefined;
      }
      const request = this.active;
      this.active = undefined;
      try {
        request.resolve(request.parse(frame));
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
      void this.startNext();
    }
  }

  private finishActiveError(error: Error): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    const request = this.active;
    this.active = undefined;
    request?.reject(error);
    this.record({ timestamp: Date.now(), direction: "error", label: "Queue", detail: error.message });
    void this.startNext();
  }

  private record(entry: ProtocolLogEntry): void {
    this.logEntries.push(entry);
    if (this.logEntries.length > 500) {
      this.logEntries.shift();
    }
    this.onLog?.(entry);
  }

  private sortPending(): void {
    this.pending.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
  }
}

export const describeProtocolLog = (entry: ProtocolLogEntry): string =>
  `${new Date(entry.timestamp).toISOString()} ${entry.direction.toUpperCase()} ${entry.label}${entry.bytes ? ` ${hex(entry.bytes)}` : ""}${entry.detail ? ` ${entry.detail}` : ""}`;
