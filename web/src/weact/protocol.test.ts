import { describe, expect, it } from "vitest";
import { WeActCommandQueue } from "./commandQueue";
import { WeActProtocol } from "./protocol";
import { MockPowerMonitorTransport } from "../simulation/MockTransport";

describe("WeActProtocol", () => {
  it("normalizes the mock device's measurement and PDO2 data", async () => {
    const transport = new MockPowerMonitorTransport();
    await transport.connect();
    const queue = new WeActCommandQueue(transport);
    const protocol = new WeActProtocol(queue);

    await expect(protocol.whoAmI()).resolves.toBe("PowerMonitorMiniV1");
    const measurement = await protocol.outputData();
    expect(measurement.voltageV).toBeGreaterThan(8.9);
    expect(measurement.currentA).toBeGreaterThan(0.9);
    const pdo = await protocol.currentPdo2();
    expect(pdo).toEqual({ id: 4, voltageMv: 9000, currentMa: 3000 });
    queue.dispose();
  });
});

