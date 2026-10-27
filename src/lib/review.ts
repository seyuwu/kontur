import type { ReviewBasisContent, ReviewContext } from "@/modules/monitoring/action-catalogue";
export type { ReviewContext, ResolutionMethod } from "@/modules/monitoring/action-catalogue";
export type ReviewBasisData = ReviewBasisContent & { id: string; version: number; createdAt: string; createdBy: string };
export type ReviewBasisHistory = { versions: { id: string; version: number; createdAt: string; createdBy: string }[]; nextCursor: string | null };
export type ReviewReceipt = { id: string; actionId: string; basisVersion: number; messageId: string; requestKey: string; createdAt: string; text: string };
export type ReviewDecisionData = { basis: ReviewBasisData | null; currentContext: ReviewContext | null; stale: boolean; receipts: ReviewReceipt[]; receiptCount: number; basisCount: number };

export type EmailDeliveryData = { emailEnabled: boolean; delivery: { id: string; status: string; revision: number; attempts: number; errorCode: string | null; nextAttemptAt: string | null; acceptedAt: string | null; updatedAt: string } | null };
