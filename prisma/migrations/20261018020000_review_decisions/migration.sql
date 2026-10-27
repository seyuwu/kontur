-- AlterTable
ALTER TABLE "ReviewEvent" ADD COLUMN     "currentBasisId" TEXT,
ADD COLUMN     "resolutionMethod" TEXT,
ADD COLUMN     "resolutionPayloadHash" TEXT,
ADD COLUMN     "resolutionRequestKey" TEXT;

-- CreateTable
CREATE TABLE "ReviewBasisVersion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contextToken" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewBasisVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewMessageExecution" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "basisId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewMessageExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewBasisVersion_eventId_version_key" ON "ReviewBasisVersion"("eventId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMessageExecution_messageId_key" ON "ReviewMessageExecution"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMessageExecution_requestKey_key" ON "ReviewMessageExecution"("requestKey");

-- CreateIndex
CREATE INDEX "ReviewMessageExecution_eventId_createdAt_id_idx" ON "ReviewMessageExecution"("eventId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_resolutionRequestKey_key" ON "ReviewEvent"("resolutionRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_currentBasisId_key" ON "ReviewEvent"("currentBasisId");

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_currentBasisId_fkey" FOREIGN KEY ("currentBasisId") REFERENCES "ReviewBasisVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewBasisVersion" ADD CONSTRAINT "ReviewBasisVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ReviewEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMessageExecution" ADD CONSTRAINT "ReviewMessageExecution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ReviewEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMessageExecution" ADD CONSTRAINT "ReviewMessageExecution_basisId_fkey" FOREIGN KEY ("basisId") REFERENCES "ReviewBasisVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
