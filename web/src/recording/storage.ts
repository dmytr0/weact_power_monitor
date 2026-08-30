import { openDB, type DBSchema } from "idb";
import type { ChartSample, RecordingEvent, RecordingSession } from "./types";

interface PowerMonitorDb extends DBSchema {
  sessions: { key: string; value: RecordingSession };
  samples: { key: number; value: ChartSample & { sessionId: string }; indexes: { "by-session": string } };
  events: { key: number; value: RecordingEvent; indexes: { "by-session": string } };
}

const database = openDB<PowerMonitorDb>("weact-power-monitor", 1, {
  upgrade(db) {
    db.createObjectStore("sessions", { keyPath: "id" });
    const samples = db.createObjectStore("samples", { keyPath: "id", autoIncrement: true });
    samples.createIndex("by-session", "sessionId");
    const events = db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
    events.createIndex("by-session", "sessionId");
  }
});

export const listSessions = async (): Promise<RecordingSession[]> =>
  (await database).getAll("sessions").then((items) => items.sort((a, b) => b.startedAt - a.startedAt));

export const putSession = async (session: RecordingSession): Promise<void> => {
  await (await database).put("sessions", session);
};

export const getSession = async (id: string): Promise<RecordingSession | undefined> => (await database).get("sessions", id);

export const appendSamples = async (sessionId: string, samples: ChartSample[]): Promise<void> => {
  if (samples.length === 0) return;
  const db = await database;
  const transaction = db.transaction("samples", "readwrite");
  await Promise.all(samples.map((sample) => transaction.store.add({ ...sample, sessionId })));
  await transaction.done;
};

export const getSamples = async (sessionId: string): Promise<ChartSample[]> => {
  const db = await database;
  const records = await db.getAllFromIndex("samples", "by-session", sessionId);
  return records
    .map(({ sessionId: _sessionId, ...sample }) => sample)
    .sort((a, b) => a.timestamp - b.timestamp);
};

export const addEvent = async (event: RecordingEvent): Promise<void> => {
  await (await database).add("events", event);
};

export const getEvents = async (sessionId: string): Promise<RecordingEvent[]> =>
  (await database).getAllFromIndex("events", "by-session", sessionId);

export const deleteSession = async (sessionId: string): Promise<void> => {
  const db = await database;
  const transaction = db.transaction(["sessions", "samples", "events"], "readwrite");
  await transaction.objectStore("sessions").delete(sessionId);
  for (const storeName of ["samples", "events"] as const) {
    const index = transaction.objectStore(storeName).index("by-session");
    let cursor = await index.openCursor(sessionId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await transaction.done;
};
