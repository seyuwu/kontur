ALTER TABLE "CareDailyReport" ADD COLUMN "time" TEXT NOT NULL DEFAULT '';
CREATE TABLE "MedicationSchedule" ("id" TEXT NOT NULL,"taskId" TEXT NOT NULL,"userId" TEXT NOT NULL,"revision" INTEGER NOT NULL,"times" JSONB NOT NULL,"requestKey" TEXT NOT NULL,"payloadHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "MedicationSchedule_pkey" PRIMARY KEY ("id"),CONSTRAINT "MedicationSchedule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CareTask"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "MedicationSchedule_requestKey_key" ON "MedicationSchedule"("requestKey");
CREATE UNIQUE INDEX "MedicationSchedule_taskId_userId_revision_key" ON "MedicationSchedule"("taskId","userId","revision");
