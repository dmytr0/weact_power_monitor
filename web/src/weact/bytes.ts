import { FRAME_TERMINATOR, READ_FLAG } from "./commands";

export const crc8 = (input: Uint8Array): number => {
  let crc = 0xff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
};

export const finishFrame = (body: Uint8Array, useCrc = false): Uint8Array => {
  const result = new Uint8Array(body.length + 1);
  result.set(body);
  result[result.length - 1] = useCrc ? crc8(body) : FRAME_TERMINATOR;
  return result;
};

export const buildReadFrame = (command: number, useCrc = false): Uint8Array =>
  finishFrame(Uint8Array.of(command | READ_FLAG), useCrc);

export const buildWriteFrame = (
  command: number,
  payload: Uint8Array<ArrayBufferLike> = new Uint8Array(),
  useCrc = false
): Uint8Array => {
  const body = new Uint8Array(payload.length + 1);
  body[0] = command;
  body.set(payload, 1);
  return finishFrame(body, useCrc);
};

export const concatBytes = (...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBufferLike> => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export const u16le = (value: number): Uint8Array => {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
};

export const i32le = (value: number): Uint8Array => {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setInt32(0, value, true);
  return result;
};

export const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

export const hex = (bytes: Uint8Array): string =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(" ").toUpperCase();
