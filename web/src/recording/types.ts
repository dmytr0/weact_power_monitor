import type { DeviceInfo, EnergyReading, Measurement } from "../weact/types";

export interface ChartSample extends Measurement {
  timestamp: number;
  elapsedMs: number;
}

export interface RecordingSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  deviceName: string;
  deviceInfo?: DeviceInfo;
  inputType?: string;
  sampleRateHz: number;
  note: string;
  sampleCount: number;
  finalEnergy?: EnergyReading;
  imported?: boolean;
}

export interface RecordingEvent {
  id?: number;
  sessionId: string;
  timestamp: number;
  type: "recording" | "pd" | "configuration" | "connection" | "note";
  message: string;
  details?: Record<string, number | string | boolean>;
}

export interface SessionArchive {
  format: "weact-power-monitor/session";
  version: 1;
  session: RecordingSession;
  samples: ChartSample[];
  events: RecordingEvent[];
}
