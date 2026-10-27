import type { AssessmentDefinition, AssessmentAnswers, AssessmentEvaluation, ProposedAction, guidelineProvenanceSchema } from "@/modules/clinical";
import type { z } from "zod";
import type { AssessmentNotificationKind } from "./assessment-notifications";
import type { assessmentNotificationSchema } from "@/modules/clinical";
import type { ReviewDecisionData, ResolutionMethod, EmailDeliveryData } from "./review";

export type AssessmentFormDefinition = Pick<AssessmentDefinition, "code" | "version" | "title" | "description" | "instructions" | "period" | "mode" | "source" | "questions"> & { respondent?: "PATIENT" | "DOCTOR"; provenance?: z.infer<typeof guidelineProvenanceSchema> };
export type FormDefinition = { id: string; checksum: string; form: AssessmentFormDefinition };
export type AssignmentData = {
  id: string; patientId: string; definitionId: string; status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  dueAt: string | null; createdAt: string; completedAt: string | null; cancellationReason: string | null;
  answers: AssessmentAnswers; note: string; revision: number;
  submission: { id: string; answers: AssessmentAnswers; note: string; metric: AssessmentEvaluation["metric"]; createdAt: string; notification?: z.infer<typeof assessmentNotificationSchema> } | null;
};
export type AssessmentWorkspaceData = { definitions: FormDefinition[]; assignableDefinitionIds: string[]; assignments: AssignmentData[]; nextCursor: string | null };
export type ReviewEventData = ReviewDecisionData & EmailDeliveryData & {
  viewedAt?: string | null;
  notificationKind?: AssessmentNotificationKind; notification?: z.infer<typeof assessmentNotificationSchema>;
  pushDeliveries?: { id: string; device: string; status: string; attempts: number }[];
  id: string; patientId: string; patientName: string; publicId: string; title: string; reason: string; mode: "DEMO" | "CLINICAL";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED"; revision: number; ownerId: string | null; createdAt: string; claimedAt: string | null; resolvedAt: string | null;
  resolution: string | null; resolutionActionId: string | null; resolutionMethod: ResolutionMethod | null; ruleId: string; checksum: string; actions: ProposedAction[];
  source: { assignmentId: string; form: AssessmentFormDefinition; answers: AssessmentAnswers; note: string; metric: AssessmentEvaluation["metric"]; createdAt: string };
};
export type ReviewEventSummary = Pick<ReviewEventData, "id" | "patientId" | "patientName" | "publicId" | "title" | "reason" | "mode" | "status" | "revision" | "ownerId" | "createdAt" | "resolvedAt" | "notificationKind" | "viewedAt">;
export type ReviewWorkspaceData = { events: ReviewEventSummary[]; nextCursor: string | null; openCount: number; inProgressCount: number; resolvedCount: number };
