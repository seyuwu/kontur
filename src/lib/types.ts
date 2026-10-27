import type { Appointment } from "./appointment";
export type ActorData = { id: string; name: string; role: string; specialty: string | null; email: string };
export type ObservationData = { id: string; score: number | null; note: string; needsContact: boolean; acknowledgedAt: string | null; createdAt: string };
export type MessageData = { id: string; text: string; createdAt: string; readAt: string | null; senderId: string; sender: { name: string; role: string } };
export type MessagePage = { messages: MessageData[]; nextCursor: string | null };
export type PatientData = {
  id: string; publicId: string; name: string; birthDate: string; doctorId: string; userId: string | null;
  currentPlan?: { appointment: Appointment | null } | null;
  note: string; nextVisit: string | null; nextVisitHasTime?: boolean; lastReview: string | null; createdAt: string; updatedAt: string; currentPlanId?: string | null; clinicalDataVersion?: number;
  doctor: { name: string; specialty: string | null };
  observations: ObservationData[]; messages: MessageData[];
  contactRequests?: ObservationData[]; contactRequestCount?: number;
  events: { id: string; kind: string; title: string; detail: string; createdAt: string }[];
};
export type LinkRequestData = { id: string; createdAt: string; user: { name: string; email: string }; invitation: { patient: { id: string; name: string; publicId: string } } };
export type WorkspaceData = { actor: ActorData; patients: PatientData[]; linkRequests: LinkRequestData[]; pendingLink: boolean; refreshedAt: string; demo: boolean };
export type PatientTab = "overview" | "data" | "dynamics" | "messages";
