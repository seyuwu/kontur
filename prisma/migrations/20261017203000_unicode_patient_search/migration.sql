-- ILIKE under the database's C locale does not fold Cyrillic case.
-- Pin Unicode behavior for searchable identifiers, independent of initdb locale.
CREATE COLLATION IF NOT EXISTS "kontur_search" (provider = icu, locale = 'und', deterministic = true);
ALTER TABLE "Patient" ALTER COLUMN "name" TYPE TEXT COLLATE "kontur_search";
ALTER TABLE "Patient" ALTER COLUMN "publicId" TYPE TEXT COLLATE "kontur_search";
