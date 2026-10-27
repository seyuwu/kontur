ALTER TYPE "CareTaskKind" ADD VALUE 'MEDICATION';
ALTER TABLE "CareTask" ADD COLUMN "startDate" TEXT, ADD COLUMN "time" TEXT, ADD COLUMN "medication" JSONB;
CREATE TABLE "PatientReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "patientId" TEXT NOT NULL REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipientId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "planId" TEXT,
  "taskId" TEXT REFERENCES "CareTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "assignmentId" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PatientReminder_patientId_dueAt_idx" ON "PatientReminder"("patientId", "dueAt");
ALTER TABLE "PushDelivery" ADD COLUMN "reminderId" TEXT REFERENCES "PatientReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PushDelivery_reminderId_deviceId_key" ON "PushDelivery"("reminderId", "deviceId");
