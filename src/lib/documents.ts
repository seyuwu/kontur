import type { LocatedExtraction } from "@/modules/documents/contract";
import type { ProfileContent } from "./clinical-profile";
export type ExtractionData = { id: string; status: string; model: string; provider: string; promptVersion: string; errorCode: string | null; attempts: number; createdAt: string; updatedAt: string; result?: LocatedExtraction };
export type DocumentSummary = { id: string; title: string; date: string | null; checksum: string; createdAt: string; extraction: Omit<ExtractionData, "result"> | null };
export type DocumentPage = { entries: DocumentSummary[]; nextCursor: string | null; extractionEnabled: boolean; extractionProvider?: string | null };
export type DocumentData = DocumentSummary & { text: string; extraction: ExtractionData | null; file?: { name: string; mime: string; checksum: string; pages: number | null; parserVersion: string; warnings: string[] } | null };
export type PreparedDocumentProfile = { content: ProfileContent; expectedVersion: number; baseline: string };
