import type { ProfileContent } from "@/modules/clinical-profile/contract";
export type { ProfileContent };
export type ClinicalProfile = { id: string; version: number; content: ProfileContent; savedBy: string; createdAt: string; isCurrent: boolean };
export type ProfileWorkspace = { current: ClinicalProfile | null; version: number };
export type ProfileHistory = { versions: Omit<ClinicalProfile, "content" | "isCurrent">[]; nextCursor: string | null };
