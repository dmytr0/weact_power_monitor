import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type ReactElement } from "react";
import { BrowserBleTransport, type BleConnectionState } from "../ble/BleTransport";
import { MockPowerMonitorTransport } from "../simulation/MockTransport";
import { addEvent, appendSamples, deleteSession as removeSession, getEvents, getSamples, listSessions, putSession } from "../recording/storage";
import type { ChartSample, RecordingEvent, RecordingSession, SessionArchive } from "../recording/types";
import { WeActCommandQueue, type ByteTransport } from "../weact/commandQueue";
import { WeActProtocol } from "../weact/protocol";
import type { CommandDiagnostics, CurrentOffsets, CurrentPdo, DeviceInfo, EnergyReading, Ina226Config, InputType, MaximumReading, Measurement, PdoCapabilities, ProtocolLogEntry } from "../weact/types";

type ConnectionStatus = BleConnectionState | "error";
type RuntimeTransport = ByteTransport & {
  connect: () => Promise<void>;
  disconnect: () => void;
  dispose?: () => void;
  name?: string;
  id?: string;
  stats?: { notifications: number; rxBytes: number; txBytes: number };
  onState?: (listener: (state: BleConnectionState, error?: Error) => void) => () => void;
};

export interface AdvancedSettings {
  rshunt?: number;
  ina?: Ina226Config;
  offsets?: CurrentOffsets;
}

export interface MonitorState {
  status: ConnectionStatus;
  deviceName?: string;
  deviceId?: string;
  isDemo: boolean;
  measurement?: Measurement;
  maximums?: MaximumReading;
  energy?: EnergyReading;
  uptimeSeconds?: number;
  inputType?: InputType;
  deviceInfo?: DeviceInfo;
  pd?: PdoCapabilities;
  currentPdo?: CurrentPdo;
  samples: ChartSample[];
  logs: ProtocolLogEntry[];
  diagnostics: CommandDiagnostics;
  transportStats?: { notifications: number; rxBytes: number; txBytes: number };
  activeSession?: RecordingSession;
  sessions: RecordingSession[];
  advanced: AdvancedSettings;
  pollRateHz: number;
  chartWindowSeconds: number;
  lastError?: string;
  notice?: string;
}

export interface MonitorActions {
  connect: (demo?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  setPollRateHz: (value: number) => void;
  setChartWindowSeconds: (value: number) => void;
  startRecording: (note: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  resetMaximums: () => Promise<void>;
  setPdo: (id: number, voltageMv: number, currentMa: number) => Promise<void>;
  refreshAdvanced: () => Promise<void>;
  saveRshunt: (value: number) => Promise<void>;
  saveIna: (config: Omit<Ina226Config, "registerValue">) => Promise<void>;
  saveOffsets: (offsets: CurrentOffsets) => Promise<void>;
  restart: () => Promise<void>;
  factoryReset: () => Promise<void>;
  clearLogs: () => void;
  loadSession: (id: string) => Promise<{ session: RecordingSession; samples: ChartSample[]; events: RecordingEvent[] }>;
  deleteSession: (id: string) => Promise<void>;
  importArchive: (archive: SessionArchive) => Promise<void>;
  dismissMessage: () => void;
}

const initialState: MonitorState = {
  status: "disconnected",
  isDemo: false,
  samples: [],
  logs: [],
  diagnostics: { requests: 0, responses: 0, timeouts: 0, retries: 0, parserErrors: 0 },
  sessions: [],
  advanced: {},
  pollRateHz: 5,
  chartWindowSeconds: 60
};

const MonitorContext = createContext<(MonitorState & MonitorActions) | undefined>(undefined);

const uuid = (): string => globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const toErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const PowerMonitorProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [state, setState] = useState<MonitorState>(initialState);
  const transportRef = useRef<RuntimeTransport | undefined>(undefined);
  const queueRef = useRef<WeActCommandQueue | undefined>(undefined);
  const protocolRef = useRef<WeActProtocol | undefined>(undefined);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollingRef = useRef(false);
  const pollRunRef = useRef(0);
  const pollRateRef = useRef(initialState.pollRateHz);
  const chartWindowRef = useRef(initialState.chartWindowSeconds);
  const metadataAtRef = useRef(0);
  const inputAtRef = useRef(0);
  const pdLoadedRef = useRef(false);
  const activeSessionRef = useRef<RecordingSession | undefined>(undefined);
  const recordingBufferRef = useRef<ChartSample[]>([]);
  const flushingRef = useRef(false);
  const flushPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const unlistenStateRef = useRef<(() => void) | undefined>(undefined);

  const update = useCallback((patch: Partial<MonitorState>) => setState((previous) => ({ ...previous, ...patch })), []);
  const loadSessionList = useCallback(async () => update({ sessions: await listSessions() }), [update]);

  useEffect(() => { void loadSessionList(); }, [loadSessionList]);
  useEffect(() => () => {
    pollingRef.current = false;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    queueRef.current?.dispose();
    transportRef.current?.dispose?.();
  }, []);

  const recordEvent = useCallback(async (event: Omit<RecordingEvent, "sessionId" | "timestamp">) => {
    const session = activeSessionRef.current;
    if (session) await addEvent({ ...event, sessionId: session.id, timestamp: Date.now() });
  }, []);

  const flushRecording = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session || recordingBufferRef.current.length === 0) return;
    if (flushingRef.current) return flushPromiseRef.current;
    flushingRef.current = true;
    const batch = recordingBufferRef.current.splice(0);
    const operation = (async () => {
      try {
        await appendSamples(session.id, batch);
        await putSession(session);
      } catch (error) {
        update({ lastError: `Recording: ${toErrorMessage(error)}` });
      } finally {
        flushingRef.current = false;
        if (activeSessionRef.current && recordingBufferRef.current.length > 0) void flushRecording();
      }
    })();
    flushPromiseRef.current = operation;
    return operation;
  }, [update]);

  useEffect(() => {
    const onVisibilityChange = () => { if (document.visibilityState !== "visible") void flushRecording(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [flushRecording]);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    pollRunRef.current += 1;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = undefined;
  }, []);

  const refreshPd = useCallback(async (protocol: WeActProtocol, input: InputType): Promise<void> => {
    if (input !== "pd") {
      pdLoadedRef.current = false;
      update({ pd: undefined, currentPdo: undefined });
      return;
    }
    const counts = await protocol.pdoCounts();
    const fixed = counts.fixed ? await protocol.fixedPdos() : [];
    const pps = counts.pps ? await protocol.ppsPdos(counts.fixed) : [];
    const avs = counts.avs ? await protocol.avsPdos(counts.fixed, counts.pps) : [];
    const currentPdo = await protocol.currentPdo2();
    pdLoadedRef.current = true;
    update({ pd: { counts, fixed, pps, avs }, currentPdo });
  }, [update]);

  const poll = useCallback(async (run = pollRunRef.current): Promise<void> => {
    if (!pollingRef.current || run !== pollRunRef.current || !protocolRef.current) return;
    const protocol = protocolRef.current;
    const now = Date.now();
    try {
      const measurement = await protocol.outputData();
      const sample: ChartSample = { ...measurement, timestamp: now, elapsedMs: activeSessionRef.current ? now - activeSessionRef.current.startedAt : 0 };
      setState((previous) => {
        const lowerBound = now - chartWindowRef.current * 1000;
        const samples = [...previous.samples, sample].filter((item) => item.timestamp >= lowerBound).slice(-10_000);
        const session = activeSessionRef.current;
        if (session) session.sampleCount += 1;
        return { ...previous, measurement, samples, activeSession: session ? { ...session } : undefined, lastError: undefined, diagnostics: queueRef.current?.stats ?? previous.diagnostics, transportStats: transportRef.current?.stats };
      });
      if (activeSessionRef.current) {
        recordingBufferRef.current.push(sample);
        if (recordingBufferRef.current.length >= 25) void flushRecording();
      }
      if (now - metadataAtRef.current >= 1000) {
        metadataAtRef.current = now;
        const maximums = await protocol.outputDataMax();
        const energy = await protocol.mahMwh();
        const uptimeSeconds = await protocol.uptime();
        update({ maximums, energy, uptimeSeconds });
      }
      if (now - inputAtRef.current >= 2000) {
        inputAtRef.current = now;
        const inputType = await protocol.inputType();
        update({ inputType });
        if (inputType === "pd" && !pdLoadedRef.current) await refreshPd(protocol, inputType);
        if (inputType !== "pd") pdLoadedRef.current = false;
      }
    } catch (error) {
      update({ lastError: toErrorMessage(error), diagnostics: queueRef.current?.stats ?? initialState.diagnostics });
    } finally {
      if (pollingRef.current && run === pollRunRef.current) {
        pollTimerRef.current = setTimeout(() => void poll(run), Math.max(50, 1000 / pollRateRef.current));
      }
    }
  }, [flushRecording, refreshPd, update]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = true;
    const run = ++pollRunRef.current;
    void poll(run);
  }, [poll, stopPolling]);

  const disconnect = useCallback(async () => {
    stopPolling();
    const recording = activeSessionRef.current;
    if (recording) {
      activeSessionRef.current = undefined;
      await flushPromiseRef.current;
      const finalBatch = recordingBufferRef.current.splice(0);
      if (finalBatch.length) await appendSamples(recording.id, finalBatch);
      const completed: RecordingSession = { ...recording, endedAt: Date.now(), finalEnergy: state.energy };
      await putSession(completed);
      await addEvent({ sessionId: completed.id, timestamp: completed.endedAt!, type: "connection", message: "Recording ended on disconnect" });
      await loadSessionList();
    } else {
      await flushRecording();
    }
    unlistenStateRef.current?.();
    unlistenStateRef.current = undefined;
    queueRef.current?.dispose();
    queueRef.current = undefined;
    protocolRef.current = undefined;
    pdLoadedRef.current = false;
    transportRef.current?.disconnect();
    transportRef.current?.dispose?.();
    transportRef.current = undefined;
    update({ status: "disconnected", deviceName: undefined, deviceId: undefined, isDemo: false, pd: undefined, currentPdo: undefined, activeSession: undefined });
  }, [flushRecording, loadSessionList, state.energy, stopPolling, update]);

  const connect = useCallback(async (demo = false) => {
    await disconnect();
    update({ status: "connecting", lastError: undefined, notice: undefined, samples: [], logs: [], isDemo: demo });
    pdLoadedRef.current = false;
    const transport: RuntimeTransport = demo ? new MockPowerMonitorTransport() : new BrowserBleTransport();
    transportRef.current = transport;
    unlistenStateRef.current = transport.onState?.((status, error) => {
      update({ status, lastError: error?.message });
      if (status === "disconnected") stopPolling();
    });
    try {
      await transport.connect();
      const queue = new WeActCommandQueue(transport, {
        // PowerMonitor uses CRC-8 framing on its physical 4-pin UART.
        // The 0x0A terminator is the direct USB CDC framing used by the
        // desktop client. Demo transport intentionally keeps USB framing.
        useCrc: !demo,
        onLog: (entry) => setState((previous) => ({ ...previous, logs: [...previous.logs, entry].slice(-500) }))
      });
      const protocol = new WeActProtocol(queue);
      queueRef.current = queue;
      protocolRef.current = protocol;
      update({ status: "connected", deviceName: transport.name, deviceId: transport.id, isDemo: demo });

      const identity = await protocol.deviceIdentity();
      const lcdPanel = await protocol.lcdPanel();
      const inputType = await protocol.inputType();
      const maximums = await protocol.outputDataMax();
      const energy = await protocol.mahMwh();
      const uptimeSeconds = await protocol.uptime();
      update({ deviceInfo: { ...identity, lcdPanel }, inputType, maximums, energy, uptimeSeconds, notice: demo ? "Demo mode is active" : undefined });
      await refreshPd(protocol, inputType);
      await recordEvent({ type: "connection", message: "Connected" });
      startPolling();
    } catch (error) {
      const message = toErrorMessage(error);
      stopPolling();
      queueRef.current?.dispose();
      queueRef.current = undefined;
      protocolRef.current = undefined;
      transport.disconnect();
      update({ status: "error", lastError: message });
    }
  }, [disconnect, recordEvent, refreshPd, startPolling, stopPolling, update]);

  const setPollRateHz = useCallback((value: number) => {
    const pollRateHz = Math.min(20, Math.max(1, Math.round(value)));
    pollRateRef.current = pollRateHz;
    update({ pollRateHz });
  }, [update]);
  const setChartWindowSeconds = useCallback((value: number) => {
    const chartWindowSeconds = Math.min(3600, Math.max(10, Math.round(value)));
    chartWindowRef.current = chartWindowSeconds;
    update({ chartWindowSeconds });
  }, [update]);

  const startRecording = useCallback(async (note: string) => {
    if (!protocolRef.current || activeSessionRef.current) return;
    const session: RecordingSession = {
      id: uuid(), startedAt: Date.now(), deviceName: transportRef.current?.name ?? "Unknown device",
      deviceInfo: state.deviceInfo, inputType: state.inputType, sampleRateHz: pollRateRef.current,
      note: note.trim(), sampleCount: 0
    };
    activeSessionRef.current = session;
    await putSession(session);
    await addEvent({ sessionId: session.id, timestamp: session.startedAt, type: "recording", message: "Recording started" });
    update({ activeSession: session });
    await loadSessionList();
  }, [loadSessionList, state.deviceInfo, state.inputType, update]);

  const stopRecording = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) return;
    activeSessionRef.current = undefined;
    await flushPromiseRef.current;
    const finalBatch = recordingBufferRef.current.splice(0);
    if (finalBatch.length) await appendSamples(session.id, finalBatch);
    const completed: RecordingSession = { ...session, endedAt: Date.now(), finalEnergy: state.energy };
    await putSession(completed);
    await addEvent({ sessionId: completed.id, timestamp: completed.endedAt!, type: "recording", message: "Recording stopped" });
    update({ activeSession: undefined });
    await loadSessionList();
  }, [flushRecording, loadSessionList, state.energy, update]);

  const withProtocol = useCallback(async (action: (protocol: WeActProtocol) => Promise<void>, event?: Omit<RecordingEvent, "sessionId" | "timestamp">) => {
    if (!protocolRef.current) throw new Error("Device is not connected");
    await action(protocolRef.current);
    if (event) await recordEvent(event);
    update({ notice: "Command sent to device", diagnostics: queueRef.current?.stats ?? initialState.diagnostics });
  }, [recordEvent, update]);

  const resetMaximums = useCallback(() => withProtocol((protocol) => protocol.resetMaximums(), { type: "configuration", message: "Maximum values reset" }), [withProtocol]);
  const setPdo = useCallback(async (id: number, voltageMv: number, currentMa: number) => {
    // A PD request makes the PowerMonitor renegotiate its input contract.
    // Do not interleave periodic UART reads with that transition.
    stopPolling();
    try {
      await withProtocol((protocol) => protocol.setPdo2(id, voltageMv, currentMa), { type: "pd", message: "PDO requested", details: { id, voltageMv, currentMa } });
      await wait(1_300);
      if (protocolRef.current) {
        const currentPdo = await protocolRef.current.currentPdo2();
        update({ currentPdo });
      }
    } catch (error) {
      update({ lastError: toErrorMessage(error) });
      throw error;
    } finally {
      if (protocolRef.current) startPolling();
    }
  }, [startPolling, stopPolling, update, withProtocol]);
  const restart = useCallback(() => withProtocol((protocol) => protocol.restart(), { type: "configuration", message: "Device restart requested" }), [withProtocol]);
  const factoryReset = useCallback(() => withProtocol((protocol) => protocol.factoryReset(), { type: "configuration", message: "Factory reset requested" }), [withProtocol]);

  const refreshAdvanced = useCallback(async () => {
    if (!protocolRef.current) return;
    const [rshunt, ina, offsets] = await Promise.all([protocolRef.current.currentRshunt(), protocolRef.current.ina226Config(), protocolRef.current.currentOffsets()]);
    update({ advanced: { rshunt, ina, offsets } });
  }, [update]);
  const saveRshunt = useCallback((value: number) => withProtocol((protocol) => protocol.setCurrentRshunt(value), { type: "configuration", message: "Rshunt set", details: { value } }), [withProtocol]);
  const saveIna = useCallback((config: Omit<Ina226Config, "registerValue">) => withProtocol((protocol) => protocol.setIna226Config(config), { type: "configuration", message: "INA226 configuration set" }), [withProtocol]);
  const saveOffsets = useCallback((offsets: CurrentOffsets) => withProtocol((protocol) => protocol.setCurrentOffsets(offsets), { type: "configuration", message: "Current offsets set" }), [withProtocol]);

  const clearLogs = useCallback(() => update({ logs: [] }), [update]);
  const loadSession = useCallback(async (id: string) => {
    const session = (await listSessions()).find((candidate) => candidate.id === id);
    if (!session) throw new Error("Session not found");
    const [samples, events] = await Promise.all([getSamples(id), getEvents(id)]);
    return { session, samples, events };
  }, []);
  const deleteSession = useCallback(async (id: string) => { await removeSession(id); await loadSessionList(); }, [loadSessionList]);
  const importArchive = useCallback(async (archive: SessionArchive) => {
    const id = uuid();
    const session: RecordingSession = { ...archive.session, id, imported: true, sampleCount: archive.samples.length };
    await putSession(session);
    await appendSamples(id, archive.samples.map((sample) => ({ ...sample })));
    await Promise.all(archive.events.map((event) => addEvent({ ...event, id: undefined, sessionId: id })));
    await loadSessionList();
    update({ notice: "Session imported" });
  }, [loadSessionList, update]);
  const dismissMessage = useCallback(() => update({ lastError: undefined, notice: undefined }), [update]);

  const value = useMemo(() => ({ ...state, connect, disconnect, setPollRateHz, setChartWindowSeconds, startRecording, stopRecording, resetMaximums, setPdo, refreshAdvanced, saveRshunt, saveIna, saveOffsets, restart, factoryReset, clearLogs, loadSession, deleteSession, importArchive, dismissMessage }), [state, connect, disconnect, setPollRateHz, setChartWindowSeconds, startRecording, stopRecording, resetMaximums, setPdo, refreshAdvanced, saveRshunt, saveIna, saveOffsets, restart, factoryReset, clearLogs, loadSession, deleteSession, importArchive, dismissMessage]);
  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>;
};

export const usePowerMonitor = (): MonitorState & MonitorActions => {
  const context = useContext(MonitorContext);
  if (!context) throw new Error("usePowerMonitor must be used inside PowerMonitorProvider");
  return context;
};
