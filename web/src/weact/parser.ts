import {
  FIXED_RESPONSE_LENGTHS,
  FRAME_TERMINATOR,
  VARIABLE_RESPONSE_COMMANDS
} from "./commands";
import { concatBytes, crc8 } from "./bytes";
import type { WeActFrame } from "./types";

export interface ParserResult {
  frames: WeActFrame[];
  errors: string[];
}

/** Parses a byte stream: a BLE notification is never assumed to be a frame. */
export class WeActStreamParser {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();

  public constructor(private readonly useCrc = false) {}

  public reset(): void {
    this.buffer = new Uint8Array();
  }

  public push(chunk: Uint8Array): ParserResult {
    this.buffer = concatBytes(this.buffer, chunk);
    const frames: WeActFrame[] = [];
    const errors: string[] = [];

    while (this.buffer.length > 0) {
      const command = this.buffer[0] & 0x7f;
      const fixedLength = FIXED_RESPONSE_LENGTHS[command];
      const variableLength = VARIABLE_RESPONSE_COMMANDS.has(command);

      if (!fixedLength && !variableLength) {
        errors.push(`Unknown response head 0x${this.buffer[0].toString(16).padStart(2, "0")}`);
        this.buffer = this.buffer.slice(1);
        continue;
      }

      let totalLength: number;
      if (variableLength) {
        if (this.buffer.length < 2) {
          break;
        }
        totalLength = this.buffer[1] + 3;
      } else {
        totalLength = fixedLength;
      }

      if (totalLength > 1024) {
        errors.push(`Invalid frame length ${totalLength} for command 0x${command.toString(16)}`);
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (this.buffer.length < totalLength) {
        break;
      }

      const raw = this.buffer.slice(0, totalLength);
      const validFinalByte = this.useCrc
        ? crc8(raw.slice(0, -1)) === raw[raw.length - 1]
        : raw[raw.length - 1] === FRAME_TERMINATOR;

      if (!validFinalByte) {
        errors.push(`Invalid final byte for command 0x${command.toString(16).padStart(2, "0")}`);
        this.buffer = this.buffer.slice(1);
        continue;
      }

      const payload = variableLength ? raw.slice(2, -1) : raw.slice(1, -1);
      frames.push({ command, raw, payload });
      this.buffer = this.buffer.slice(totalLength);
    }

    return { frames, errors };
  }
}
