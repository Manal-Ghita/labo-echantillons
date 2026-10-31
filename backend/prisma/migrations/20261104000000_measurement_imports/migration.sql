-- V2 additive migration: measurements never replace fabrication parameters.
CREATE TABLE "MeasurementImport" (
  "id" UUID NOT NULL PRIMARY KEY,
  "sampleId" UUID NOT NULL REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stepId" UUID REFERENCES "FabricationStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stepTypeId" UUID NOT NULL REFERENCES "StepType"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceAttachmentId" UUID NOT NULL REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceSha256" CHAR(64) NOT NULL CHECK ("sourceSha256" ~ '^[0-9a-f]{64}$'),
  "deduplicationKey" CHAR(64) NOT NULL CHECK ("deduplicationKey" ~ '^[0-9a-f]{64}$'),
  "format" VARCHAR(20) NOT NULL DEFAULT 'CSV',
  "settings" JSONB NOT NULL,
  "rowCount" INTEGER NOT NULL CHECK ("rowCount" BETWEEN 1 AND 500),
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MeasurementImport_deduplicationKey_key" ON "MeasurementImport"("deduplicationKey");
CREATE INDEX "MeasurementImport_sampleId_stepId_createdAt_idx" ON "MeasurementImport"("sampleId","stepId","createdAt");
CREATE INDEX "MeasurementImport_sourceAttachmentId_idx" ON "MeasurementImport"("sourceAttachmentId");
CREATE INDEX "MeasurementImport_stepTypeId_idx" ON "MeasurementImport"("stepTypeId");
CREATE INDEX "MeasurementImport_createdById_idx" ON "MeasurementImport"("createdById");
CREATE TABLE "ImportedMeasurementValue" (
  "id" UUID NOT NULL PRIMARY KEY,
  "importId" UUID NOT NULL REFERENCES "MeasurementImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "rowNumber" INTEGER NOT NULL CHECK ("rowNumber" BETWEEN 1 AND 500),
  "sourceLine" INTEGER NOT NULL CHECK ("sourceLine" >= 2),
  "definitionId" UUID NOT NULL REFERENCES "ParameterDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "numericValue" DECIMAL(65,30),
  "textValue" TEXT,
  "booleanValue" BOOLEAN,
  CONSTRAINT "ImportedMeasurementValue_one_value" CHECK (num_nonnulls("numericValue","textValue","booleanValue") = 1)
);
CREATE UNIQUE INDEX "ImportedMeasurementValue_importId_rowNumber_definitionId_key" ON "ImportedMeasurementValue"("importId","rowNumber","definitionId");
CREATE INDEX "ImportedMeasurementValue_definitionId_numericValue_idx" ON "ImportedMeasurementValue"("definitionId","numericValue");
CREATE FUNCTION validate_measurement_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a.id=NEW."sourceAttachmentId"
    AND a."sampleId"=NEW."sampleId" AND a."sha256"=NEW."sourceSha256" AND a."mimeType"='text/csv'
    AND (a."stepId" IS NULL OR a."stepId"=NEW."stepId")) THEN
    RAISE EXCEPTION 'Inconsistent import source' USING ERRCODE='23514';
  END IF;
  IF NEW."stepId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FabricationStep" s
    WHERE s.id=NEW."stepId" AND s."sampleId"=NEW."sampleId" AND s."stepTypeId"=NEW."stepTypeId") THEN
    RAISE EXCEPTION 'Inconsistent import step' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "MeasurementImport_association_check" BEFORE INSERT OR UPDATE ON "MeasurementImport"
FOR EACH ROW EXECUTE FUNCTION validate_measurement_import();
CREATE FUNCTION validate_imported_measurement_value() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ParameterDefinition" d JOIN "MeasurementImport" i ON i.id=NEW."importId"
    WHERE d.id=NEW."definitionId" AND d."stepTypeId"=i."stepTypeId" AND NEW."rowNumber"<=i."rowCount"
    AND ((d."dataType"='NUMBER' AND NEW."numericValue" IS NOT NULL)
      OR (d."dataType"='TEXT' AND NEW."textValue" IS NOT NULL)
      OR (d."dataType"='BOOLEAN' AND NEW."booleanValue" IS NOT NULL))) THEN
    RAISE EXCEPTION 'Inconsistent imported parameter' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ImportedMeasurementValue_type_check" BEFORE INSERT OR UPDATE ON "ImportedMeasurementValue"
FOR EACH ROW EXECUTE FUNCTION validate_imported_measurement_value();
