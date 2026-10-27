import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { db } from "../src/server/db";
import { publishSeedDefinition } from "../src/modules/assessments/seed-definitions";
import { demoDefinition } from "../src/modules/clinical/demo-definition";
import { f40Definitions } from "../src/modules/clinical/f40-definitions";
import { f40NotificationDefinitions } from "../src/modules/clinical/f40-notification-definitions";

if (process.env.DEMO_MODE !== "true") throw new Error("Seed is restricted to DEMO_MODE=true and synthetic data.");
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 10) throw new Error("Set DEMO_PASSWORD (at least 10 characters).");
const hashed = await hashPassword(password);
const accounts = [
  { id: "demo-doctor", name: "Елена Андреевна Волкова", email: "doctor@kontur.demo", role: "DOCTOR", specialty: "Врач-терапевт" },
  { id: "demo-psychiatrist", name: "Михаил Сергеевич Соколов", email: "psychiatrist@kontur.demo", role: "DOCTOR", specialty: "Врач-психиатр" },
  { id: "demo-patient", name: "Анна Ковалёва", email: "patient@kontur.demo", role: "PATIENT", specialty: null },
  { id: "demo-new-patient", name: "Новый пациент", email: "new-patient@kontur.demo", role: "PATIENT", specialty: null }
];
for (const user of accounts) {
  await db.user.upsert({ where: { id: user.id }, create: { ...user, emailVerified: true }, update: { name: user.name, role: user.role, specialty: user.specialty } });
  await db.account.upsert({ where: { id: `credential-${user.id}` }, create: { id: `credential-${user.id}`, accountId: user.id, providerId: "credential", userId: user.id, password: hashed }, update: { password: hashed } });
}
const now = new Date();
const daysAgo = (days: number, hours = 0) => new Date(now.getTime() - days * 86400000 + hours * 3600000);
const patientSeeds = [
  { id: "anna", name: "Анна Ковалёва", birthday: "1993-04-18", userId: "demo-patient", doctorId: "demo-doctor", scores: [3, 3, 2, 3, 3, 4, 3, 4, 3, 3, 2, 3], contact: true, days: 2 },
  { id: "dmitry", name: "Дмитрий Лебедев", birthday: "1987-09-22", userId: "synthetic-dmitry", doctorId: "demo-doctor", scores: [2, 3, 3, 3, 4, 3, 4, 4, 4], contact: false, days: 4 },
  { id: "maria", name: "Мария Соколова", birthday: "1997-02-07", userId: "synthetic-maria", doctorId: "demo-doctor", scores: [3, 3, 3, 2, 3, 3], contact: true, days: 1 },
  { id: "alexander", name: "Александр Морозов", birthday: "1981-06-14", userId: "synthetic-alexander", doctorId: "demo-doctor", scores: [3, 4, 3, 4, 4, 4], contact: false, days: 7 },
  { id: "olga", name: "Ольга Власова", birthday: "1990-11-03", userId: "synthetic-olga", doctorId: "demo-doctor", scores: [3, 3, 4, 3, 4], contact: false, days: 5 },
  { id: "sergey", name: "Сергей Никитин", birthday: "1978-08-20", userId: null, doctorId: "demo-doctor", scores: [], contact: false, days: 3 },
  { id: "irina", name: "Ирина Павлова", birthday: "1995-12-10", userId: "synthetic-irina", doctorId: "demo-doctor", scores: [3, 4, 3, 3], contact: false, days: 8 },
  { id: "nikita", name: "Никита Орлов", birthday: "1999-03-12", userId: null, doctorId: "demo-doctor", scores: [], contact: false, days: 10 },
  { id: "victor", name: "Виктор Фёдоров", birthday: "1989-05-04", userId: "synthetic-victor", doctorId: "demo-psychiatrist", scores: [2, 2, 3, 3, 3, 4], contact: false, days: 2 }
];
for (let index = 0; index < patientSeeds.length; index++) {
  const seed = patientSeeds[index];
  if (seed.userId?.startsWith("synthetic-")) await db.user.upsert({ where: { id: seed.userId }, create: { id: seed.userId, name: seed.name, email: `${seed.id}@synthetic.kontur.demo` }, update: {} });
  const patient = await db.patient.upsert({ where: { id: `patient-${seed.id}` }, create: {
    id: `patient-${seed.id}`, publicId: `КТ-${String(index + 1).padStart(4, "0")}`, name: seed.name, birthDate: new Date(seed.birthday), doctorId: seed.doctorId, userId: seed.userId,
    note: seed.id === "anna" ? "На следующем контакте обсудить самочувствие и изменения сна со слов пациентки. Уточнить, какие вопросы она хотела бы разобрать." : "Обсудить динамику самочувствия на следующем контакте.",
    nextVisit: new Date(now.getTime() + seed.days * 86400000), lastReview: daysAgo(7), createdAt: daysAgo(18), updatedAt: daysAgo(index % 4)
  }, update: {} });
  for (let i = 0; i < seed.scores.length; i++) {
    const last = i === seed.scores.length - 1;
    await db.observation.upsert({ where: { requestKey: `seed-${seed.id}-${i}` }, create: {
      patientId: patient.id, requestKey: `seed-${seed.id}-${i}`, score: seed.scores[i], createdAt: daysAgo(seed.scores.length - i - 1, -2), needsContact: last && seed.contact,
      note: last && seed.id === "anna" ? "В последние дни сложнее засыпать. Хотела бы обсудить это с врачом." : last && seed.contact ? "Есть вопросы о самочувствии. Пожалуйста, свяжитесь со мной." : ""
    }, update: {} });
  }
  if (await db.patientEvent.count({ where: { patientId: patient.id } }) === 0) await db.patientEvent.createMany({ data: [
    { patientId: patient.id, kind: "created", title: "Начало наблюдения", detail: "Демонстрационный пример", createdAt: daysAgo(18) },
    { patientId: patient.id, kind: "note", title: "Запись врача", detail: "Обсудили изменения самочувствия и следующий контакт", createdAt: daysAgo(7) },
    ...(seed.userId ? [{ patientId: patient.id, kind: "connection", title: "Пациент подключён", detail: "Связь с ведущим врачом подтверждена", createdAt: daysAgo(17) }] : [])
  ] });
}
if (await db.message.count({ where: { patientId: "patient-anna" } }) === 0) {
  await db.message.createMany({ data: [
    { patientId: "patient-anna", senderId: "demo-doctor", text: "Анна, здравствуйте. Здесь можно написать мне и сохранить вопросы к следующему приёму.", requestKey: "seed-msg-1", createdAt: daysAgo(3), readAt: daysAgo(3) },
    { patientId: "patient-anna", senderId: "demo-patient", text: "Здравствуйте! Оставила отметку о самочувствии. Хотела бы обсудить сон на следующей встрече.", requestKey: "seed-msg-2", createdAt: daysAgo(0, -2) }
  ] });
}
console.info("Синтетические аккаунты и примеры подготовлены. Повторный seed не удаляет пользовательские записи.");
await publishSeedDefinition(demoDefinition);
for (const definition of [...f40Definitions, ...f40NotificationDefinitions]) await publishSeedDefinition(definition);
await db.$disconnect();
