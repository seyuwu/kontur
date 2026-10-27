import { describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { canonicalProfile, emptyProfile, profileContentSchema } from "../../src/modules/clinical-profile/contract";
const evidence = { kind: "DOCUMENT" as const, reference: "Учебная выписка", date: "2026-10-17" };
describe("Смысл и происхождение клинических сведений", () => {
  test("неизвестность отличается от отрицательного ответа с источником", () => {
    const content = emptyProfile(); expect(profileContentSchema.safeParse(content).success).toBe(true);
    content.allergies.status = "NONE"; expect(profileContentSchema.safeParse(content).success).toBe(false);
    content.allergies.evidence = evidence; expect(profileContentSchema.safeParse(content).success).toBe(true);
    content.allergies.items = [{ id: randomUUID(), title: "Противоречащая запись", details: "", evidence }]; expect(profileContentSchema.safeParse(content).success).toBe(false);
  });
  test("прошлый приём не может иметь невозможную последовательность дат", () => {
    const content = emptyProfile(); content.medications.status = "KNOWN";
    content.medications.items = [{ id: randomUUID(), title: "Учебный препарат", details: "", evidence, intake: "STOPPED", regimen: "", startedOn: "2026-10-17", stoppedOn: "2026-10-01" }];
    expect(profileContentSchema.safeParse(content).success).toBe(false);
    content.medications.items[0].stoppedOn = "2026-10-18"; expect(profileContentSchema.safeParse(content).success).toBe(true);
    content.medications.items[0].intake = "TAKING"; expect(profileContentSchema.safeParse(content).success).toBe(false);
  });
  test("переключение статуса сохраняет локальный ввод, но публикует только выбранную ветку", () => {
    const content = emptyProfile(); content.conditions.status = "UNKNOWN"; content.conditions.items = [{ id: randomUUID(), title: "Учебное сведение", details: "", evidence }];
    const normalized = canonicalProfile(content); expect(normalized.conditions.items).toEqual([]); expect(content.conditions.items).toHaveLength(1);
    content.conditions.status = "KNOWN"; expect(canonicalProfile(content).conditions.items).toHaveLength(1);
  });
  test("неверная календарная дата и повтор идентичности отклоняются", () => {
    const content = emptyProfile(); const id = randomUUID(); content.conditions = { status: "KNOWN", note: "", evidence: null, items: [{ id, title: "Учебное сведение", details: "", evidence }] };
    content.allergies = { ...content.conditions }; expect(profileContentSchema.safeParse(content).success).toBe(false);
    content.allergies = emptyProfile().allergies; content.conditions.items[0].evidence = { ...evidence, date: "2026-02-30" }; expect(profileContentSchema.safeParse(content).success).toBe(false);
  });
});
