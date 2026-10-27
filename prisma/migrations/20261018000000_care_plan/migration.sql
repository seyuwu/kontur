-- CreateEnum
CREATE TYPE "CareDraftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "CareTaskKind" AS ENUM ('ACTION', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "CareReportState" AS ENUM ('DONE', 'NOT_DONE', 'NEEDS_HELP');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "clinicalDataVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentPlanId" TEXT;

-- CreateTable
CREATE TABLE "CarePlanDraft" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "CareDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "basisToken" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePlanDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanVersion" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "goal" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "nextContactDate" TEXT,
    "basisToken" TEXT NOT NULL,
    "clinicalDataVersion" INTEGER NOT NULL,
    "previousPlanId" TEXT,
    "confirmedById" TEXT NOT NULL,
    "confirmedByName" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmationKey" TEXT NOT NULL,
    "confirmationHash" TEXT NOT NULL,

    CONSTRAINT "CarePlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareTask" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" "CareTaskKind" NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "dueDate" TEXT,
    "assignmentId" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanTask" (
    "planId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CarePlanTask_pkey" PRIMARY KEY ("planId","taskId")
);

-- CreateTable
CREATE TABLE "CareTaskReport" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" "CareReportState" NOT NULL,
    "note" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareTaskReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarePlanDraft_patientId_key" ON "CarePlanDraft"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlanVersion_confirmationKey_key" ON "CarePlanVersion"("confirmationKey");

-- CreateIndex
CREATE INDEX "CarePlanVersion_patientId_confirmedAt_id_idx" ON "CarePlanVersion"("patientId", "confirmedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlanVersion_patientId_version_key" ON "CarePlanVersion"("patientId", "version");

-- CreateIndex
CREATE INDEX "CareTask_patientId_id_idx" ON "CareTask"("patientId", "id");

-- CreateIndex
CREATE INDEX "CarePlanTask_taskId_idx" ON "CarePlanTask"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlanTask_planId_position_key" ON "CarePlanTask"("planId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CareTaskReport_requestKey_key" ON "CareTaskReport"("requestKey");

-- CreateIndex
CREATE INDEX "CareTaskReport_planVersionId_taskId_idx" ON "CareTaskReport"("planVersionId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "CareTaskReport_taskId_revision_key" ON "CareTaskReport"("taskId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_currentPlanId_key" ON "Patient"("currentPlanId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "CarePlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanDraft" ADD CONSTRAINT "CarePlanDraft_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanVersion" ADD CONSTRAINT "CarePlanVersion_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTask" ADD CONSTRAINT "CareTask_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTask" ADD CONSTRAINT "CareTask_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssessmentAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanTask" ADD CONSTRAINT "CarePlanTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CarePlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarePlanTask" ADD CONSTRAINT "CarePlanTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CareTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTaskReport" ADD CONSTRAINT "CareTaskReport_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CareTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareTaskReport" ADD CONSTRAINT "CareTaskReport_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "CarePlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
