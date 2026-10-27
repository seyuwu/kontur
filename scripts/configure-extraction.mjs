import { readFile, writeFile } from "node:fs/promises";
import { parse } from "dotenv";
const path = new URL("../.env", import.meta.url);
let source = await readFile(path, "utf8"); const env = parse(source);
const provider = env.DOCUMENT_EXTRACTION_PROVIDER === "mistral" || (env.MISTRAL_API_KEY && !env.GROQ_API_KEY) ? "mistral" : "groq";
const keyName = provider === "mistral" ? "MISTRAL_API_KEY" : "GROQ_API_KEY";
const available = !!env[keyName];
const values = { DOCUMENT_EXTRACTION_PROVIDER: provider, LLM_SUMMARY_PROVIDER: provider, DOCUMENT_EXTRACTION_ENABLED: available ? "true" : "false", LLM_SUMMARY_ENABLED: available ? "true" : "false", ...(provider === "mistral" ? { MISTRAL_EXTRACTION_MODEL: env.MISTRAL_EXTRACTION_MODEL ?? "ministral-14b-latest", MISTRAL_SUMMARY_MODEL: env.MISTRAL_SUMMARY_MODEL ?? "ministral-14b-latest" } : { GROQ_EXTRACTION_MODEL: env.GROQ_EXTRACTION_MODEL ?? "openai/gpt-oss-20b", GROQ_SUMMARY_MODEL: env.GROQ_SUMMARY_MODEL ?? "openai/gpt-oss-20b" }) };
if (!Object.hasOwn(env, keyName)) values[keyName] = "";
for (const [key, value] of Object.entries(values)) { const pattern = new RegExp(`^${key}=.*$`, "m"); source = pattern.test(source) ? source.replace(pattern, `${key}=${value}`) : `${source.trimEnd()}\n${key}=${value}\n`; }
await writeFile(path, source, { mode: 0o600 });
console.info(available ? `${provider} настроен. Выполните npm run llm:check и перезапустите web/worker.` : `${provider} выбран, запросы выключены до добавления ${keyName} в .env. Затем повторите npm run llm:configure. Ключ не выводится.`);
