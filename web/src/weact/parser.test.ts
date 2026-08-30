import { describe, expect, it } from "vitest";
import { Command, FRAME_TERMINATOR } from "./commands";
import { WeActStreamParser } from "./parser";

describe("WeActStreamParser", () => {
  it("parses a fragmented signed-current measurement", () => {
    const parser = new WeActStreamParser();
    const raw = Uint8Array.of(0x82, 0x10, 0x27, 0, 0, 0x18, 0xfc, 0xff, 0xff, 0x40, 0x1f, 0, 0, FRAME_TERMINATOR);
    expect(parser.push(raw.slice(0, 5)).frames).toHaveLength(0);
    const result = parser.push(raw.slice(5));
    expect(result.errors).toHaveLength(0);
    expect(result.frames).toHaveLength(1);
    expect(new DataView(result.frames[0].payload.buffer, result.frames[0].payload.byteOffset).getInt32(4, true)).toBe(-1000);
  });

  it("parses multiple and variable-length frames in one byte stream", () => {
    const parser = new WeActStreamParser();
    const who = Uint8Array.of(0x81, 3, 65, 66, 67, FRAME_TERMINATOR);
    const input = Uint8Array.of(0x87, 1, FRAME_TERMINATOR);
    const result = parser.push(new Uint8Array([...who, ...input]));
    expect(result.frames.map((frame) => frame.command)).toEqual([Command.WhoAmI, Command.InputType]);
    expect(new TextDecoder().decode(result.frames[0].payload)).toBe("ABC");
  });

  it("recovers from an invalid leading byte", () => {
    const parser = new WeActStreamParser();
    const result = parser.push(Uint8Array.of(0xff, 0x87, 1, FRAME_TERMINATOR));
    expect(result.errors).toHaveLength(1);
    expect(result.frames).toHaveLength(1);
  });
});

