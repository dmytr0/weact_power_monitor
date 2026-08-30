import type { ByteTransport } from "../weact/commandQueue";
import { concatBytes, u16le } from "../weact/bytes";
import { Command, FRAME_TERMINATOR, READ_FLAG } from "../weact/commands";

export class MockPowerMonitorTransport implements ByteTransport {
  private readonly listeners = new Set<(bytes: Uint8Array) => void>();
  private startedAt = performance.now();
  private currentPdo = { id: 4, voltageMv: 9000, currentMa: 3000 };
  private readonly fixed = [
    [5000, 3000],
    [9000, 3000],
    [12000, 3000],
    [15000, 3000],
    [20000, 5000]
  ];

  public readonly name = "WeActPM-DEMO";
  public readonly id = "demo-power-monitor";
  public connected = false;

  public async connect(): Promise<void> {
    this.connected = true;
    this.startedAt = performance.now();
  }

  public disconnect(): void {
    this.connected = false;
  }

  public onBytes(listener: (bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async write(request: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error("Demo device is disconnected");
    const command = request[0] & 0x7f;
    if ((request[0] & READ_FLAG) === 0) {
      this.applyWrite(command, request.slice(1, -1));
      return;
    }
    const response = this.response(command);
    queueMicrotask(() => this.emitFragmented(response));
  }

  private applyWrite(command: number, payload: Uint8Array): void {
    if (command === Command.PdPdo2 && payload.length >= 5) {
      const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      this.currentPdo = { id: payload[0], voltageMv: data.getUint16(1, true), currentMa: data.getUint16(3, true) };
    }
    if (command === Command.SystemFactoryReset) {
      this.currentPdo = { id: 1, voltageMv: 5000, currentMa: 3000 };
    }
  }

  private response(command: number): Uint8Array {
    const variable = (text: string): Uint8Array => {
      const bytes = new TextEncoder().encode(text);
      return Uint8Array.of(command | READ_FLAG, bytes.length, ...bytes, FRAME_TERMINATOR);
    };
    const fixed = (payload: Uint8Array): Uint8Array =>
      Uint8Array.of(command | READ_FLAG, ...payload, FRAME_TERMINATOR);
    const now = performance.now() - this.startedAt;
    const ripple = Math.sin(now / 1200) * 0.045;
    const voltageV = this.currentPdo.voltageMv / 1000 + ripple;
    const currentA = 1.15 + Math.sin(now / 700) * 0.18;
    const powerW = voltageV * currentA;
    const measurement = (): Uint8Array => {
      const payload = new Uint8Array(12);
      const data = new DataView(payload.buffer);
      data.setUint32(0, Math.round(voltageV * 1000), true);
      data.setInt32(4, Math.round(currentA * 10000), true);
      data.setUint32(8, Math.round(powerW * 1000), true);
      return payload;
    };

    switch (command) {
      case Command.WhoAmI: return variable("PowerMonitorMiniV1");
      case Command.SystemVersion: return variable("V1.0.1.0");
      case Command.SystemSerialNumber: return variable("DEMO-52840");
      case Command.OutputData: return fixed(measurement());
      case Command.OutputDataMax: {
        const payload = measurement();
        const data = new DataView(payload.buffer);
        data.setUint32(0, 20130, true);
        data.setInt32(4, 31800, true);
        data.setUint32(8, 64100, true);
        return fixed(payload);
      }
      case Command.MahMwh: {
        const payload = new Uint8Array(8);
        const data = new DataView(payload.buffer);
        data.setUint32(0, Math.floor(now / 10), true);
        data.setUint32(4, Math.floor(now / 2), true);
        return fixed(payload);
      }
      case Command.Uptime: {
        const payload = new Uint8Array(4);
        new DataView(payload.buffer).setUint32(0, Math.floor(now / 1000), true);
        return fixed(payload);
      }
      case Command.InputType: return fixed(Uint8Array.of(1));
      case Command.PdPdoNum: return fixed(Uint8Array.of(this.fixed.length, 1, 1));
      case Command.PdPdoFixed: return this.variableRecords(command, this.fixed.flatMap(([voltage, current]) => [...u16le(voltage), ...u16le(current)]));
      case Command.PdPdoPps: return this.variableRecords(command, [...u16le(3300), ...u16le(11000), ...u16le(5000)]);
      case Command.PdPdoAvs: return this.variableRecords(command, [...u16le(15000), ...u16le(28000), ...u16le(140)]);
      case Command.PdPdo2: return fixed(Uint8Array.of(this.currentPdo.id, ...u16le(this.currentPdo.voltageMv), ...u16le(this.currentPdo.currentMa)));
      case Command.SystemLcdPanelType: return fixed(Uint8Array.of(1));
      case Command.SystemCurrentRshunt: return fixed(Uint8Array.of(5));
      case Command.SystemCurrentOffset: return fixed(new Uint8Array(20));
      case Command.SystemIna226Config: return fixed(Uint8Array.of(3, 0x1b, 0x0a));
      default: return fixed(new Uint8Array());
    }
  }

  private variableRecords(command: number, values: number[]): Uint8Array {
    return Uint8Array.of(command | READ_FLAG, values.length, ...values, FRAME_TERMINATOR);
  }

  private emitFragmented(bytes: Uint8Array): void {
    const firstLength = Math.min(3, bytes.length);
    const first = bytes.slice(0, firstLength);
    const rest = bytes.slice(firstLength);
    this.listeners.forEach((listener) => listener(first));
    if (rest.length > 0) {
      queueMicrotask(() => this.listeners.forEach((listener) => listener(rest)));
    }
  }
}

