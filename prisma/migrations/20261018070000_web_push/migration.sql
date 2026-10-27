CREATE TABLE "PushDevice" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "sessionId" TEXT,
  "endpointHash" TEXT NOT NULL, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
  "keyFingerprint" TEXT NOT NULL, "label" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushDevice_endpointHash_key" ON "PushDevice"("endpointHash");
CREATE INDEX "PushDevice_userId_active_idx" ON "PushDevice"("userId", "active");
CREATE TABLE "PushDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY, "deviceId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "eventId" TEXT, "requestKey" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "revision" INTEGER NOT NULL DEFAULT 0, "attempts" INTEGER NOT NULL DEFAULT 0, "errorCode" TEXT,
  "nextAttemptAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3), "shownAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PushDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ReviewEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushDelivery_requestKey_key" ON "PushDelivery"("requestKey");
CREATE UNIQUE INDEX "PushDelivery_eventId_deviceId_key" ON "PushDelivery"("eventId", "deviceId");
CREATE INDEX "PushDelivery_deviceId_createdAt_idx" ON "PushDelivery"("deviceId", "createdAt");
