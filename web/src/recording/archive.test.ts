import { describe, expect, it } from "vitest";
import { parseCsvSession, samplesToCsv } from "./archive";

describe("session CSV archive", () => {
  it("round-trips exported measurement samples", () => {
    const source = [
      { timestamp: 1_700_000_000_000, elapsedMs: 0, voltageV: 5, currentA: 1.2, powerW: 6 },
      { timestamp: 1_700_000_001_000, elapsedMs: 1000, voltageV: 5.1, currentA: 1.1, powerW: 5.61 }
    ];
    const result = parseCsvSession(samplesToCsv(source));
    expect(result.session.sampleCount).toBe(2);
    expect(result.samples).toEqual(source);
  });
});
