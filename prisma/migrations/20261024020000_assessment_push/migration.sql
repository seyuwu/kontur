ALTER TABLE "PushDelivery" ADD COLUMN "assignmentId" TEXT, ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'TEST';
UPDATE "PushDelivery" SET "purpose" = CASE WHEN "observationId" IS NOT NULL THEN 'CONTACT' WHEN "eventId" IS NOT NULL THEN 'LEGACY_EVENT' ELSE 'TEST' END;
CREATE UNIQUE INDEX "PushDelivery_assignmentId_deviceId_purpose_key" ON "PushDelivery"("assignmentId", "deviceId", "purpose");
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssessmentAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
