CREATE TABLE "SavedSummary" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedSummary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedSummary_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SavedSummary_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SavedSummary_patientId_doctorId_scopeKey_key" ON "SavedSummary"("patientId", "doctorId", "scopeKey");
