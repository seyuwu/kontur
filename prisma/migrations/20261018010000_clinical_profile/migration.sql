-- AlterTable
ALTER TABLE "CarePlanVersion" ADD COLUMN     "clinicalProfileVersionId" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "currentClinicalProfileId" TEXT;

-- CreateTable
CREATE TABLE "ClinicalProfileVersion" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "previousVersionId" TEXT,
    "savedById" TEXT NOT NULL,
    "savedByName" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalProfileVersion_requestKey_key" ON "ClinicalProfileVersion"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalProfileVersion_patientId_version_key" ON "ClinicalProfileVersion"("patientId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_currentClinicalProfileId_key" ON "Patient"("currentClinicalProfileId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_currentClinicalProfileId_fkey" FOREIGN KEY ("currentClinicalProfileId") REFERENCES "ClinicalProfileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalProfileVersion" ADD CONSTRAINT "ClinicalProfileVersion_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
