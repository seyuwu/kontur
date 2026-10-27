-- Preserve versioned plans; project the already agreed appointment date into the card.
UPDATE "Patient" AS p
SET "nextVisit" = (substring(c."appointment"->>'at', 1, 10) || 'T09:00:00')::timestamp,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "CarePlanVersion" AS c
WHERE p."currentPlanId" = c.id
  AND c."appointment"->>'at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$';
