import { i32le, u16le } from "./bytes";
import { Command } from "./commands";
import { WeActCommandQueue } from "./commandQueue";
import type {
  AvsPdo,
  CurrentOffsets,
  CurrentPdo,
  DeviceInfo,
  EnergyReading,
  FixedPdo,
  Ina226Config,
  InputType,
  MaximumReading,
  Measurement,
  PdoCounts,
  PpsPdo,
  WeActFrame
} from "./types";

const textDecoder = new TextDecoder();

const view = (frame: WeActFrame): DataView =>
  new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);

const asString = (frame: WeActFrame): string =>
  textDecoder.decode(frame.payload).replace(/\0+$/u, "").trim();

const inputType = (value: number): InputType => {
  if (value === 1) return "pd";
  if (value === 2) return "qc";
  if (value === 3) return "dc";
  if (value === 0 || value === 4) return "initializing";
  return "unknown";
};

const parseMeasurement = (frame: WeActFrame): Measurement => {
  const data = view(frame);
  return {
    voltageV: data.getUint32(0, true) / 1000,
    currentA: data.getInt32(4, true) / 10000,
    powerW: data.getUint32(8, true) / 1000
  };
};

const parsePdoRecords = <T>(
  frame: WeActFrame,
  recordLength: number,
  mapper: (data: DataView, offset: number, id: number) => T
): T[] => {
  if (frame.payload.length % recordLength !== 0) {
    throw new Error(`PDO payload length ${frame.payload.length} is invalid`);
  }
  const data = view(frame);
  const result: T[] = [];
  for (let offset = 0; offset < frame.payload.length; offset += recordLength) {
    result.push(mapper(data, offset, result.length + 1));
  }
  return result;
};

export const INA_CONVERSION_TIMES = ["140 µs", "204 µs", "332 µs", "588 µs", "1.1 ms", "2.116 ms", "4.156 ms", "8.244 ms"];
export const INA_AVERAGING_VALUES = [1, 4, 16, 64, 128, 256, 512, 1024];

/** Literal TypeScript port of the documented PowerMonitorMiniV1 UART wrapper. */
export class WeActProtocol {
  public constructor(private readonly queue: WeActCommandQueue) {}

  public whoAmI(): Promise<string> {
    return this.queue.request({ command: Command.WhoAmI, parse: asString, priority: 10 });
  }

  public systemVersion(): Promise<string> {
    return this.queue.request({ command: Command.SystemVersion, parse: asString, priority: 10 });
  }

  public serialNumber(): Promise<string> {
    return this.queue.request({ command: Command.SystemSerialNumber, parse: asString, priority: 10 });
  }

  public async deviceIdentity(): Promise<Omit<DeviceInfo, "lcdPanel">> {
    const [model, firmware, serial] = await Promise.all([
      this.whoAmI(),
      this.systemVersion(),
      this.serialNumber()
    ]);
    return { model, firmware, serial };
  }

  public outputData(priority = 0): Promise<Measurement> {
    return this.queue.request({ command: Command.OutputData, parse: parseMeasurement, priority });
  }

  public outputDataMax(): Promise<MaximumReading> {
    return this.queue.request({ command: Command.OutputDataMax, parse: parseMeasurement });
  }

  public mahMwh(): Promise<EnergyReading> {
    return this.queue.request({
      command: Command.MahMwh,
      parse: (frame) => {
        const data = view(frame);
        return { mah: data.getUint32(0, true), mwh: data.getUint32(4, true) };
      }
    });
  }

  public uptime(): Promise<number> {
    return this.queue.request({
      command: Command.Uptime,
      parse: (frame) => view(frame).getUint32(0, true)
    });
  }

  public inputType(): Promise<InputType> {
    return this.queue.request({
      command: Command.InputType,
      parse: (frame) => inputType(frame.payload[0])
    });
  }

  public lcdPanel(): Promise<DeviceInfo["lcdPanel"]> {
    return this.queue.request({
      command: Command.SystemLcdPanelType,
      parse: (frame) => (frame.payload[0] === 1 ? "BOE" : frame.payload[0] === 0 ? "HAN" : "Unknown")
    });
  }

  public pdoCounts(): Promise<PdoCounts> {
    return this.queue.request({
      command: Command.PdPdoNum,
      parse: (frame) => ({ fixed: frame.payload[0], pps: frame.payload[1], avs: frame.payload[2] })
    });
  }

  public fixedPdos(): Promise<FixedPdo[]> {
    return this.queue.request({
      command: Command.PdPdoFixed,
      parse: (frame) => parsePdoRecords(frame, 4, (data, offset, id) => ({
        id,
        voltageMv: data.getUint16(offset, true),
        currentMa: data.getUint16(offset + 2, true)
      }))
    });
  }

  public ppsPdos(fixedCount = 0): Promise<PpsPdo[]> {
    return this.queue.request({
      command: Command.PdPdoPps,
      parse: (frame) => parsePdoRecords(frame, 6, (data, offset, index) => ({
        id: fixedCount + index,
        minVoltageMv: data.getUint16(offset, true),
        maxVoltageMv: data.getUint16(offset + 2, true),
        maxCurrentMa: data.getUint16(offset + 4, true)
      }))
    });
  }

  public avsPdos(fixedCount = 0, ppsCount = 0): Promise<AvsPdo[]> {
    return this.queue.request({
      command: Command.PdPdoAvs,
      parse: (frame) => parsePdoRecords(frame, 6, (data, offset, index) => ({
        id: fixedCount + ppsCount + index,
        minVoltageMv: data.getUint16(offset, true),
        maxVoltageMv: data.getUint16(offset + 2, true),
        maxPowerW: data.getUint16(offset + 4, true)
      }))
    });
  }

  public currentPdo2(): Promise<CurrentPdo> {
    return this.queue.request({
      command: Command.PdPdo2,
      parse: (frame) => {
        const data = view(frame);
        return { id: frame.payload[0], voltageMv: data.getUint16(1, true), currentMa: data.getUint16(3, true) };
      },
      priority: 5
    });
  }

  public resetMaximums(): Promise<void> {
    return this.queue.write(Command.OutputDataMaxReset);
  }

  public restart(): Promise<void> {
    return this.queue.write(Command.SystemReset);
  }

  public setPdo2(id: number, voltageMv: number, currentMa: number): Promise<void> {
    if (!Number.isInteger(id) || id < 1 || id > 255) throw new Error("Invalid PDO ID");
    if (!Number.isInteger(voltageMv) || voltageMv < 0 || voltageMv > 0xffff) throw new Error("Invalid PDO voltage");
    if (!Number.isInteger(currentMa) || currentMa < 0 || currentMa > 0xffff) throw new Error("Invalid PDO current");
    const payload = new Uint8Array(5);
    payload[0] = id;
    payload.set(u16le(voltageMv), 1);
    payload.set(u16le(currentMa), 3);
    return this.queue.write(Command.PdPdo2, payload);
  }

  public currentRshunt(): Promise<number> {
    return this.queue.request({ command: Command.SystemCurrentRshunt, parse: (frame) => frame.payload[0] });
  }

  public setCurrentRshunt(value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("Rshunt must be 0–255 mΩ");
    return this.queue.write(Command.SystemCurrentRshunt, Uint8Array.of(value));
  }

  public currentOffsets(): Promise<CurrentOffsets> {
    return this.queue.request({
      command: Command.SystemCurrentOffset,
      parse: (frame) => {
        const data = view(frame);
        return {
          first: { displayedTenthsMa: data.getInt32(0, true), actualTenthsMa: data.getInt32(4, true) },
          second: { displayedTenthsMa: data.getInt32(8, true), actualTenthsMa: data.getInt32(12, true) },
          zeroOffsetTenthsMa: data.getInt32(16, true)
        };
      }
    });
  }

  public setCurrentOffsets(offsets: CurrentOffsets): Promise<void> {
    const values = [
      offsets.first.displayedTenthsMa,
      offsets.first.actualTenthsMa,
      offsets.second.displayedTenthsMa,
      offsets.second.actualTenthsMa,
      offsets.zeroOffsetTenthsMa
    ];
    if (values.slice(0, 4).some((value) => value < -1_000_000 || value > 1_000_000)) {
      throw new Error("Calibration values must be within ±1,000,000 × 0.1 mA");
    }
    if (offsets.zeroOffsetTenthsMa < -15 || offsets.zeroOffsetTenthsMa > 15) {
      throw new Error("Zero offset must be within ±15 × 0.1 mA");
    }
    const payload = new Uint8Array(20);
    values.forEach((value, index) => payload.set(i32le(value), index * 4));
    return this.queue.write(Command.SystemCurrentOffset, payload);
  }

  public ina226Config(): Promise<Ina226Config> {
    return this.queue.request({
      command: Command.SystemIna226Config,
      parse: (frame) => {
        const data = view(frame);
        const registerValue = data.getUint16(1, true);
        return {
          currentLsbTenthsMa: frame.payload[0],
          registerValue,
          shuntConversionIndex: (registerValue >> 3) & 0x07,
          busConversionIndex: (registerValue >> 6) & 0x07,
          averagingIndex: (registerValue >> 9) & 0x07
        };
      }
    });
  }

  public setIna226Config(config: Omit<Ina226Config, "registerValue">): Promise<void> {
    const { currentLsbTenthsMa, shuntConversionIndex, busConversionIndex, averagingIndex } = config;
    if (currentLsbTenthsMa < 1 || currentLsbTenthsMa > 10) throw new Error("Current LSB must be 0.1–1.0 mA");
    if ([shuntConversionIndex, busConversionIndex, averagingIndex].some((value) => value < 0 || value > 7)) {
      throw new Error("INA226 conversion and averaging values must be 0–7");
    }
    const registerValue = (shuntConversionIndex << 3) | (busConversionIndex << 6) | (averagingIndex << 9) | (4 << 12);
    const payload = new Uint8Array(3);
    payload[0] = currentLsbTenthsMa;
    payload.set(u16le(registerValue), 1);
    return this.queue.write(Command.SystemIna226Config, payload);
  }

  public factoryReset(): Promise<void> {
    return this.queue.write(Command.SystemFactoryReset);
  }
}
