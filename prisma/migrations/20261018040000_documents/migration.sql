-- CreateTable
CREATE TABLE "ClinicalDocument" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TEXT,
    "text" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentExtraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "inputChecksum" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "result" JSONB,
    "resultChecksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalDocument_requestKey_key" ON "ClinicalDocument"("requestKey");

-- CreateIndex
CREATE INDEX "ClinicalDocument_patientId_createdAt_id_idx" ON "ClinicalDocument"("patientId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentExtraction_requestKey_key" ON "DocumentExtraction"("requestKey");

-- CreateIndex
CREATE INDEX "DocumentExtraction_documentId_createdAt_id_idx" ON "DocumentExtraction"("documentId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClinicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
