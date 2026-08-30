import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { MeasurementChart } from "./components/MeasurementChart";
import { archiveSession, downloadText, parseArchive, parseCsvSession, samplesToCsv, samplesToPlotlyJson } from "./recording/archive";
import { languages, type Language } from "./i18n";
import { INA_AVERAGING_VALUES, INA_CONVERSION_TIMES } from "./weact/protocol";
import { describeProtocolLog } from "./weact/commandQueue";
import type { CurrentOffsets } from "./weact/types";
import { usePowerMonitor } from "./app/PowerMonitorProvider";

const decimal = (value: number | undefined, digits = 3): string => value === undefined ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const duration = (seconds: number | undefined): string => {
  if (seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
};
const filenameDate = (timestamp: number): string => new Date(timestamp).toISOString().replaceAll(/[:.]/gu, "-");
const INTRODUCTION_STORAGE_KEY = "weact-power-monitor-introduction-seen-v1";
const introductionWasSeen = (): boolean => {
  try {
    return localStorage.getItem(INTRODUCTION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

type PdoKind = "fixed" | "pps" | "avs";
interface SelectedPdo {
  id: number;
  kind: PdoKind;
  voltageMv: number;
  currentMa: number;
  minVoltageMv: number;
  maxVoltageMv: number;
  maxCurrentMa: number;
  maxPowerW?: number;
}

const maximumRequestCurrent = (pdo: SelectedPdo): number => pdo.maxPowerW === undefined
  ? pdo.maxCurrentMa
  : Math.min(pdo.maxCurrentMa, Math.floor((pdo.maxPowerW * 1_000_000) / Math.max(1, pdo.voltageMv)));

const Metric = ({ label, value, unit, accent }: { label: string; value: string; unit: string; accent: string }) => <article className={`metric ${accent}`}>
  <span>{label}</span><strong>{value}<small>{unit}</small></strong>
</article>;

export default function App(): ReactElement {
  const monitor = usePowerMonitor();
  const { t, i18n } = useTranslation();
  const [recordNote, setRecordNote] = useState("");
  const [selectedPdo, setSelectedPdo] = useState<SelectedPdo>();
  const [pdoApplying, setPdoApplying] = useState(false);
  const [activeTab, setActiveTab] = useState<"monitor" | "system" | "diagnostics" | "protocol">("monitor");
  const [rshunt, setRshunt] = useState("");
  const [offsets, setOffsets] = useState<CurrentOffsets>();
  const [introductionOpen, setIntroductionOpen] = useState(() => !introductionWasSeen());
  const importInput = useRef<HTMLInputElement>(null);
  const connected = monitor.status === "connected";

  useEffect(() => {
    if (monitor.advanced.rshunt !== undefined) setRshunt(String(monitor.advanced.rshunt));
    if (monitor.advanced.offsets) setOffsets(monitor.advanced.offsets);
  }, [monitor.advanced]);

  const changeLanguage = async (language: Language) => {
    await i18n.changeLanguage(language);
    localStorage.setItem("weact-language", language);
  };

  const closeIntroduction = () => {
    setIntroductionOpen(false);
    try {
      localStorage.setItem(INTRODUCTION_STORAGE_KEY, "1");
    } catch {
      // The introduction stays available through the header if storage is disabled.
    }
  };

  const choosePdo = (candidate: SelectedPdo) => setSelectedPdo(candidate);
  const applyPdo = async () => {
    if (!selectedPdo) return;
    const maxCurrentMa = maximumRequestCurrent(selectedPdo);
    if (!Number.isInteger(selectedPdo.voltageMv) || selectedPdo.voltageMv < selectedPdo.minVoltageMv || selectedPdo.voltageMv > selectedPdo.maxVoltageMv) {
      throw new Error("Requested voltage is outside the advertised PDO range");
    }
    if (!Number.isInteger(selectedPdo.currentMa) || selectedPdo.currentMa < 0 || selectedPdo.currentMa > maxCurrentMa) {
      throw new Error("Requested current exceeds the advertised PDO limit");
    }
    if (selectedPdo.voltageMv > (monitor.currentPdo?.voltageMv ?? 0) && !window.confirm(`${t("confirmPd")}\n\n${t("pdWarning")}`)) return;
    setPdoApplying(true);
    try {
      await monitor.setPdo(selectedPdo.id, selectedPdo.voltageMv, selectedPdo.currentMa);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setPdoApplying(false);
    }
  };

  const exportSession = async (id: string, kind: "csv" | "json" | "plotly") => {
    const { session, samples, events } = await monitor.loadSession(id);
    const base = `weact-${filenameDate(session.startedAt)}`;
    if (kind === "csv") downloadText(`${base}.csv`, "text/csv;charset=utf-8", samplesToCsv(samples));
    if (kind === "json") downloadText(`${base}.json`, "application/json", JSON.stringify(archiveSession(session, samples, events), null, 2));
    if (kind === "plotly") downloadText(`${base}.plotly.json`, "application/json", JSON.stringify(samplesToPlotlyJson(session, samples), null, 2));
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const contents = await file.text();
      await monitor.importArchive(file.name.toLowerCase().endsWith(".csv") ? parseCsvSession(contents) : parseArchive(JSON.parse(contents)));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  const loadAdvanced = async () => {
    await monitor.refreshAdvanced();
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">ϟ</div><div><h1>{t("appName")}</h1><p>{t("appSubtitle")}</p></div></div>
      <div className="header-actions">
        <button type="button" className="help-button" title={t("aboutApp")} aria-label={t("aboutApp")} onClick={() => setIntroductionOpen(true)}>?</button>
        <select aria-label="Language" value={i18n.language.startsWith("uk") ? "uk" : "en"} onChange={(event) => void changeLanguage(event.target.value as Language)}>
          {languages.map((language) => <option key={language} value={language}>{language === "uk" ? "Українська" : "English"}</option>)}
        </select>
        <span className={`connection-chip ${monitor.status}`}><i />{monitor.status === "connected" ? t("connected") : monitor.status === "connecting" ? t("connecting") : t("disconnected")}</span>
        {connected ? <button type="button" className="quiet-button" onClick={() => void monitor.disconnect()}>{t("disconnect")}</button> : <><button type="button" className="primary-button" disabled={monitor.status === "connecting"} onClick={() => void monitor.connect(false)}>{t("connect")}</button><button type="button" className="quiet-button" disabled={monitor.status === "connecting"} onClick={() => void monitor.connect(true)}>{t("demo")}</button></>}
      </div>
    </header>

    {(monitor.lastError || monitor.notice) && <div className={`notice ${monitor.lastError ? "error" : "success"}`} role="status">
      <span>{monitor.lastError ?? monitor.notice}</span><button type="button" onClick={monitor.dismissMessage}>×</button>
    </div>}

    <nav className="app-tabs" aria-label="Application sections">
      <button type="button" className={activeTab === "monitor" ? "active" : ""} onClick={() => setActiveTab("monitor")}>{t("monitoring")}</button>
      <button type="button" className={activeTab === "system" ? "active" : ""} onClick={() => { setActiveTab("system"); void loadAdvanced(); }}>System</button>
      <button type="button" className={activeTab === "diagnostics" ? "active" : ""} onClick={() => setActiveTab("diagnostics")}>{t("diagnostics")}</button>
      <button type="button" className={activeTab === "protocol" ? "active" : ""} onClick={() => setActiveTab("protocol")}>{t("rawConsole")}</button>
    </nav>

    {activeTab === "monitor" && <>
      <section className="settings-strip compact-controls panel">
        <label>{t("sampleRate")}<select value={monitor.pollRateHz} onChange={(event) => monitor.setPollRateHz(Number(event.target.value))}>{[1, 2, 5, 10, 20].map((value) => <option key={value} value={value}>{value} Hz</option>)}</select></label>
        <label>{t("chartWindow")}<select value={monitor.chartWindowSeconds} onChange={(event) => monitor.setChartWindowSeconds(Number(event.target.value))}>{[30, 60, 300, 900, 3600].map((value) => <option key={value} value={value}>{value < 60 ? `${value} ${t("seconds")}` : `${value / 60} ${t("minutes")}`}</option>)}</select></label>
        <div className="device-inline"><span>{t("input")}</span><strong>{monitor.inputType?.toUpperCase() ?? "—"}</strong></div>
        <div className="device-inline"><span>{t("uptime")}</span><strong>{duration(monitor.uptimeSeconds)}</strong></div>
        <div className="toolbar recording-inline">{monitor.activeSession ? <><span className="recording-status">● {monitor.activeSession.sampleCount}</span><button type="button" className="danger-button" onClick={() => void monitor.stopRecording()}>{t("stopRecording")}</button></> : <><input aria-label={t("note")} value={recordNote} onChange={(event) => setRecordNote(event.target.value)} placeholder={t("note")} maxLength={240} /><button type="button" className="primary-button" disabled={!connected} onClick={() => void monitor.startRecording(recordNote)}>{t("startRecording")}</button></>}</div>
        <div className="maximum-inline"><span>{t("maximums")}</span><strong>{decimal(monitor.maximums?.voltageV)} V · {decimal(monitor.maximums?.currentA)} A · {decimal(monitor.maximums?.powerW)} W</strong><button type="button" className="quiet-button" disabled={!connected} onClick={() => void monitor.resetMaximums()}>{t("resetMaximums")}</button></div>
      </section>

      <section className="monitor-workspace">
        <aside className="metrics compact-metrics" aria-label="Live measurements">
          <Metric label={t("voltage")} value={decimal(monitor.measurement?.voltageV)} unit="V" accent="teal" />
          <Metric label={t("current")} value={decimal(monitor.measurement?.currentA)} unit="A" accent="violet" />
          <Metric label={t("power")} value={decimal(monitor.measurement?.powerW)} unit="W" accent="amber" />
          <Metric label={t("capacity")} value={decimal(monitor.energy?.mah, 0)} unit="mAh" accent="blue" />
          <Metric label={t("energy")} value={decimal(monitor.energy?.mwh, 0)} unit="mWh" accent="blue" />
        </aside>
        <MeasurementChart samples={monitor.samples} rollingSeconds={monitor.chartWindowSeconds} />
      </section>

      <section className="two-column">
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("pdControl")}</p><h2>{t("currentContract")}</h2></div></div>
        <div className="contract"><strong>{monitor.currentPdo ? `${(monitor.currentPdo.voltageMv / 1000).toFixed(2)} V` : "—"}</strong><span>{monitor.currentPdo ? `${(monitor.currentPdo.currentMa / 1000).toFixed(2)} A · PDO ${monitor.currentPdo.id}` : t("noData")}</span></div>
        {monitor.pd ? <><p className="muted">{t("availablePdos")}</p><div className="pdo-grid">
          {monitor.pd.fixed.map((pdo) => <button key={`fixed-${pdo.id}`} className={selectedPdo?.id === pdo.id ? "pdo selected" : "pdo"} onClick={() => choosePdo({ id: pdo.id, kind: "fixed", voltageMv: pdo.voltageMv, currentMa: pdo.currentMa, minVoltageMv: pdo.voltageMv, maxVoltageMv: pdo.voltageMv, maxCurrentMa: pdo.currentMa })}><small>{t("pdoFixed")} · {pdo.id}</small>{pdo.voltageMv / 1000} V <em>{pdo.currentMa / 1000} A</em></button>)}
          {monitor.pd.pps.map((pdo) => <button key={`pps-${pdo.id}`} className={selectedPdo?.id === pdo.id ? "pdo selected" : "pdo"} onClick={() => choosePdo({ id: pdo.id, kind: "pps", voltageMv: pdo.maxVoltageMv, currentMa: pdo.maxCurrentMa, minVoltageMv: pdo.minVoltageMv, maxVoltageMv: pdo.maxVoltageMv, maxCurrentMa: pdo.maxCurrentMa })}><small>{t("pdoPps")} · {pdo.id}</small>{pdo.minVoltageMv / 1000}–{pdo.maxVoltageMv / 1000} V <em>{pdo.maxCurrentMa / 1000} A</em></button>)}
          {monitor.pd.avs.map((pdo) => <button key={`avs-${pdo.id}`} className={selectedPdo?.id === pdo.id ? "pdo selected" : "pdo"} onClick={() => choosePdo({ id: pdo.id, kind: "avs", voltageMv: pdo.maxVoltageMv, currentMa: Math.floor((pdo.maxPowerW * 1_000) / (pdo.maxVoltageMv / 1_000)), minVoltageMv: pdo.minVoltageMv, maxVoltageMv: pdo.maxVoltageMv, maxCurrentMa: Number.MAX_SAFE_INTEGER, maxPowerW: pdo.maxPowerW })}><small>{t("pdoAvs")} · {pdo.id}</small>{pdo.minVoltageMv / 1000}–{pdo.maxVoltageMv / 1000} V <em>{pdo.maxPowerW} W</em></button>)}
        </div>{selectedPdo && selectedPdo.kind !== "fixed" && <PdoRequestForm value={selectedPdo} onChange={setSelectedPdo} />}<button type="button" className="primary-button top-space" disabled={!selectedPdo || pdoApplying} onClick={() => void applyPdo()}>{pdoApplying ? t("loading") : selectedPdo ? `${selectedPdo.kind === "pps" ? "Apply PPS" : t("apply")} · ${(selectedPdo.voltageMv / 1_000).toFixed(2)} V` : t("apply")}</button></> : <p className="muted">{monitor.inputType === "pd" ? t("loading") : "PD is unavailable for the current input."}</p>}
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("device")}</p><h2>{monitor.deviceInfo?.model ?? "—"}</h2></div></div>
        <dl className="device-details"><dt>Firmware</dt><dd>{monitor.deviceInfo?.firmware ?? "—"}</dd><dt>Serial</dt><dd>{monitor.deviceInfo?.serial ?? "—"}</dd><dt>LCD</dt><dd>{monitor.deviceInfo?.lcdPanel ?? "—"}</dd><dt>BLE ID</dt><dd>{monitor.deviceId ?? "—"}</dd></dl>
      </section>
      </section>

      <section className="panel sessions-panel">
        <div className="panel-heading"><div><p className="eyebrow">IndexedDB</p><h2>{t("sessions")}</h2></div><div className="toolbar"><input ref={importInput} className="hidden-input" type="file" accept="application/json,.json,text/csv,.csv" onChange={(event) => void importFile(event.target.files?.[0])} /><button type="button" className="quiet-button" onClick={() => importInput.current?.click()}>{t("import")}</button></div></div>
        {monitor.sessions.length === 0 ? <p className="muted">{t("noSessions")}</p> : <div className="session-list">{monitor.sessions.map((session) => <article className="session-row" key={session.id}><div><strong>{new Date(session.startedAt).toLocaleString()}</strong><span>{session.sampleCount} samples · {session.deviceName}{session.note ? ` · ${session.note}` : ""}</span></div><div className="toolbar"><button type="button" className="quiet-button" onClick={() => void exportSession(session.id, "csv")}>{t("exportCsv")}</button><button type="button" className="quiet-button" onClick={() => void exportSession(session.id, "json")}>{t("exportJson")}</button><button type="button" className="quiet-button" onClick={() => void exportSession(session.id, "plotly")}>Plotly</button><button type="button" className="icon-button" title={t("delete")} onClick={() => { if (window.confirm(t("delete"))) void monitor.deleteSession(session.id); }}>×</button></div></article>)}</div>}
      </section>
    </>}

    {activeTab === "system" && <section className="panel tab-content system-panel">
      <div className="panel-heading"><div><p className="eyebrow">System</p><h2>{t("advanced")}</h2></div></div>
      <div className="advanced-content">
        <p className="uart-note"><strong>UART:</strong> {t("uartRequirement")}</p>
        <div className="form-row"><label>{t("rshunt")} (mΩ)<input type="number" min="0" max="255" value={rshunt || monitor.advanced.rshunt || ""} onChange={(event) => setRshunt(event.target.value)} /></label><button type="button" className="secondary-button" disabled={!connected || !rshunt} onClick={() => void monitor.saveRshunt(Number(rshunt))}>{t("save")}</button></div>
        {monitor.advanced.ina && <InaForm onSave={monitor.saveIna} initial={monitor.advanced.ina} disabled={!connected} />}
        {offsets && <OffsetsForm value={offsets} onChange={setOffsets} onSave={() => void monitor.saveOffsets(offsets)} disabled={!connected} />}
        <div className="danger-zone"><button type="button" className="secondary-button" disabled={!connected} onClick={() => void monitor.restart()}>{t("restart")}</button><button type="button" className="danger-button" disabled={!connected} onClick={() => { if (window.confirm(t("factoryReset"))) void monitor.factoryReset(); }}>{t("factoryReset")}</button></div>
      </div>
    </section>}

    {activeTab === "diagnostics" && <section className="panel tab-content diagnostics"><div className="panel-heading"><div><p className="eyebrow">BLE / UART</p><h2>{t("diagnostics")}</h2></div></div><div className="diagnostic-grid"><div><span>Requests</span><strong>{monitor.diagnostics.requests}</strong></div><div><span>Responses</span><strong>{monitor.diagnostics.responses}</strong></div><div><span>Timeouts / retries</span><strong>{monitor.diagnostics.timeouts} / {monitor.diagnostics.retries}</strong></div><div><span>Parser errors</span><strong>{monitor.diagnostics.parserErrors}</strong></div><div><span>BLE notifications</span><strong>{monitor.transportStats?.notifications ?? 0}</strong></div><div><span>RX / TX bytes</span><strong>{monitor.transportStats ? `${monitor.transportStats.rxBytes} / ${monitor.transportStats.txBytes}` : "—"}</strong></div></div></section>}

    {activeTab === "protocol" && <section className="panel tab-content raw-console"><div className="panel-heading"><div><p className="eyebrow">UART</p><h2>{t("rawConsole")}</h2></div></div><div className="console-heading"><span>{monitor.logs.length} entries</span><button type="button" className="quiet-button" onClick={monitor.clearLogs}>{t("clear")}</button></div><pre>{monitor.logs.length ? monitor.logs.map(describeProtocolLog).join("\n") : t("noData")}</pre></section>}

    {introductionOpen && <IntroductionModal
      language={i18n.language.startsWith("uk") ? "uk" : "en"}
      onLanguageChange={changeLanguage}
      onClose={closeIntroduction}
    />}
  </main>;
}

const IntroductionModal = ({ language, onLanguageChange, onClose }: { language: Language; onLanguageChange: (language: Language) => Promise<void>; onClose: () => void }): ReactElement => {
  const { t } = useTranslation();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="intro-modal" role="dialog" aria-modal="true" aria-labelledby="introduction-title">
      <header className="intro-modal-header">
        <h2 id="introduction-title">{t("aboutTitle")}</h2>
        <div className="modal-header-actions">
          <div className="modal-language-switch" role="group" aria-label={t("language")}>
            {languages.map((item) => <button key={item} type="button" className={language === item ? "active" : ""} aria-pressed={language === item} onClick={() => void onLanguageChange(item)}>{item.toUpperCase()}</button>)}
          </div>
          <button type="button" className="modal-close-button" aria-label={t("close")} onClick={onClose}>×</button>
        </div>
      </header>
      <div className="intro-modal-body">
        <img className="intro-device-image" src="/power-monitor-v1.png" alt={t("devicePhotoAlt")} />
        <div className="intro-copy">
          <p>{t("aboutIntro")}</p>
          <p>{t("aboutMeasures")}</p>
          <p>{t("aboutBridge")}</p>
          <div className="intro-links">
            <a className="primary-button" href="https://s.click.aliexpress.com/e/_c4EU8vAP" target="_blank" rel="noreferrer">{t("buyDevice")}</a>
            <a className="quiet-button" href="https://github.com/dmytr0/weact_power_monitor/tree/master/3D%20Models" target="_blank" rel="noreferrer">{t("caseModels")}</a>
          </div>
        </div>
      </div>
    </section>
  </div>;
};

const PdoRequestForm = ({ value, onChange }: { value: SelectedPdo; onChange: (value: SelectedPdo) => void }): ReactElement => {
  const currentLimitMa = maximumRequestCurrent(value);
  const updateVoltage = (voltageV: number) => {
    const voltageMv = Math.round(voltageV * 1_000);
    const next = { ...value, voltageMv };
    onChange({ ...next, currentMa: Math.min(next.currentMa, maximumRequestCurrent(next)) });
  };
  const updateCurrent = (currentA: number) => onChange({ ...value, currentMa: Math.round(currentA * 1_000) });
  return <div className="pdo-request-form">
    <strong>{value.kind === "pps" ? "PPS request" : "AVS request"} · PDO {value.id}</strong>
    <span>{(value.minVoltageMv / 1_000).toFixed(2)}–{(value.maxVoltageMv / 1_000).toFixed(2)} V · max {(currentLimitMa / 1_000).toFixed(2)} A{value.maxPowerW !== undefined ? ` · ${value.maxPowerW} W` : ""}</span>
    <div className="form-row">
      <label>Voltage (V)<input type="number" step="0.001" min={value.minVoltageMv / 1_000} max={value.maxVoltageMv / 1_000} value={value.voltageMv / 1_000} onChange={(event) => updateVoltage(Number(event.target.value))} /></label>
      <label>Current (A)<input type="number" step="0.001" min="0" max={currentLimitMa / 1_000} value={value.currentMa / 1_000} onChange={(event) => updateCurrent(Number(event.target.value))} /></label>
    </div>
  </div>;
};

const InaForm = ({ initial, onSave, disabled }: { initial: { currentLsbTenthsMa: number; shuntConversionIndex: number; busConversionIndex: number; averagingIndex: number }; onSave: (config: { currentLsbTenthsMa: number; shuntConversionIndex: number; busConversionIndex: number; averagingIndex: number }) => Promise<void>; disabled: boolean }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  return <div className="ina-form"><h3>INA226</h3><div className="four-fields"><label>{t("currentLsb")} (0.1 mA)<input type="number" min="1" max="10" value={value.currentLsbTenthsMa} onChange={(event) => setValue({ ...value, currentLsbTenthsMa: Number(event.target.value) })} /></label><label>{t("shuntConversion")}<select value={value.shuntConversionIndex} onChange={(event) => setValue({ ...value, shuntConversionIndex: Number(event.target.value) })}>{INA_CONVERSION_TIMES.map((item, index) => <option key={item} value={index}>{item}</option>)}</select></label><label>{t("busConversion")}<select value={value.busConversionIndex} onChange={(event) => setValue({ ...value, busConversionIndex: Number(event.target.value) })}>{INA_CONVERSION_TIMES.map((item, index) => <option key={item} value={index}>{item}</option>)}</select></label><label>{t("averaging")}<select value={value.averagingIndex} onChange={(event) => setValue({ ...value, averagingIndex: Number(event.target.value) })}>{INA_AVERAGING_VALUES.map((item, index) => <option key={item} value={index}>{item}</option>)}</select></label></div><button type="button" className="secondary-button" disabled={disabled} onClick={() => void onSave(value)}>{t("save")}</button></div>;
};

const OffsetsForm = ({ value, onChange, onSave, disabled }: { value: CurrentOffsets; onChange: (value: CurrentOffsets) => void; onSave: () => void; disabled: boolean }) => {
  const { t } = useTranslation();
  const fields: Array<["first" | "second", string]> = [["first", "Point 1 displayed / actual"], ["second", "Point 2 displayed / actual"]];
  return <div className="offsets-form"><h3>{t("calibration")}</h3>{fields.map(([key, label]) => <label key={key}>{label}<span className="inline-inputs"><input type="number" value={value[key].displayedTenthsMa} onChange={(event) => onChange({ ...value, [key]: { ...value[key], displayedTenthsMa: Number(event.target.value) } })} /><input type="number" value={value[key].actualTenthsMa} onChange={(event) => onChange({ ...value, [key]: { ...value[key], actualTenthsMa: Number(event.target.value) } })} /></span></label>)}<label>Zero offset (0.1 mA)<input type="number" min="-15" max="15" value={value.zeroOffsetTenthsMa} onChange={(event) => onChange({ ...value, zeroOffsetTenthsMa: Number(event.target.value) })} /></label><button type="button" className="secondary-button" disabled={disabled} onClick={onSave}>{t("save")}</button></div>;
};
