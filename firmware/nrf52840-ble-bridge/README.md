# nRF52840 BLE NUS bridge

Transparent bridge used by the WeAct Web Power Monitor:

```text
WeAct UART TX -> nRF Serial1 RX -> Nordic UART Service notifications
Web NUS writes -> nRF Serial1 TX -> WeAct UART RX
```

The firmware never parses, terminates, prefixes, or otherwise changes WeAct
protocol bytes.

## Hardware UART

- 115200 baud
- 8 data bits
- no parity
- 1 stop bit
- no flow control
- 3.3 V TTL

`Serial1` uses the hardware RX/TX pins defined by the local `nice_nano` board
variant: D0/RX is P0.08 and D1/TX is P0.06. Always connect TX to RX and share
GND.

## Build

PlatformIO downloads its toolchain and the nRF52 Arduino/Bluefruit framework on
the first build:

```sh
pio run -e promicro_nrf52840
```

An alternate Seeed XIAO target is available when needed:

```sh
pio run -e xiao_nrf52840
```

## Upload

Put the board into its UF2/serial bootloader (usually by quickly pressing reset
twice), then run:

```sh
pio run -e promicro_nrf52840 -t upload --upload-port /dev/cu.usbmodemXXXX
```

After reset it advertises the standard Nordic UART Service as `WeActPM-XXXX`.

## BLE smoke test

With Python `bleak` installed, validate advertising, NUS characteristics, and a
safe `CMD_OUTPUT_DATA` read request:

```sh
python3 scripts/ble_smoke_test.py
```

If the PowerMonitor UART is connected, the script also prints the raw response.
Without it, a successful BLE connection and accepted NUS write still validate
the wireless side of the bridge.

## Buffers and failure behavior

- UART -> BLE ring: 1024 bytes.
- BLE -> UART FIFO: 512 bytes.
- A full UART -> BLE ring drops newest bytes and increments a counter.
- A busy BLE notification queue retains the pending bytes and retries.
- Disconnect clears pending data and restarts advertising.
- USB CDC diagnostics are separate from the bridged `Serial1` byte stream.
