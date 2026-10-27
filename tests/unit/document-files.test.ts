import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { parseDocumentFile, maxDocumentBytes } from "../../src/modules/documents/file-parser";
import { docxFile, pdfFile, syntheticText } from "../helpers/document-files";
describe("Bounded file import without a model", () => {
  it("extracts Russian DOCX with an immutable binary checksum", async () => { const bytes = await docxFile(); const parsed = await parseDocumentFile(bytes, "Выписка.docx"); expect(parsed.text).toBe(syntheticText); expect(parsed.checksum).toBe(createHash("sha256").update(bytes).digest("hex")); expect(parsed.pages).toBeNull(); expect(parsed.warnings).toHaveLength(1); });
  it("extracts all PDF pages without silently dropping the last page", async () => { const result = await parseDocumentFile(pdfFile(undefined, 2), "record.pdf"); expect(result.pages).toBe(2); expect(result.text.match(/Synthetic record/g)).toHaveLength(2); });
  it("rejects scans, malformed PDFs, oversize and extension spoofing", async () => {
    await expect(parseDocumentFile(pdfFile(""), "scan.pdf")).rejects.toMatchObject({ status: 422, message: expect.stringContaining("OCR") });
    await expect(parseDocumentFile(Buffer.from("%PDF-garbage"), "broken.pdf")).rejects.toMatchObject({ status: 422 });
    await expect(parseDocumentFile(Buffer.alloc(maxDocumentBytes + 1), "large.pdf")).rejects.toMatchObject({ status: 413 });
    await expect(parseDocumentFile(await docxFile(), "fake.pdf")).rejects.toMatchObject({ status: 415 });
  });
  it("bounds pages and decompressed archive size", async () => {
    await expect(parseDocumentFile(pdfFile(undefined, 51), "long.pdf")).rejects.toMatchObject({ status: 422, message: expect.stringContaining("50") });
    const zip = new JSZip(); zip.file("[Content_Types].xml", "x"); zip.file("word/document.xml", "x".repeat(8000001));
    await expect(parseDocumentFile(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), "bomb.docx")).rejects.toMatchObject({ status: 422, message: expect.stringContaining("архив") });
  });
});
