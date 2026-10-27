import type { ObservationData } from "./types";
export type HistoryPeriod = "7" | "30" | "90" | "ALL";
export type HistoryEntry = { id: string; kind: "observation" | "event" | "assessment"; createdAt: string; title: string; detail: string; observation?: ObservationData; assessment?: { code: string; version: number; checksum: string; mode: "DEMO" | "CLINICAL"; metric: { label: string; value: number; minimum: number; maximum: number; interpretation: string } } };
export type HistoryPage = { entries: HistoryEntry[]; nextCursor: string | null; through: string };
