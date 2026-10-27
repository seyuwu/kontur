import type { ActorData, LinkRequestData, PatientData } from "./types";
export type PatientFilter = "all" | "attention" | "pending" | "messages";
export type DirectoryQuery = { q: string; filter: PatientFilter; cursor?: string };
export type PatientSummary = {
  id: string; publicId: string; name: string; birthDate: string; userId: string | null;
  nextVisit: string | null; nextVisitHasTime?: boolean; updatedAt: string; lastObservationAt: string | null;
  contactRequests: number; unreadMessages: number; reviewEvents: number;
};
export type DirectoryData = {
  actor: ActorData; demo: boolean; patients: PatientSummary[]; nextCursor: string | null; previousCursor: string | null; page: number; matchedTotal: number;
  counts: { all: number; attention: number; pending: number; unreadMessages: number; contactRequests: number };
  upcoming: { id: string; name: string; nextVisit: string; nextVisitHasTime?:boolean }[]; linkRequests: LinkRequestData[];
};
export type PatientDetailData = { patient: PatientData };
export function directoryUrl(query: DirectoryQuery) {
  const params = new URLSearchParams({ filter: query.filter });
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.cursor) params.set("cursor", query.cursor);
  return `/api/patients?${params}`;
}
