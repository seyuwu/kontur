import { join } from "node:path";
import { createHash } from "node:crypto";
import { AppError } from "@/server/access";
export const maxDocumentBytes = 5 * 1024 * 1024;
export const fileParserVersion = "text-layer-1";
export type ParsedFile = { text: string; pages: number | null; warnings: string[]; name: string; mime: string; checksum: string; parserVersion: string };
const messages: Record<string, string> = {
  UNSAFE_ARCHIVE: "DOCX содержит недопустимый или слишком большой архив. Сохраните обычный DOCX без макросов либо вставьте текст.",
  INVALID_FILE: "Не удалось прочитать файл. Выберите исправный PDF или DOCX либо вставьте текст.",
  TOO_MANY_PAGES: "Поддерживается PDF до 50 страниц. Разделите документ на части.",
  TEXT_TOO_LONG: "В документе больше 60 000 символов. Разделите его на части.",
  NO_TEXT: "Недостаточно текста для импорта. Для скана сначала выполните OCR либо вставьте распознанный текст.",
  PASSWORD_REQUIRED: "PDF защищён паролем. Загрузите доступную для чтения копию.",
  PARSER_TIMEOUT: "Разбор файла занял слишком много времени. Попробуйте меньший файл либо вставьте текст."
};
let active = 0;
// The bundle is built for Node. Keep Next from rebundling it as an application worker asset.
const ParserWorker = process.getBuiltinModule("node:worker_threads").Worker;
export async function parseDocumentFile(bytes: Uint8Array, filename: string): Promise<ParsedFile> {
  if (!bytes.length || bytes.length > maxDocumentBytes) throw new AppError(413, "Выберите файл размером до 5 МБ.");
  const name = filename.replace(/[/\\\u0000-\u001f\u007f]/g, "_").slice(-200);
  const kind = /\.pdf$/i.test(name) && Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-" ? "pdf" : /\.docx$/i.test(name) && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4 ? "docx" : null;
  if (!kind) throw new AppError(415, "Поддерживаются PDF и DOCX. Содержимое должно соответствовать расширению файла.");
  if (active >= 2) throw new AppError(429, "Сейчас разбираются другие файлы. Повторите через несколько секунд.");
  active++;
  try {
    const parsed = await new Promise<{ text: string; pages: number | null; warnings: string[] }>((resolve, reject) => {
      const worker = new ParserWorker(join(process.cwd(), "resources", "document-parser", "worker.mjs"), { workerData: { bytes, kind }, resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 }, execArgv: [] });
      let settled = false;
      const finish = (error?: string, result?: { text: string; pages: number | null; warnings: string[] }) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); if (error) reject(new AppError(422, messages[error] ?? messages.INVALID_FILE)); else resolve(result!); };
      const timer = setTimeout(() => finish("PARSER_TIMEOUT"), 20000);
      worker.once("message", message => message.ok ? finish(undefined, message) : finish(message.code));
      worker.once("error", () => finish("INVALID_FILE")); worker.once("exit", () => finish("INVALID_FILE"));
    });
    return { text: parsed.text, pages: parsed.pages, warnings: parsed.warnings, name, mime: kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", checksum: createHash("sha256").update(bytes).digest("hex"), parserVersion: fileParserVersion };
  } finally { active--; }
}
