import { assessmentDefinitionSchema } from "./index";
import { f40BaiDefinition, f40Source } from "./f40-bai-definition";
import catalogue from "./f40-catalogue.json";
import text from "./f40-questions.json";

const options = (labels: string[], first = 0) => labels.map((label, i) => ({ id: `answer_${i + first}`, label, points: i + first }));
const ids = (prefix: string, numbers: number[]) => numbers.map(n => `${prefix}_${n}`);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const baseProvenance = f40BaiDefinition.schemaVersion !== 1 ? f40BaiDefinition.provenance : null;
if (!baseProvenance) throw new Error("F40 source provenance is required.");
const severity = options(["Совсем нет", "Немного", "Умеренно", "Сильно", "Очень сильно"]);
type Subscale = { label: string; questionIds: string[]; aggregate: "sum" | "mean" | "positive-count" | "positive-mean" };
function definition(appendix: number, code: string, questions: string[], answers: ReturnType<typeof options>, config: { title?: string; period: string; instructions: string; interpretation: string; aggregate?: "sum" | "mean"; subscales?: Subscale[]; high?: number; extra?: string }) {
  const entry = catalogue.find(c => c.appendix === appendix)!;
  const prefix = code.replace("guideline-f40-", "").replace("-demo", "").replaceAll("-", "_");
  const all = ids(prefix, range(questions.length));
  const reference = `Приложение Г${appendix}; страницы PDF ${entry.pages.join(", ")}`;
  return assessmentDefinitionSchema.parse({
    schemaVersion: 3, code, version: 1, mode: "DEMO", review: "DEMO", respondent: entry.respondent,
    title: config.title ?? entry.title, description: `Учебный перенос из приложения Г${appendix}. ${entry.limitation} ${config.extra ?? ""}`,
    instructions: config.instructions, period: config.period,
    source: { title: f40Source.title, reference, validation: `Вопросы и доступный ключ предоставленного PDF. ${config.extra ?? "Нормативы и применимость требуют проверки специалистом."}`, rights: f40BaiDefinition.source.rights, reviewedBy: "", reviewedAt: "" },
    questions: questions.map((title, i) => ({ id: all[i], title, required: true, options: answers.map(a => ({ ...a })) })),
    scoring: { strategy: "sum", questionIds: all, label: config.aggregate === "mean" ? "Средний показатель по PDF" : "Сумма по PDF", interpretation: `${config.interpretation} Учебный расчёт не устанавливает диагноз и не определяет срочность.`, aggregate: config.aggregate ?? "sum", subscales: config.subscales ?? [] },
    actions: [
      { id: "review_answers", label: "Разобрать исходные ответы", kind: "REVIEW_ANSWERS", description: "Проверьте исходные ответы, период и контекст пациента. Уточните противоречивые или неполные сведения.", source: `${reference}; действие рабочего процесса, не назначение лечения.` },
      { id: "contact_patient", label: "Уточнить состояние при контакте", kind: "CONTACT_PATIENT", description: "Согласуйте контакт и уточните актуальное состояние. Не меняйте лечение по баллу анкеты.", source: `${reference}; действие рабочего процесса требует решения врача.` }
    ],
    rules: config.high === undefined ? [] : [{ id: "high_pdf", title: "Высокий показатель: разбор врачом", reason: `Показатель достиг ${config.high} по предоставленному ключу. Учебный сигнал для разбора ответов; медицинская срочность не установлена.`, when: { metric: "TOTAL", minimum: config.high, maximum: questions.length * Math.max(...answers.map(a => a.points)) }, actionIds: ["review_answers", "contact_patient"] }],
    provenance: { ...baseProvenance, reference, pdfPages: entry.pages, limitations: `F40, взрослые от 18 лет. ${entry.limitation} ${config.extra ?? ""}` }
  });
}
const sclGroups: [string, number[]][] = [
  ["SOM", [1,4,12,27,40,42,48,49,52,53,56,58]], ["O-C", [3,9,10,28,38,45,46,51,55,65]],
  ["INT", [6,21,34,36,37,41,61,69,73]], ["DEP по PDF", [14,15,20,22,26,29,30,31,32,54,56,71,79]],
  ["ANX", [2,17,23,33,39,57,72,78,80,86]], ["HOS", [11,24,63,67,74,81]], ["PHOB", [13,25,47,50,70,75,82]],
  ["PAR", [8,18,43,68,76,83]], ["PSY", [7,16,35,62,77,84,85,87,88,90]], ["Дополнительные пункты", [19,44,59,60,64,66,89]]
];
const ittState = ["Я нахожусь в напряжении", "Я расстроен", "Я тревожусь о будущем", "Я нервничаю", "Я озабочен", "Я возбужден", "Я ощущаю непонятную угрозу", "Я устаю быстрее обычного", "Я не уверен в себе", "Я избегаю любых конфликтов", "Я чувствую замешательство", "Я ощущаю свою бесполезность", "Я спал беспокойно", "Я ощущаю себя утомленным", "Я эмоционально чувствителен"];
const ittTrait = ["Я находился в напряжении", "Я расстраивался", "Я тревожился о будущем", "Я нервничал", "Я бывал озабочен", "Я бывал возбужден", "Я ощущал непонятную угрозу", "Я быстро уставал", "Я бывал неуверен в себе", "Я избегал любых конфликтов", "Я легко приходил в замешательство", "Я ощущал свою бесполезность", "Я плохо спал", "Я ощущал себя утомленным", "Я бывал эмоционально чувствителен"];
export const f40Definitions = [
  f40BaiDefinition,
  definition(1, "guideline-f40-ham-demo", text.ham, options(["Отсутствует", "В слабой степени", "В умеренной степени", "В тяжелой степени", "В очень тяжелой степени"]), { period: "Состояние при клинической оценке; отдельный период в PDF не задан.", instructions: "Заполняет врач по результатам осмотра и беседы. Оцените выраженность каждого симптома от 0 до 4.", interpretation: "Ключ PDF: 0–7 — отсутствие тревоги по шкале; 8–17 — симптомы; 18–24 — средняя выраженность; 25–56 — тяжёлая выраженность.", high: 25, subscales: [{ label: "Психическая сфера", questionIds: ids("ham", range(6)), aggregate: "sum" }, { label: "Соматическая сфера", questionIds: ids("ham", range(8).map(n => n + 6)), aggregate: "sum" }] }),
  definition(2, "guideline-f40-scl-demo", text.scl, severity, { period: "Последняя неделя, включая сегодняшний день.", instructions: "Насколько сильно вас тревожили перечисленные проблемы в течение последней недели, включая сегодняшний день? Выберите один ответ в каждом пункте.", aggregate: "mean", interpretation: "Основной показатель — GSI, среднее всех 90 ответов. PSI — число положительных ответов; PDSI — сумма / PSI, при PSI=0 не определён. Нормативная таблица описательная и не задаёт порога события.", subscales: [...sclGroups.map(([label, items]) => ({ label, questionIds: ids("scl", items), aggregate: "mean" as const })), { label: "PSI", questionIds: ids("scl", range(90)), aggregate: "positive-count" }, { label: "PDSI", questionIds: ids("scl", range(90)), aggregate: "positive-mean" }], extra: "Пункт 56 в DEP перенесён буквально по PDF, хотя также входит в SOM; требуется сверка ключа. Ответы о смерти и самоповреждении требуют отдельной оценки врача; отсутствие автоматического события не означает отсутствия риска." }),
  definition(3, "guideline-f40-itt-state-demo", ittState, options(["Совсем нет", "Слабо выражено", "Выражено", "Очень выражено"]), { title: "ИТТ · ситуативная тревожность (СТ-С)", period: "Сейчас, в данный момент, сегодня.", instructions: "Решите, насколько каждое состояние выражено именно сейчас, в данный момент, сегодня.", interpretation: "Сырая сумма СТ-С 0–45. Станайны, взвешенные подшкалы и нормативные выводы не рассчитываются: таблицы требуют сверки. Сумму нельзя интерпретировать как диагноз." }),
  definition(3, "guideline-f40-itt-trait-demo", ittTrait, options(["Почти никогда", "Редко", "Часто", "Почти все время"]), { title: "ИТТ · личностная тревожность (СТ-Л)", period: "Последнее время, например последний год — по инструкции PDF.", instructions: "Решите, как часто на протяжении последнего времени (например, последнего года) вы испытывали каждое из состояний.", interpretation: "Сырая сумма СТ-Л 0–45. Станайны, взвешенные подшкалы и нормативные выводы не рассчитываются: таблицы требуют сверки." }),
  definition(6, "guideline-f40-spras-demo", text.spras, options(["Нисколько", "Немного", "Умеренно", "Сильно", "Крайне сильно"]), { period: "Последняя неделя (7 дней).", instructions: "Определите, насколько вас беспокоили в течение последней недели указанные симптомы.", interpretation: "Ключ PDF: 0–29 — ниже диапазона клинически выраженной тревоги; 30–79 — клинически выраженная тревога по шкале; 80–140 — тяжёлый диапазон. Балл сам по себе не подтверждает паническое или иное расстройство.", high: 80 }),
  definition(17, "guideline-f40-bfne-demo", text.bfne, options(["Совсем не характеризует меня", "Слегка характеризует меня", "Умеренно характеризует меня", "В большой степени характеризует меня", "Полностью характеризует меня"], 1), { period: "Насколько утверждения характеризуют вас; отдельный период в PDF не задан.", instructions: "Прочитайте утверждения и определите, насколько каждое из них характеризует вас.", interpretation: "Ключ PDF: 12–23 — низкий, 24–46 — средний, 47–60 — высокий уровень страха негативной оценки.", high: 47 }),
  definition(18, "guideline-f40-gelo-demo", text.gelo, options(["Совершенно не согласен", "Не согласен", "Согласен", "Совершенно согласен"], 1), { period: "Привычные способы поведения и отношение в целом.", instructions: "Опишите ваши привычные способы поведения и отношение, выбрав один из четырёх вариантов ответа.", aggregate: "mean", interpretation: "Общий средний показатель 1–4. PDF указывает интервалы 1–1,2; 1,3–2,2; 2,3–4, оставляющие промежутки. Категория и порог события не присваиваются автоматически.", subscales: [ { label: "Социальное реагирование · среднее", questionIds: ids("gelo",[1,3,4,5,9,11,12,13,15]), aggregate: "mean" }, { label: "Самовосприятие · среднее", questionIds: ids("gelo",[2,6,7,8,10,14]), aggregate: "mean" }, { label: "Общая сумма", questionIds: ids("gelo",range(15)), aggregate: "sum" } ] })
];
