import { useRef, useState, type ReactElement } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { useTranslation } from "react-i18next";
import type { ChartSample } from "../recording/types";
import { downloadText } from "../recording/archive";

interface MeasurementChartProps {
  samples: ChartSample[];
  rollingSeconds: number;
  theme: "light" | "dark";
}

// The factory build prevents react-plotly.js from bundling a second copy of Plotly.
const Plot = createPlotlyComponent(Plotly);

const traceNames = ["voltage", "current", "power"] as const;
type TraceName = (typeof traceNames)[number];

export const MeasurementChart = ({ samples, rollingSeconds, theme }: MeasurementChartProps): ReactElement => {
  const { t } = useTranslation();
  const plotRef = useRef<{ el?: HTMLElement } | null>(null);
  const [frozenSamples, setFrozenSamples] = useState<ChartSample[] | undefined>();
  const [traceVisible, setTraceVisible] = useState<Record<TraceName, boolean>>({ voltage: true, current: true, power: true });
  const displayedSamples = frozenSamples ?? samples;
  const hasSamples = displayedSamples.length > 0;
  const times = displayedSamples.map((sample) => new Date(sample.timestamp));
  const colors = theme === "dark"
    ? { voltage: "#b5c492", current: "#99ad6e", power: "#e8ecdb", surface: "#363f28", ink: "#e8ecdb", grid: "#4b5932" }
    : { voltage: "#60723e", current: "#7c9151", power: "#3e482c", surface: "#ffffff", ink: "#232b18", grid: "#d2dbbb" };

  const exportImage = async (format: "png" | "svg") => {
    const target = plotRef.current?.el;
    if (!target) return;
    const url = await Plotly.toImage(target, { format, width: 1500, height: 680, scale: 2 });
    const link = document.createElement("a");
    link.href = url;
    link.download = `weact-power-monitor-${Date.now()}.${format}`;
    link.click();
  };

  const exportData = () => downloadText(
    `weact-power-monitor-live-${Date.now()}.json`,
    "application/json",
    JSON.stringify(samples, null, 2)
  );

  const rememberTraceVisibility = (event: unknown) => {
    if (!Array.isArray(event) || event.length !== 2 || !Array.isArray(event[1])) return;
    const patch = event[0] as Record<string, unknown>;
    if (!("visible" in patch)) return;
    const traceIndices = event[1] as number[];
    const visibility = patch.visible;
    setTraceVisible((current) => {
      const next = { ...current };
      traceIndices.forEach((traceIndex, index) => {
        const name = traceNames[traceIndex];
        if (!name) return;
        const value = Array.isArray(visibility) ? visibility[index] : visibility;
        next[name] = value !== "legendonly" && value !== false;
      });
      return next;
    });
  };

  const toggleFreeze = () => setFrozenSamples((current) => current ? undefined : samples);

  return <section className="panel chart-panel">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{t("live")}</p>
        <h2>{t("chartWindow")}: {rollingSeconds} {t("seconds")}</h2>
      </div>
      <div className="toolbar" aria-label="Chart export">
        <button type="button" className="quiet-button" onClick={() => void exportImage("png")}>PNG</button>
        <button type="button" className="quiet-button" onClick={() => void exportImage("svg")}>SVG</button>
        <button type="button" className="quiet-button" onClick={exportData}>JSON</button>
        <button type="button" className={frozenSamples ? "secondary-button" : "quiet-button"} onClick={toggleFreeze}>{frozenSamples ? t("resumeChart") : t("freezeChart")}</button>
      </div>
    </div>
    <Plot
      ref={plotRef}
      data={[
        { x: times, y: displayedSamples.map((sample) => sample.voltageV), type: "scattergl", mode: "lines", name: t("voltage"), line: { color: colors.voltage, width: 2 }, yaxis: "y", visible: traceVisible.voltage ? true : "legendonly" },
        { x: times, y: displayedSamples.map((sample) => sample.currentA), type: "scattergl", mode: "lines", name: t("current"), line: { color: colors.current, width: 2 }, yaxis: "y2", visible: traceVisible.current ? true : "legendonly" },
        { x: times, y: displayedSamples.map((sample) => sample.powerW), type: "scattergl", mode: "lines", name: t("power"), line: { color: colors.power, width: 2 }, yaxis: "y3", visible: traceVisible.power ? true : "legendonly" }
      ]}
      layout={{
        autosize: true, height: 390, uirevision: "live-chart-v1", paper_bgcolor: colors.surface, plot_bgcolor: colors.surface, font: { color: colors.ink, family: "Inter, system-ui, sans-serif" },
        // Keep just enough room for the two independent right-hand scales;
        // labels are placed above each scale rather than in the plot gutter.
        margin: { l: 52, r: 30, t: 30, b: 42 },
        legend: { orientation: "h", y: 1.16, uirevision: "live-chart-legend-v1" },
        xaxis: { domain: [0, 0.95], gridcolor: colors.grid, zerolinecolor: colors.grid, tickformat: "%H:%M:%S" },
        yaxis: { title: "V", gridcolor: colors.grid, zerolinecolor: colors.grid, fixedrange: false },
        yaxis2: { overlaying: "y", side: "right", showgrid: false, fixedrange: false, visible: hasSamples },
        yaxis3: { overlaying: "y", anchor: "free", side: "right", position: 0.985, showgrid: false, fixedrange: false, visible: hasSamples },
        annotations: hasSamples ? [
          { text: "A", xref: "paper", yref: "paper", x: 0.95, y: 1.04, showarrow: false, font: { color: colors.ink, size: 13 }, xanchor: "center", yanchor: "bottom" },
          { text: "W", xref: "paper", yref: "paper", x: 0.985, y: 1.04, showarrow: false, font: { color: colors.ink, size: 13 }, xanchor: "center", yanchor: "bottom" }
        ] : [],
        hovermode: "x unified"
      }}
      config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ["select2d", "lasso2d"] }}
      style={{ width: "100%", height: "390px" }}
      useResizeHandler
      onRestyle={rememberTraceVisibility}
    />
  </section>;
};
