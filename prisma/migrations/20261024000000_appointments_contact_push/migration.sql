ALTER TABLE "CarePlanVersion" ADD COLUMN "appointment" JSONB;
ALTER TABLE "PushDelivery" ADD COLUMN "observationId" TEXT;
CREATE UNIQUE INDEX "PushDelivery_observationId_deviceId_key" ON "PushDelivery"("observationId", "deviceId");
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
