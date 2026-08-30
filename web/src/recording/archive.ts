import type { ChartSample, RecordingEvent, RecordingSession, SessionArchive } from "./types";

const csvEscape = (value: string | number): string => {
  const raw = String(value);
  return /[",\n]/u.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
};

export const samplesToCsv = (samples: ChartSample[]): string => [
  "timestamp_iso,timestamp_ms,elapsed_ms,voltage_v,current_a,power_w",
  ...samples.map((sample) => [
    new Date(sample.timestamp).toISOString(), sample.timestamp, sample.elapsedMs,
    sample.voltageV, sample.currentA, sample.powerW
  ].map(csvEscape).join(","))
].join("\n");

export const archiveSession = (
  session: RecordingSession,
  samples: ChartSample[],
  events: RecordingEvent[]
): SessionArchive => ({ format: "weact-power-monitor/session", version: 1, session, samples, events });

export const samplesToPlotlyJson = (session: RecordingSession, samples: ChartSample[]): object => ({
  data: [
    { x: samples.map((sample) => new Date(sample.timestamp).toISOString()), y: samples.map((sample) => sample.voltageV), name: "Voltage (V)", yaxis: "y" },
    { x: samples.map((sample) => new Date(sample.timestamp).toISOString()), y: samples.map((sample) => sample.currentA), name: "Current (A)", yaxis: "y2" },
    { x: samples.map((sample) => new Date(sample.timestamp).toISOString()), y: samples.map((sample) => sample.powerW), name: "Power (W)", yaxis: "y3" }
  ],
  layout: { title: `WeAct Power Monitor — ${new Date(session.startedAt).toLocaleString()}`, margin: { r: 112 }, xaxis: { title: "Time", domain: [0, 0.84] }, yaxis: { title: "V" }, yaxis2: { title: "A", overlaying: "y", side: "right" }, yaxis3: { title: "W", anchor: "free", overlaying: "y", side: "right", position: 0.94 } }
});

export const downloadText = (filename: string, mime: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const parseArchive = (value: unknown): SessionArchive => {
  if (!value || typeof value !== "object") throw new Error("Invalid session archive");
  const archive = value as Partial<SessionArchive>;
  if (archive.format !== "weact-power-monitor/session" || archive.version !== 1 || !archive.session || !Array.isArray(archive.samples) || !Array.isArray(archive.events)) {
    throw new Error("Unsupported session archive");
  }
  return archive as SessionArchive;
};

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
};

/** Imports the CSV format emitted by this app. Parsing is deliberately local and dependency-free. */
export const parseCsvSession = (text: string): SessionArchive => {
  const rows = parseCsvRows(text);
  const headers = rows.shift();
  if (!headers) throw new Error("CSV is empty");
  const lookup = new Map(headers.map((header, index) => [header.trim().toLowerCase(), index]));
  const field = (row: string[], name: string): string => row[lookup.get(name) ?? -1] ?? "";
  if (!lookup.has("voltage_v") || !lookup.has("current_a") || !lookup.has("power_w")) throw new Error("CSV does not contain Power Monitor sample columns");
  const samples: ChartSample[] = rows.map((row, index) => {
    const timestamp = Number(field(row, "timestamp_ms")) || Date.parse(field(row, "timestamp_iso"));
    const voltageV = Number(field(row, "voltage_v"));
    const currentA = Number(field(row, "current_a"));
    const powerW = Number(field(row, "power_w"));
    const elapsedMs = Number(field(row, "elapsed_ms"));
    if (![timestamp, voltageV, currentA, powerW].every(Number.isFinite)) throw new Error(`CSV sample ${index + 1} is invalid`);
    return { timestamp, voltageV, currentA, powerW, elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0 };
  });
  if (samples.length === 0) throw new Error("CSV contains no samples");
  const startedAt = samples[0].timestamp;
  const endedAt = samples.at(-1)!.timestamp;
  const period = samples.length > 1 ? (endedAt - startedAt) / (samples.length - 1) : 1000;
  return {
    format: "weact-power-monitor/session", version: 1,
    session: { id: "", startedAt, endedAt, deviceName: "Imported CSV", sampleRateHz: Math.max(1, Math.round(1000 / Math.max(1, period))), note: "Imported CSV", sampleCount: samples.length, imported: true },
    samples, events: []
  };
};
