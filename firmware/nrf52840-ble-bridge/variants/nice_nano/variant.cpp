#include "variant.h"

// Arduino digital pin index -> nRF52840 absolute GPIO number.
const uint32_t g_ADigitalPinMap[] = {
    8,       // D0  = P0.08, hardware UART RX
    6,       // D1  = P0.06, hardware UART TX
    17,      // D2  = P0.17
    20,      // D3  = P0.20
    22,      // D4  = P0.22
    24,      // D5  = P0.24
    32 + 0,  // D6  = P1.00
    11,      // D7  = P0.11
    32 + 4,  // D8  = P1.04
    32 + 6,  // D9  = P1.06
    9,       // D10 = P0.09
    10,      // D11 = P0.10
    32 + 11, // D12 = P1.11
    32 + 13, // D13 = P1.13
    2,       // D14 = P0.02 / A0
    29,      // D15 = P0.29 / A1
    31,      // D16 = P0.31 / A2
    30,      // D17 = P0.30 / A3
    4,       // D18 = P0.04 / A4
    5,       // D19 = P0.05 / A5
    32 + 2,  // D20 = P1.02
    32 + 15, // D21 = P1.15
    15,      // D22 = P0.15, onboard status LED
};

void initVariant() {
  // Deliberately empty: the transparent bridge must not drive unrelated pins.
}

