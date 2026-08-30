#!/usr/bin/env python3
"""Discover the bridge, validate NUS, and send a safe WeAct read command."""

import argparse
import asyncio
from collections.abc import Sequence

from bleak import BleakClient, BleakScanner


NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"


def parse_payload(value: str) -> bytes:
    try:
        return bytes.fromhex(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


async def run(timeout: float, response_wait: float, payload: bytes) -> int:
    print("Scanning for WeActPM NUS bridge...")
    device = await BleakScanner.find_device_by_filter(
        lambda candidate, advertisement: bool(
            candidate.name
            and candidate.name.startswith("WeActPM-")
            and NUS_SERVICE in [uuid.lower() for uuid in advertisement.service_uuids]
        ),
        timeout=timeout,
    )

    if device is None:
        print("FAIL: WeActPM bridge was not found")
        return 1

    print(f"Found {device.name} ({device.address})")
    notifications: list[bytes] = []

    def on_notification(_characteristic, data: bytearray) -> None:
        chunk = bytes(data)
        notifications.append(chunk)
        print(f"RX notification: {chunk.hex(' ')}")

    async with BleakClient(device) as client:
        service = client.services.get_service(NUS_SERVICE)
        if service is None:
            print("FAIL: Nordic UART Service is missing")
            return 2

        rx_characteristic = service.get_characteristic(NUS_RX)
        tx_characteristic = service.get_characteristic(NUS_TX)
        if rx_characteristic is None or tx_characteristic is None:
            print("FAIL: Nordic UART RX/TX characteristic is missing")
            return 3

        print(f"NUS RX properties: {', '.join(rx_characteristic.properties)}")
        print(f"NUS TX properties: {', '.join(tx_characteristic.properties)}")

        await client.start_notify(NUS_TX, on_notification)
        print(f"TX write: {payload.hex(' ')}")
        await client.write_gatt_char(NUS_RX, payload, response=False)
        await asyncio.sleep(response_wait)
        await client.stop_notify(NUS_TX)

    if notifications:
        received = b"".join(notifications)
        print(f"PASS: NUS connected and received {len(received)} byte(s)")
    else:
        print(
            "PASS: NUS connected and accepted the write; no UART response was "
            "received (PowerMonitor may be disconnected)"
        )

    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--response-wait", type=float, default=2.0)
    parser.add_argument(
        "--payload",
        type=parse_payload,
        default=bytes.fromhex("82 0A"),
        help="Hex bytes; default is the safe CMD_OUTPUT_DATA read request",
    )
    arguments = parser.parse_args(argv)
    return asyncio.run(
        run(arguments.timeout, arguments.response_wait, arguments.payload)
    )


if __name__ == "__main__":
    raise SystemExit(main())

