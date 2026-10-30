BEGIN;

ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "User_authVersion_nonnegative" CHECK ("authVersion" >= 0);

COMMIT;
