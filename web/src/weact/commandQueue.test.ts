import { describe, expect, it } from "vitest";
import { crc8 } from "./bytes";
import { WeActCommandQueue, type ByteTransport } from "./commandQueue";
import { Command } from "./commands";

class TestTransport implements ByteTransport {
  public writes: Uint8Array[] = [];
  private listener: ((bytes: Uint8Array) => void) | undefined;
  public async write(bytes: Uint8Array): Promise<void> { this.writes.push(bytes); }
  public onBytes(listener: (bytes: Uint8Array) => void): () => void { this.listener = listener; return () => { this.listener = undefined; }; }
  public emit(bytes: Uint8Array): void { this.listener?.(bytes); }
}

describe("WeActCommandQueue", () => {
  it("runs a high-priority write before queued polling reads", async () => {
    const transport = new TestTransport();
    const queue = new WeActCommandQueue(transport);
    const first = queue.request({ command: Command.OutputData, parse: () => "first" });
    const second = queue.request({ command: Command.InputType, parse: () => "second" });
    const write = queue.write(Command.SystemReset);
    expect(transport.writes[0]).toEqual(Uint8Array.of(0x82, 0x0a));
    transport.emit(Uint8Array.of(0x82, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0a));
    await expect(first).resolves.toBe("first");
    await expect(write).resolves.toBeUndefined();
    expect(transport.writes[1]).toEqual(Uint8Array.of(Command.SystemReset, 0x0a));
    expect(transport.writes[2]).toEqual(Uint8Array.of(0x87, 0x0a));
    queue.dispose();
    await expect(second).rejects.toThrow("disposed");
  });

  it("uses CRC-8 framing for the physical UART mode", async () => {
    const transport = new TestTransport();
    const queue = new WeActCommandQueue(transport, { useCrc: true });
    const request = queue.request({ command: Command.InputType, parse: (frame) => frame.payload[0] });

    const readBody = Uint8Array.of(0x87);
    expect(transport.writes[0]).toEqual(Uint8Array.of(0x87, crc8(readBody)));

    const responseBody = Uint8Array.of(0x87, 0x03);
    transport.emit(Uint8Array.of(...responseBody, crc8(responseBody)));
    await expect(request).resolves.toBe(0x03);
    queue.dispose();
  });
});
