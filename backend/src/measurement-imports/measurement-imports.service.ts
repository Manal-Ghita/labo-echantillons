import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { FileStorage } from '../attachments/file-storage.service';
import { decimalValue } from '../fabrication-steps/decimal-value';
import { measurementParsers } from './csv-parser';
import type {
  ConfirmImportDto,
  InspectCsvDto,
  PreviewImportDto,
} from './import.dto';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicImport = {
  id: true,
  sampleId: true,
  stepId: true,
  rowCount: true,
  format: true,
  createdAt: true,
  settings: true,
  createdBy: { select: { id: true, name: true } },
  sourceAttachment: { select: { id: true, originalName: true } },
  stepType: { select: { id: true, name: true } },
} satisfies Prisma.MeasurementImportSelect;
type Actor = Pick<AuthenticatedUser, 'id' | 'role'>;
type ImportValue = {
  rowNumber: number;
  sourceLine: number;
  definitionId: string;
  numericValue?: string;
  textValue?: string;
  booleanValue?: boolean;
};

@Injectable()
export class MeasurementImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly jwt: JwtService,
  ) {}
  private async access(
    tx: Prisma.TransactionClient,
    sampleId: string,
    actor?: Actor,
  ) {
    const sample = await tx.sample.findUnique({
      where: { id: sampleId },
      select: { creatorId: true },
    });
    if (!sample) throw new NotFoundException('Échantillon introuvable.');
    if (actor && actor.role !== 'ADMIN' && sample.creatorId !== actor.id)
      throw new ForbiddenException(
        'Import réservé au propriétaire ou à ADMIN.',
      );
  }
  private async source(
    tx: Prisma.TransactionClient,
    sampleId: string,
    attachmentId: string,
  ) {
    const source = await tx.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!source || source.sampleId !== sampleId.toLowerCase())
      throw new NotFoundException(
        'Fichier source introuvable pour cet échantillon.',
      );
    if (source.mimeType !== 'text/csv')
      throw new BadRequestException(['Le fichier source doit être un CSV.']);
    let bytes: Buffer;
    try { bytes = await this.storage.read(source.storageKey); }
    catch { throw new ServiceUnavailableException('Le fichier source est indisponible.'); }
    if (
      bytes.length !== source.size ||
      createHash('sha256').update(bytes).digest('hex') !== source.sha256
    )
      throw new ConflictException(
        'Le fichier source a changé ou est corrompu.',
      );
    return { source, bytes };
  }
  async inspect(sampleId: string, dto: InspectCsvDto, actor: Actor) {
    await this.access(this.prisma, sampleId, actor);
    const { bytes } = await this.source(
      this.prisma,
      sampleId,
      dto.attachmentId,
    );
    const parsed = measurementParsers.CSV.parse(bytes, dto.delimiter);
    return {
      headers: parsed.headers,
      rowCount: parsed.records.length,
      rows: parsed.records.slice(0, 10),
    };
  }
  private settings(dto: PreviewImportDto) {
    return {
      attachmentId: dto.attachmentId.toLowerCase(),
      stepId: dto.stepId?.toLowerCase() ?? null,
      stepTypeId: dto.stepTypeId.toLowerCase(),
      delimiter: dto.delimiter,
      decimalSeparator: dto.decimalSeparator,
      mappings: [...dto.mappings]
        .sort((a, b) => a.column - b.column)
        .map((m) => ({
          column: m.column,
          definitionId: m.definitionId.toLowerCase(),
          unit: m.unit,
        })),
    };
  }
  private async prepare(
    tx: Prisma.TransactionClient,
    sampleId: string,
    dto: PreviewImportDto,
    actor: Actor,
  ) {
    await this.access(tx, sampleId, actor);
    const { source, bytes } = await this.source(tx, sampleId, dto.attachmentId);
    if (source.stepId && source.stepId !== dto.stepId?.toLowerCase())
      throw new BadRequestException([
        'Le fichier appartient à une autre étape.',
      ]);
    const type = await tx.stepType.findUnique({
      where: { id: dto.stepTypeId },
      include: { parameters: true },
    });
    if (!type?.isActive)
      throw new BadRequestException(['Choisissez un type d’opération actif.']);
    if (dto.stepId) {
      const step = await tx.fabricationStep.findFirst({
        where: { id: dto.stepId, sampleId },
        select: { stepTypeId: true },
      });
      if (!step)
        throw new NotFoundException('Étape introuvable pour cet échantillon.');
      if (step.stepTypeId !== type.id)
        throw new BadRequestException([
          'Les paramètres doivent appartenir au type de cette étape.',
        ]);
    }
    const parsed = measurementParsers.CSV.parse(bytes, dto.delimiter);
    const usedColumns = new Set<number>(),
      usedDefinitions = new Set<string>();
    const definitions = dto.mappings.map((m) => {
      const definition = type.parameters.find(
        (d) => d.id === m.definitionId.toLowerCase(),
      );
      if (!definition || !parsed.headers[m.column])
        throw new BadRequestException(['Colonne ou paramètre inconnu.']);
      if (
        usedColumns.has(m.column) ||
        usedDefinitions.has(m.definitionId.toLowerCase())
      )
        throw new BadRequestException([
          'Les colonnes et paramètres doivent être associés une seule fois.',
        ]);
      usedColumns.add(m.column);
      usedDefinitions.add(m.definitionId.toLowerCase());
      const headerUnit = /(?:\(([^()]*)\)|\[([^\]]*)\])\s*$/.exec(
        parsed.headers[m.column],
      );
      if (
        (m.unit ?? null) !== definition.unit ||
        (headerUnit &&
          (headerUnit[1] ?? headerUnit[2]) !== (definition.unit ?? ''))
      )
        throw new BadRequestException([
          `Unité incompatible pour ${definition.name} : ${definition.unit ?? 'sans unité'} attendue. Aucune conversion automatique.`,
        ]);
      return definition;
    });
    const errors: {
      row: number;
      line: number;
      column: string | null;
      message: string;
    }[] = [];
    const invalid = new Set<number>(),
      values: ImportValue[] = [];
    parsed.records.forEach((record, index) => {
      const rowNumber = index + 1;
      const error = (message: string, column: string | null = null) => {
        invalid.add(rowNumber);
        errors.push({ row: rowNumber, line: record.line, column, message });
      };
      if (record.cells.length !== parsed.headers.length) {
        error(
          `Nombre de colonnes incorrect : ${record.cells.length}, attendu ${parsed.headers.length}.`,
        );
        return;
      }
      let count = 0;
      dto.mappings.forEach((mapping, position) => {
        const definition = definitions[position],
          raw = record.cells[mapping.column];
        const base = {
          rowNumber,
          sourceLine: record.line,
          definitionId: definition.id,
        };
        try {
          if (definition.dataType === 'TEXT')
            values.push({ ...base, textValue: raw });
          else if (!raw.trim() && !definition.isRequired) return;
          else if (definition.dataType === 'NUMBER') {
            const text = raw.trim();
            if (dto.decimalSeparator === ',' && text.includes('.'))
              throw new Error(
                'Utilisez la virgule décimale sélectionnée, sans séparateur de milliers.',
              );
            values.push({
              ...base,
              numericValue: decimalValue(
                dto.decimalSeparator === ',' ? text.replace(',', '.') : text,
              ).toFixed(),
            });
          } else {
            const text = raw.trim().toLowerCase();
            if (!['true', 'false', '1', '0'].includes(text))
              throw new Error('Valeur BOOLEAN attendue : true, false, 1 ou 0.');
            values.push({
              ...base,
              booleanValue: text === 'true' || text === '1',
            });
          }
          count++;
        } catch (e) {
          error(
            e instanceof Error ? e.message : 'Valeur invalide.',
            parsed.headers[mapping.column],
          );
        }
      });
      if (!count && !invalid.has(rowNumber))
        error('La ligne ne contient aucune mesure associée.');
    });
    const settings = {
      ...this.settings(dto),
      definitions: definitions.map((d) => ({
        id: d.id,
        name: d.name,
        key: d.key,
        dataType: d.dataType,
        unit: d.unit,
        isRequired: d.isRequired,
      })),
    };
    const deduplicationKey = hash([
      sampleId.toLowerCase(),
      dto.stepId?.toLowerCase() ?? null,
      source.sha256,
    ]);
    const duplicate = !!(await tx.measurementImport.findUnique({
      where: { deduplicationKey },
      select: { id: true },
    }));
    return {
      parsed,
      values,
      errors,
      invalid,
      settings,
      source,
      deduplicationKey,
      duplicate,
      inputHash: hash(this.settings(dto)),
      datasetHash: hash([source.sha256, settings, values]),
    };
  }
  async preview(sampleId: string, dto: PreviewImportDto, actor: Actor) {
    const prepared = await this.prepare(this.prisma, sampleId, dto, actor);
    const canConfirm = !prepared.errors.length && !prepared.duplicate;
    return {
      headers: prepared.parsed.headers,
      rowCount: prepared.parsed.records.length,
      validRowCount: prepared.parsed.records.length - prepared.invalid.size,
      errors: prepared.errors.slice(0, 100),
      errorCount: prepared.errors.length,
      rows: prepared.parsed.records.slice(0, 20).map((record, index) => ({
        row: index + 1,
        line: record.line,
        cells: record.cells,
      })),
      duplicate: prepared.duplicate,
      canConfirm,
      previewToken: canConfirm
        ? await this.jwt.signAsync(
            {
              purpose: 'measurement-import-preview',
              sub: actor.id,
              sampleId,
              inputHash: prepared.inputHash,
              datasetHash: prepared.datasetHash,
            },
            { expiresIn: 600 },
          )
        : null,
    };
  }
  async confirm(sampleId: string, dto: ConfirmImportDto, actor: Actor) {
    await this.access(this.prisma, sampleId, actor);
    if (dto.confirmed !== true)
      throw new BadRequestException(['Confirmation explicite requise.']);
    let token: {
      purpose: string;
      sub: string;
      sampleId: string;
      inputHash: string;
      datasetHash: string;
    };
    try {
      token = await this.jwt.verifyAsync(dto.previewToken);
    } catch {
      throw new ConflictException(
        'Prévisualisation expirée ou invalide. Recommencez la vérification.',
      );
    }
    if (
      token.purpose !== 'measurement-import-preview' ||
      token.sub !== actor.id ||
      token.sampleId !== sampleId ||
      token.inputHash !== hash(this.settings(dto))
    )
      throw new ConflictException(
        'La prévisualisation ne correspond plus à cette saisie.',
      );
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const p = await this.prepare(tx, sampleId, dto, actor);
          if (p.duplicate)
            throw new ConflictException(
              'Ce fichier a déjà été importé pour cette association.',
            );
          if (p.errors.length || p.datasetHash !== token.datasetHash)
            throw new ConflictException(
              'Le fichier ou les définitions ont changé. Recommencez la prévisualisation.',
            );
          return tx.measurementImport.create({
            data: {
              sampleId,
              stepId: dto.stepId ?? null,
              stepTypeId: dto.stepTypeId,
              sourceAttachmentId: p.source.id,
              sourceSha256: p.source.sha256,
              deduplicationKey: p.deduplicationKey,
              format: 'CSV',
              settings: p.settings,
              rowCount: p.parsed.records.length,
              createdById: actor.id,
              values: { createMany: { data: p.values } },
            },
            select: publicImport,
          });
        },
        { isolationLevel: 'Serializable', timeout: 20000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException(
          'Import déjà enregistré ou conflit concurrent. Rechargez les imports avant de réessayer.',
        );
      throw error;
    }
  }
  async list(sampleId: string) {
    await this.access(this.prisma, sampleId);
    return this.prisma.measurementImport.findMany({
      where: { sampleId },
      select: publicImport,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async detail(sampleId: string, id: string) {
    const data = await this.prisma.measurementImport.findFirst({
      where: { id, sampleId },
      select: {
        ...publicImport,
        values: {
          orderBy: [{ rowNumber: 'asc' }, { definitionId: 'asc' }],
          include: {
            definition: {
              select: { id: true, name: true, unit: true, dataType: true },
            },
          },
        },
      },
    });
    if (!data) throw new NotFoundException('Import introuvable.');
    return {
      ...data,
      values: data.values.map((v) => ({
        ...v,
        numericValue: v.numericValue?.toFixed() ?? null,
      })),
    };
  }
}
