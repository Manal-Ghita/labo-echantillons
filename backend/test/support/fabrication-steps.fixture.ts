import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { CreateFabricationStepDto } from '../../src/fabrication-steps/dto/create-fabrication-step.dto';

export const stepIds = {
  owner: '3fd8de68-8847-42fc-94df-99459f699ba9',
  admin: '6cc012be-8908-4c8d-b43b-e1df6664e4d0',
  other: '8a6cf578-1eaa-430b-9ef2-de089d528d7e',
  operator: 'a824c155-e2cc-428c-a83f-40b6f189b764',
  sample: 'b25dd475-83ce-47d7-8538-d2c53fcfcb4e',
  type: '762849cc-220e-4e4f-b4af-2e1593697d0e',
  number: 'e16a7c0b-c2c6-449d-910f-6e2dccf7c814',
  text: '88a729fd-729b-4f25-a1e9-fb0aef0c42dd',
  boolean: '05a52801-f3de-4944-928e-01f675437b9b',
};
export const exactDecimal = '120.12345678901234567890123456789';
export const createStepInput = () =>
  ({
    stepTypeId: stepIds.type,
    performedAt: '2026-10-29T10:30:00+01:00',
    result: 'SUCCESS',
    parameterValues: [
      { definitionId: stepIds.number, value: exactDecimal },
      { definitionId: stepIds.text, value: 'argon' },
      { definitionId: stepIds.boolean, value: false },
    ],
  }) satisfies CreateFabricationStepDto;

type NestedValue = {
  definitionId: string;
  numericValue?: Prisma.Decimal;
  textValue?: string;
  booleanValue?: boolean;
};
type StepData = {
  sampleId: string;
  stepTypeId: string;
  operationName: string;
  performedAt: Date;
  result: 'SUCCESS' | 'FAILURE';
  recordedById: string;
  operatorId?: string;
  observations?: string;
  parameterValues: { create: NestedValue[] };
};

export function fabricationMock() {
  const definitions = [
    {
      id: stepIds.number,
      stepTypeId: stepIds.type,
      key: 'temperature',
      name: 'Température',
      dataType: 'NUMBER',
      unit: 'C',
      isRequired: true,
    },
    {
      id: stepIds.text,
      stepTypeId: stepIds.type,
      key: 'atmosphere',
      name: 'Atmosphère',
      dataType: 'TEXT',
      unit: null,
      isRequired: false,
    },
    {
      id: stepIds.boolean,
      stepTypeId: stepIds.type,
      key: 'vacuum',
      name: 'Vide',
      dataType: 'BOOLEAN',
      unit: null,
      isRequired: true,
    },
  ];
  const sample = {
    findUnique: jest.fn().mockResolvedValue({
      id: stepIds.sample,
      creatorId: stepIds.owner,
      status: 'ACTIVE',
    }),
  };
  const stepType = {
    findUnique: jest.fn().mockResolvedValue({
      id: stepIds.type,
      name: 'Dépôt',
      code: 'DEPOSITION',
      isActive: true,
      parameters: definitions,
    }),
  };
  const users = [
    {
      id: stepIds.owner,
      name: 'Propriétaire',
      role: 'RESEARCHER',
      isActive: true,
      authVersion: 0,
    },
    {
      id: stepIds.admin,
      name: 'Administrateur',
      role: 'ADMIN',
      isActive: true,
      authVersion: 0,
    },
    {
      id: stepIds.other,
      name: 'Autre chercheur',
      role: 'RESEARCHER',
      isActive: true,
      authVersion: 0,
    },
    {
      id: stepIds.operator,
      name: 'Opérateur',
      role: 'RESEARCHER',
      isActive: true,
      authVersion: 0,
    },
  ];
  const user = {
    findUnique: jest
      .fn()
      .mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(users.find((record) => record.id === where.id) ?? null),
      ),
  };
  const create = jest
    .fn()
    .mockImplementation(({ data }: { data: StepData }) => {
      const id = randomUUID();
      return Promise.resolve({
        ...data,
        id,
        parameters: null,
        operatorId: data.operatorId ?? null,
        observations: data.observations ?? null,
        recordedAt: new Date('2026-10-29T12:00:00Z'),
        revision: 0,
        recordedBy: { id: data.recordedById, name: 'Auteur' },
        operator: data.operatorId
          ? { id: data.operatorId, name: 'Opérateur' }
          : null,
        stepType: {
          id: stepIds.type,
          code: 'DEPOSITION',
          name: 'Dépôt',
          isActive: true,
        },
        parameterValues: data.parameterValues.create.map((value) => ({
          ...value,
          id: randomUUID(),
          stepId: id,
          numericValue: value.numericValue ?? null,
          textValue: value.textValue ?? null,
          booleanValue: value.booleanValue ?? null,
          definition: definitions.find(
            (definition) => definition.id === value.definitionId,
          ),
        })),
      });
    });
  const tx = { sample, stepType, user, fabricationStep: { create } };
  const prisma = {
    sample,
    stepType,
    user,
    fabricationStep: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest
      .fn()
      .mockImplementation((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
  };
  const legacy = {
    id: randomUUID(),
    sampleId: stepIds.sample,
    operationName: 'Ancienne opération',
    parameters: 'temperature=120 C',
    observations: 'Ancien cahier',
    performedAt: new Date('2026-01-01'),
    recordedAt: new Date('2026-01-02'),
    recordedById: stepIds.owner,
    stepTypeId: null,
    result: null,
    operatorId: null,
    revision: 0,
    parameterValues: [],
    stepType: null,
    operator: null,
    recordedBy: { id: stepIds.owner, name: 'Propriétaire' },
  };
  return { prisma, tx, definitions, legacy };
}
