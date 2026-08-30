import type { ByteTransport } from "../weact/commandQueue";
import { NUS_RX_UUID, NUS_SERVICE_UUID, NUS_TX_UUID } from "./nus";

export type BleConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface BleDiagnostics {
  notifications: number;
  rxBytes: number;
  txBytes: number;
}

type StateListener = (state: BleConnectionState, error?: Error) => void;

export class BrowserBleTransport implements ByteTransport {
  private device: BluetoothDevice | undefined;
  private server: BluetoothRemoteGATTServer | undefined;
  private rx: BluetoothRemoteGATTCharacteristic | undefined;
  private tx: BluetoothRemoteGATTCharacteristic | undefined;
  private readonly byteListeners = new Set<(bytes: Uint8Array) => void>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly diagnostics: BleDiagnostics = { notifications: 0, rxBytes: 0, txBytes: 0 };

  public static get supported(): boolean {
    return typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
  }

  public get state(): BleConnectionState {
    return this.server?.connected ? "connected" : "disconnected";
  }

  public get name(): string | undefined {
    return this.device?.name;
  }

  public get id(): string | undefined {
    return this.device?.id;
  }

  public get stats(): BleDiagnostics {
    return { ...this.diagnostics };
  }

  public onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onBytes(listener: (bytes: Uint8Array) => void): () => void {
    this.byteListeners.add(listener);
    return () => this.byteListeners.delete(listener);
  }

  public async connect(): Promise<void> {
    if (!BrowserBleTransport.supported) {
      throw new Error("Web Bluetooth is not supported in this browser");
    }
    this.publishState("connecting");
    try {
      this.device = await navigator.bluetooth!.requestDevice({
        filters: [{ services: [NUS_SERVICE_UUID] }],
        optionalServices: [NUS_SERVICE_UUID]
      });
      await this.connectDevice(this.device);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.publishState("disconnected", normalized);
      throw normalized;
    }
  }

  public async reconnect(device: BluetoothDevice): Promise<void> {
    this.publishState("reconnecting");
    try {
      this.device = device;
      await this.connectDevice(device);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.publishState("disconnected", normalized);
      throw normalized;
    }
  }

  public async authorizedDevices(): Promise<BluetoothDevice[]> {
    if (!navigator.bluetooth?.getDevices) return [];
    const devices = await navigator.bluetooth.getDevices();
    return devices.filter((device) => device.name?.startsWith("WeActPM-") ?? false);
  }

  public async write(bytes: Uint8Array): Promise<void> {
    if (!this.rx || !this.server?.connected) {
      throw new Error("BLE NUS RX characteristic is not connected");
    }
    // A sliced ArrayBuffer avoids the Uint8Array<ArrayBufferLike> mismatch in
    // newer TypeScript DOM declarations and sends exactly this packet's bytes.
    const packet = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    if (this.rx.writeValueWithoutResponse) {
      await this.rx.writeValueWithoutResponse(packet);
    } else if (this.rx.writeValueWithResponse) {
      await this.rx.writeValueWithResponse(packet);
    } else if (this.rx.writeValue) {
      await this.rx.writeValue(packet);
    } else {
      throw new Error("BLE NUS RX characteristic is not writable");
    }
    this.diagnostics.txBytes += bytes.length;
  }

  public disconnect(): void {
    this.server?.disconnect();
    this.clearCharacteristics();
    this.publishState("disconnected");
  }

  public dispose(): void {
    this.disconnect();
    this.byteListeners.clear();
    this.stateListeners.clear();
  }

  private async connectDevice(device: BluetoothDevice): Promise<void> {
    device.removeEventListener("gattserverdisconnected", this.onDisconnected);
    device.addEventListener("gattserverdisconnected", this.onDisconnected);
    this.server = await device.gatt?.connect();
    if (!this.server) throw new Error("Bluetooth GATT is unavailable for this device");

    const service = await this.server.getPrimaryService(NUS_SERVICE_UUID);
    this.rx = await service.getCharacteristic(NUS_RX_UUID);
    this.tx = await service.getCharacteristic(NUS_TX_UUID);
    this.tx.removeEventListener("characteristicvaluechanged", this.onNotification);
    this.tx.addEventListener("characteristicvaluechanged", this.onNotification);
    await this.tx.startNotifications();
    this.publishState("connected");
  }

  private readonly onDisconnected = (): void => {
    this.clearCharacteristics();
    this.publishState("disconnected");
  };

  private readonly onNotification = (event: Event): void => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (!characteristic.value) return;
    const bytes = new Uint8Array(
      characteristic.value.buffer.slice(
        characteristic.value.byteOffset,
        characteristic.value.byteOffset + characteristic.value.byteLength
      )
    );
    this.diagnostics.notifications += 1;
    this.diagnostics.rxBytes += bytes.length;
    this.byteListeners.forEach((listener) => listener(bytes));
  };

  private clearCharacteristics(): void {
    this.rx = undefined;
    this.tx = undefined;
    this.server = undefined;
  }

  private publishState(state: BleConnectionState, error?: Error): void {
    this.stateListeners.forEach((listener) => listener(state, error));
  }
}
