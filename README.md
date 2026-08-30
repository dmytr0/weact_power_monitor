# WeAct Web Power Monitor

Standalone firmware and web application for a WeAct PowerMonitorMiniV1 connected
through an nRF52840 Nordic UART Service bridge.

All source code, copied protocol fixtures, build configuration, and documentation
for this project live below this directory. Nothing here imports source files from
other repository directories at build time or at runtime.

## Layout

- `firmware/nrf52840-ble-bridge` — transparent UART ↔ BLE NUS bridge.
- `web` — a single TypeScript/React/PWA application. It talks directly to BLE;
  there is no HTTP API, server, cloud service, or separate backend.

## Web application

The browser connects directly to the nRF52840 Nordic UART Service, parses the
PowerMonitor UART protocol, and stores sessions in the browser's IndexedDB.
The physical PowerMonitor UART uses CRC-8 framing (polynomial `0x31`, initial
value `0xFF`); the `0x0A` terminator is reserved for direct USB CDC framing.

It includes Ukrainian and English UI, a device/demo connection path, live
Plotly charts, recording and recovery, CSV/JSON/Plotly export, JSON/CSV import,
PD PDO control with a voltage-rise confirmation, raw protocol diagnostics, and
INA226/calibration controls.

```sh
cd web
npm ci
npm run dev
```

Open the local URL in Chrome or Edge on desktop for Web Bluetooth. Use **Open
demo** to exercise every UI flow without hardware.

Validation commands:

```sh
npm run check
npm test
npm run build
```

`web/dist` is the self-contained production PWA output. Plotly is intentionally
pre-cached so charts and exports also work offline after the first load.

## Deployment with `deploy-static`

This directory is an independent Git repository intended for:

```text
git@github.com:dmytr0/weact_power_monitor.git
```

The existing `deploy-static weact_power_monitor master` script only fetches and
checks out Git; it does not install Node.js dependencies or run a build. The
production files are therefore committed both under `web/dist` and at the
repository root. The existing Nginx document root works unchanged:

```text
/srv/www/projects/weact_power_monitor
```

For a new release, run `npm run build` from `web`. The build mirrors `web/dist`
to the repository root, so the checked-out tree is immediately deployable by
the existing script. Commit the updated `web/dist` and root static files, push
the branch, and then run the deployment script unchanged.
