#include <Arduino.h>
#include <bluefruit.h>

#include "ByteRingBuffer.h"

#ifndef WEACT_UART_BAUD
#define WEACT_UART_BAUD 115200
#endif

#ifndef WEACT_BLE_NAME_PREFIX
#define WEACT_BLE_NAME_PREFIX "WeActPM"
#endif

namespace {

constexpr size_t kUartToBleCapacity = 1024;
constexpr size_t kBleToUartCapacity = 512;
constexpr size_t kMaximumNotificationPayload = 244;
constexpr uint8_t kNotificationsPerLoop = 4;
constexpr uint32_t kDiagnosticsIntervalMs = 5000;

BLEUart bleUart(kBleToUartCapacity);
ByteRingBuffer<kUartToBleCapacity> uartToBle;

volatile bool clearPendingUartToBle = false;
volatile uint32_t bleRxOverflowBytes = 0;

struct Diagnostics {
  uint32_t uartRxBytes = 0;
  uint32_t uartTxBytes = 0;
  uint32_t bleRxBytes = 0;
  uint32_t bleTxBytes = 0;
  uint32_t uartToBleDroppedBytes = 0;
  uint32_t bleNotifyRetries = 0;
  uint32_t disconnects = 0;
} diagnostics;

void startAdvertising();

void onBleConnected(uint16_t connectionHandle) {
  BLEConnection* connection = Bluefruit.Connection(connectionHandle);
  if (connection != nullptr) {
    connection->requestPHY(BLE_GAP_PHY_1MBPS);
  }
}

void onBleDisconnected(uint16_t connectionHandle, uint8_t reason) {
  (void)connectionHandle;
  (void)reason;

  ++diagnostics.disconnects;
  clearPendingUartToBle = true;
}

void onBleRxOverflow(uint16_t connectionHandle, uint16_t leftover) {
  (void)connectionHandle;
  bleRxOverflowBytes += leftover;
}

void configureDeviceName() {
  uint8_t address[6] = {};
  Bluefruit.getAddr(address);

  char deviceName[20] = {};
  snprintf(deviceName, sizeof(deviceName), "%s-%02X%02X", WEACT_BLE_NAME_PREFIX,
           address[1], address[0]);
  Bluefruit.setName(deviceName);
}

void startAdvertising() {
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(bleUart);
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

void drainUartIntoRing() {
  const bool canForward = Bluefruit.connected() != 0;

  while (Serial1.available() > 0) {
    const int value = Serial1.read();
    if (value < 0) {
      break;
    }

    ++diagnostics.uartRxBytes;

    if (!canForward) {
      continue;
    }

    if (!uartToBle.push(static_cast<uint8_t>(value))) {
      ++diagnostics.uartToBleDroppedBytes;
    }
  }
}

void drainBleIntoUart() {
  int writable = Serial1.availableForWrite();

  while (writable > 0 && bleUart.available() > 0) {
    const int value = bleUart.read();
    if (value < 0) {
      break;
    }

    const size_t written = Serial1.write(static_cast<uint8_t>(value));
    if (written == 0) {
      break;
    }

    ++diagnostics.bleRxBytes;
    ++diagnostics.uartTxBytes;
    --writable;
  }
}

size_t notificationPayloadSize() {
  BLEConnection* connection = Bluefruit.Connection(Bluefruit.connHandle());
  if (connection == nullptr) {
    return 20;
  }

  const uint16_t mtu = connection->getMtu();
  if (mtu <= 3) {
    return 20;
  }

  const size_t payload = mtu - 3U;
  return payload < kMaximumNotificationPayload ? payload
                                                : kMaximumNotificationPayload;
}

void flushRingToBle() {
  if (Bluefruit.connected() == 0 || !bleUart.notifyEnabled()) {
    return;
  }

  uint8_t chunk[kMaximumNotificationPayload] = {};
  const size_t payloadSize = notificationPayloadSize();

  for (uint8_t attempt = 0;
       attempt < kNotificationsPerLoop && uartToBle.size() > 0; ++attempt) {
    const size_t count = uartToBle.peek(chunk, payloadSize);
    const size_t written = bleUart.write(chunk, count);

    if (written == 0) {
      ++diagnostics.bleNotifyRetries;
      break;
    }

    uartToBle.discard(written);
    diagnostics.bleTxBytes += written;

    if (written < count) {
      ++diagnostics.bleNotifyRetries;
      break;
    }
  }
}

void printDiagnostics() {
  static uint32_t previousPrintMs = 0;
  const uint32_t now = millis();
  if (!Serial || now - previousPrintMs < kDiagnosticsIntervalMs) {
    return;
  }
  previousPrintMs = now;

  Serial.print("bridge connected=");
  Serial.print(Bluefruit.connected() != 0 ? "yes" : "no");
  Serial.print(" uart_rx=");
  Serial.print(diagnostics.uartRxBytes);
  Serial.print(" uart_tx=");
  Serial.print(diagnostics.uartTxBytes);
  Serial.print(" ble_rx=");
  Serial.print(diagnostics.bleRxBytes);
  Serial.print(" ble_tx=");
  Serial.print(diagnostics.bleTxBytes);
  Serial.print(" pending=");
  Serial.print(uartToBle.size());
  Serial.print(" dropped=");
  Serial.print(diagnostics.uartToBleDroppedBytes);
  Serial.print(" ble_overflow=");
  Serial.print(bleRxOverflowBytes);
  Serial.print(" notify_retry=");
  Serial.print(diagnostics.bleNotifyRetries);
  Serial.print(" disconnects=");
  Serial.println(diagnostics.disconnects);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial1.begin(WEACT_UART_BAUD);

  Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);
  Bluefruit.begin(1, 0);
  Bluefruit.setTxPower(4);
  // Do not touch a board LED or any non-UART GPIO. Some ProMicro-compatible
  // boards expose the pin used as a connection LED by other variants.
  Bluefruit.autoConnLed(false);
  Bluefruit.Periph.setConnInterval(12, 24);
  Bluefruit.Periph.setConnectCallback(onBleConnected);
  Bluefruit.Periph.setDisconnectCallback(onBleDisconnected);

  configureDeviceName();

  bleUart.setRxOverflowCallback(onBleRxOverflow);
  bleUart.begin();

  startAdvertising();

  if (Serial) {
    Serial.println("WeAct PowerMonitor transparent BLE NUS bridge ready");
  }
}

void loop() {
  if (clearPendingUartToBle) {
    uartToBle.clear();
    bleUart.flush();
    clearPendingUartToBle = false;
  }

  drainBleIntoUart();
  drainUartIntoRing();
  flushRingToBle();
  printDiagnostics();

  yield();
}
