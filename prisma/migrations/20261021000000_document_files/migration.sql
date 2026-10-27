ALTER TABLE "ClinicalDocument"
  ADD COLUMN "sourceBytes" BYTEA,
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourceMime" TEXT,
  ADD COLUMN "sourceChecksum" TEXT,
  ADD COLUMN "sourcePages" INTEGER,
  ADD COLUMN "parserVersion" TEXT,
  ADD COLUMN "sourceWarnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
