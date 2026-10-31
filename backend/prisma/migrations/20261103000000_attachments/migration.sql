-- Additive V2 migration. No historical rows are changed.
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "storageKey" UUID NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    "sampleId" UUID NOT NULL,
    "stepId" UUID,
    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Attachment_size_check" CHECK ("size" > 0),
    CONSTRAINT "Attachment_mime_check" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'application/pdf', 'text/csv')),
    CONSTRAINT "Attachment_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");
CREATE INDEX "Attachment_sampleId_stepId_createdAt_idx" ON "Attachment"("sampleId", "stepId", "createdAt");
CREATE INDEX "Attachment_stepId_idx" ON "Attachment"("stepId");
CREATE INDEX "Attachment_createdById_idx" ON "Attachment"("createdById");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FabricationStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Enforce the association even for writes outside the application, without
-- changing the existing FabricationStep key or Prisma relations.
CREATE FUNCTION attachment_matches_sample() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."stepId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FabricationStep" WHERE "id" = NEW."stepId" AND "sampleId" = NEW."sampleId"
  ) THEN
    RAISE EXCEPTION 'Attachment step must belong to its sample' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Attachment_sample_step_check" BEFORE INSERT OR UPDATE ON "Attachment"
FOR EACH ROW EXECUTE FUNCTION attachment_matches_sample();
CREATE FUNCTION preserve_attachment_sample() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Attachment" WHERE "stepId" = NEW."id" AND "sampleId" <> NEW."sampleId") THEN
    RAISE EXCEPTION 'Cannot move a step with attachments to another sample' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FabricationStep_attachment_sample_check" BEFORE UPDATE OF "sampleId" ON "FabricationStep"
FOR EACH ROW EXECUTE FUNCTION preserve_attachment_sample();
