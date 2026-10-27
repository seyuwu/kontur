-- CreateEnum
CREATE TYPE "DefinitionMode" AS ENUM ('DEMO', 'CLINICAL');

-- CreateEnum
CREATE TYPE "DefinitionReview" AS ENUM ('DEMO', 'DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewEventStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "AssessmentDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" "DefinitionMode" NOT NULL,
    "review" "DefinitionReview" NOT NULL,
    "title" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAssignment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "definitionCode" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "dueAt" TIMESTAMP(3),
    "draftAnswers" JSONB NOT NULL DEFAULT '{}',
    "draftNote" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AssessmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentSubmission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "definitionChecksum" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "submittedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "definitionChecksum" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "mode" "DefinitionMode" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "actions" JSONB NOT NULL,
    "status" "ReviewEventStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionActionId" TEXT,
    "resolution" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentDefinition_mode_review_idx" ON "AssessmentDefinition"("mode", "review");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentDefinition_code_version_key" ON "AssessmentDefinition"("code", "version");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_patientId_status_createdAt_id_idx" ON "AssessmentAssignment"("patientId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_patientId_definitionCode_status_idx" ON "AssessmentAssignment"("patientId", "definitionCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentSubmission_assignmentId_key" ON "AssessmentSubmission"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentSubmission_requestKey_key" ON "AssessmentSubmission"("requestKey");

-- CreateIndex
CREATE INDEX "ReviewEvent_recipientId_status_createdAt_id_idx" ON "ReviewEvent"("recipientId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ReviewEvent_patientId_status_createdAt_id_idx" ON "ReviewEvent"("patientId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_submissionId_ruleId_key" ON "ReviewEvent"("submissionId", "ruleId");

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "AssessmentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSubmission" ADD CONSTRAINT "AssessmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssessmentAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssessmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
