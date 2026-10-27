import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import yauzl from "yauzl";

const fail = code => { throw new Error(code); };
async function checkDocx(bytes) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("INVALID_FILE"));
      let count = 0, total = 0; const names = new Set(); let document = false, types = false;
      const stop = () => { zip.close(); reject(new Error("UNSAFE_ARCHIVE")); };
      zip.on("error", () => { zip.close(); reject(new Error("INVALID_FILE")); });
      zip.on("entry", entry => {
        count++; total += entry.uncompressedSize;
        if (count > 512 || total > 20000000 || entry.uncompressedSize > 8000000 || entry.generalPurposeBitFlag & 1 || names.has(entry.fileName) || /(^|\/)\.\.(\/|$)|\\|^\//.test(entry.fileName) || /vbaProject\.bin$/i.test(entry.fileName)) return stop();
        names.add(entry.fileName); document ||= entry.fileName === "word/document.xml"; types ||= entry.fileName === "[Content_Types].xml";
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { zip.close(); return reject(new Error("INVALID_FILE")); }
          let actual = 0;
          stream.on("data", chunk => { actual += chunk.length; if (actual > entry.uncompressedSize || actual > 8000000) { stream.destroy(); stop(); } });
          stream.on("error", () => { zip.close(); reject(new Error("INVALID_FILE")); });
          stream.on("end", () => actual === entry.uncompressedSize ? zip.readEntry() : stop());
        });
      });
      zip.on("end", () => document && types ? resolve() : reject(new Error("INVALID_FILE"))); zip.readEntry();
    });
  });
}

try {
  const bytes = Buffer.from(workerData.bytes); let text = "", pages = null; const warnings = [];
  if (workerData.kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, useSystemFonts: false, useWorkerFetch: false, disableFontFace: true, verbosity: 0 });
    try {
      pages = pdf.numPages; if (pages > 50) fail("TOO_MANY_PAGES"); let empty = 0;
      for (let n = 1; n <= pages; n++) {
        const page = await pdf.getPage(n); const content = await page.getTextContent();
        const value = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
        if (value.replace(/\s/g, "").length < 10) empty++;
        text += (n > 1 ? "\n\n" : "") + value; page.cleanup();
        if (text.length > 60000) fail("TEXT_TOO_LONG");
      }
      if (empty) warnings.push(`Страниц без достаточного текстового слоя: ${empty}. Изображения и сканы не распознаны.`);
    } finally { await pdf.loadingTask.destroy(); }
  } else {
    await checkDocx(bytes); const result = await mammoth.extractRawText({ buffer: bytes }); text = result.value;
    warnings.push("Перенесён текст DOCX. Изображения и рукописные записи не распознаются; порядок таблиц проверьте по оригиналу.");
  }
  text = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  if (text.length > 60000) fail("TEXT_TOO_LONG");
  if (text.replace(/\s/g, "").length < 40) fail("NO_TEXT");
  parentPort.postMessage({ ok: true, text, pages, warnings });
} catch (error) {
  const code = ["UNSAFE_ARCHIVE", "INVALID_FILE", "TOO_MANY_PAGES", "TEXT_TOO_LONG", "NO_TEXT"].includes(error?.message) ? error.message : error?.name === "PasswordException" ? "PASSWORD_REQUIRED" : "INVALID_FILE";
  parentPort.postMessage({ ok: false, code });
}
