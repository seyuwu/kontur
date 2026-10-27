import type { Appointment } from "./appointment";
import type { CareContent, CareTaskInput } from "@/modules/care/contract";
export type { CareContent, CareTaskInput };
export type CareReport = { id: string; revision: number; state: "DONE" | "NOT_DONE" | "NEEDS_HELP"; note: string; createdAt: string; planVersion: number };
export type CareTaskData = CareTaskInput & { medicationSchedule?:{revision:number;times:string[]}|null; medicationIntakes?:{date:string;time:string;state:string;note:string;revision:number}[]; dayRevision?:number; report: CareReport | null; assignment: { title: string; mode: "DEMO" | "CLINICAL"; version: number; status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" } | null };
export type CarePlanData = { id: string; version: number; goal: string; instructions: string; nextContactDate: string | null; appointment?: Appointment | null; confirmedAt: string; confirmedBy: string; tasks: CareTaskData[]; isCurrent: boolean; clinicalProfileVersionId?: string | null };
export type CareHistory = { versions: Omit<CarePlanData, "tasks" | "instructions" | "isCurrent">[]; nextCursor: string | null };
export type CareWorkspace = {
  nextVisitDate?: string | null; nextAppointment?: Appointment | null;
  current: CarePlanData | null;
  context?: { token: string; clinicalDataVersion: number; changesSincePlan: boolean };
  draft?: { id: string; revision: number; content: CareContent; basisToken: string; updatedAt: string; stale: boolean } | null;
  draftRevision?: number;
  availableAssignments?: { id: string; title: string; version: number; mode: "DEMO" | "CLINICAL"; status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" }[];
};
