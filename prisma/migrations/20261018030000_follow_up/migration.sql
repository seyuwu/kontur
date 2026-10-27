-- AlterTable
ALTER TABLE "CareTask" ADD COLUMN     "repeat" TEXT;

-- CreateTable
CREATE TABLE "CareDailyReport" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "needsContact" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientConcern" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startedOn" TEXT,
    "impact" TEXT NOT NULL,
    "planVersionId" TEXT,
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientConcern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "basisToken" TEXT NOT NULL,
    "clinicalProfileVersionId" TEXT,
    "planVersionId" TEXT,
    "confirmedById" TEXT NOT NULL,
    "confirmedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralUpdate" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "date" TEXT,
    "note" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareDailyReport_requestKey_key" ON "CareDailyReport"("requestKey");

-- CreateIndex
CREATE INDEX "CareDailyReport_planVersionId_taskId_idx" ON "CareDailyReport"("planVersionId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "CareDailyReport_taskId_date_revision_key" ON "CareDailyReport"("taskId", "date", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "PatientConcern_requestKey_key" ON "PatientConcern"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PatientConcern_messageId_key" ON "PatientConcern"("messageId");

-- CreateIndex
CREATE INDEX "PatientConcern_patientId_createdAt_id_idx" ON "PatientConcern"("patientId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Referral_patientId_createdAt_id_idx" ON "Referral"("patientId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralUpdate_requestKey_key" ON "ReferralUpdate"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralUpdate_referralId_revision_key" ON "ReferralUpdate"("referralId", "revision");

-- AddForeignKey
ALTER TABLE "CareDailyReport" ADD CONSTRAINT "CareDailyReport_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CareTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareDailyReport" ADD CONSTRAINT "CareDailyReport_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "CarePlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConcern" ADD CONSTRAINT "PatientConcern_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralUpdate" ADD CONSTRAINT "ReferralUpdate_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
