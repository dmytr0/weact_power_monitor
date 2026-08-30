declare module "react-plotly.js/factory" {
  import type { ForwardRefExoticComponent, RefAttributes } from "react";
  const createPlotlyComponent: (plotly: unknown) => ForwardRefExoticComponent<Record<string, unknown> & RefAttributes<{ el?: HTMLElement }>>;
  export default createPlotlyComponent;
}

declare module "plotly.js-dist-min" {
  interface PlotlyApi {
    toImage: (target: HTMLElement, options: { format: "png" | "svg"; width: number; height: number; scale: number }) => Promise<string>;
  }
  const Plotly: PlotlyApi;
  export default Plotly;
}
