/*
 * Minimal nice!nano / ProMicro-compatible nRF52840 Arduino variant.
 *
 * The bridge intentionally configures only USB, BLE, and the hardware UART.
 * Other mappings are provided for core compatibility but are never driven by
 * the application.
 */

#ifndef _VARIANT_WEACT_NICE_NANO_
#define _VARIANT_WEACT_NICE_NANO_

#define VARIANT_MCK (64000000ul)

// nice!nano uses the calibrated low-frequency RC oscillator.
#define USE_LFRC

#include "WVariant.h"

#ifdef __cplusplus
extern "C" {
#endif

#define PINS_COUNT (23)
#define NUM_DIGITAL_PINS (23)
#define NUM_ANALOG_INPUTS (6)
#define NUM_ANALOG_OUTPUTS (0)

// The status LED is not used by the bridge.
#define PIN_LED1 (22)
#define LED_BUILTIN PIN_LED1
#define LED_CONN PIN_LED1
#define LED_STATE_ON 0

// ProMicro labels: D0/RX = P0.08, D1/TX = P0.06.
#define PIN_SERIAL1_RX (0)
#define PIN_SERIAL1_TX (1)

#define PIN_A0 (14)
#define PIN_A1 (15)
#define PIN_A2 (16)
#define PIN_A3 (17)
#define PIN_A4 (18)
#define PIN_A5 (19)

static const uint8_t A0 = PIN_A0;
static const uint8_t A1 = PIN_A1;
static const uint8_t A2 = PIN_A2;
static const uint8_t A3 = PIN_A3;
static const uint8_t A4 = PIN_A4;
static const uint8_t A5 = PIN_A5;

#define ADC_RESOLUTION 14

#define WIRE_INTERFACES_COUNT 1
#define PIN_WIRE_SDA (2)
#define PIN_WIRE_SCL (3)

#define SPI_INTERFACES_COUNT 1
#define PIN_SPI_MISO (12)
#define PIN_SPI_MOSI (11)
#define PIN_SPI_SCK (10)

static const uint8_t SS = 9;
static const uint8_t MOSI = PIN_SPI_MOSI;
static const uint8_t MISO = PIN_SPI_MISO;
static const uint8_t SCK = PIN_SPI_SCK;

#ifdef __cplusplus
}
#endif

#endif

