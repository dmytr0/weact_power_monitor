export type InputType = "initializing" | "pd" | "qc" | "dc" | "unknown";

export interface Measurement {
  voltageV: number;
  currentA: number;
  powerW: number;
}

export interface EnergyReading {
  mah: number;
  mwh: number;
}

export interface MaximumReading extends Measurement {}

export interface FixedPdo {
  id: number;
  voltageMv: number;
  currentMa: number;
}

export interface PpsPdo {
  id: number;
  minVoltageMv: number;
  maxVoltageMv: number;
  maxCurrentMa: number;
}

export interface AvsPdo {
  id: number;
  minVoltageMv: number;
  maxVoltageMv: number;
  maxPowerW: number;
}

export interface PdoCounts {
  fixed: number;
  pps: number;
  avs: number;
}

export interface CurrentPdo {
  id: number;
  voltageMv: number;
  currentMa: number;
}

export interface Ina226Config {
  currentLsbTenthsMa: number;
  registerValue: number;
  shuntConversionIndex: number;
  busConversionIndex: number;
  averagingIndex: number;
}

export interface CalibrationPoint {
  displayedTenthsMa: number;
  actualTenthsMa: number;
}

export interface CurrentOffsets {
  first: CalibrationPoint;
  second: CalibrationPoint;
  zeroOffsetTenthsMa: number;
}

export interface DeviceInfo {
  model: string;
  firmware: string;
  serial: string;
  lcdPanel: "BOE" | "HAN" | "Unknown";
}

export interface WeActFrame {
  command: number;
  raw: Uint8Array;
  payload: Uint8Array;
}

export interface ProtocolLogEntry {
  timestamp: number;
  direction: "tx" | "rx" | "info" | "error";
  label: string;
  bytes?: Uint8Array;
  detail?: string;
}

export interface CommandDiagnostics {
  requests: number;
  responses: number;
  timeouts: number;
  retries: number;
  parserErrors: number;
}

export interface PdoCapabilities {
  counts: PdoCounts;
  fixed: FixedPdo[];
  pps: PpsPdo[];
  avs: AvsPdo[];
}

