CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Patient_doctorId_updatedAt_id_idx" ON "Patient"("doctorId", "updatedAt", "id");
CREATE INDEX "Patient_doctorId_nextVisit_id_idx" ON "Patient"("doctorId", "nextVisit", "id");
CREATE INDEX "Patient_name_trgm_idx" ON "Patient" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Patient_publicId_trgm_idx" ON "Patient" USING GIN ("publicId" gin_trgm_ops);
CREATE INDEX "Observation_patientId_needsContact_acknowledgedAt_idx" ON "Observation"("patientId", "needsContact", "acknowledgedAt");
CREATE INDEX "Message_patientId_readAt_senderId_idx" ON "Message"("patientId", "readAt", "senderId");
