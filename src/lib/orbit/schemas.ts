import { z } from "zod";

import {
  ORBIT_ENTITLEMENTS,
  ORBIT_PERMISSIONS,
  ORBIT_ROLES,
} from "@/lib/orbit/policy";
import { ORBIT_TRANSFER_WARNING_CODES } from "@/lib/orbit/transfer-contract";
import { MAX_ORBIT_TRANSFER_AUTHOR_MAPPINGS } from "@/lib/orbit/transfer-authors";

const uuid = z.string().uuid();
const orbitTransferAuthorMappingSchema = z
  .object({
    sourceUserId: uuid,
    targetUserId: uuid,
  })
  .strict();
const normalizedSlug = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export const orbitBootstrapSchema = z
  .object({
    workspaceName: z.string().trim().min(2).max(160),
    workspaceSlug: normalizedSlug,
    instanceSlotLimit: z.number().int().min(1).max(10_000).default(5),
    billingInterval: z.enum(["monthly", "annual"]).default("monthly"),
  })
  .strict();

export const orbitPermissionSetSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).nullable().default(null),
    permissions: z.array(z.enum(ORBIT_PERMISSIONS)).max(10),
  })
  .strict();

export const orbitMembershipSchema = z
  .object({
    accountId: uuid,
    role: z.enum(ORBIT_ROLES),
    permissionSetId: uuid.nullable().default(null),
  })
  .strict();

export const orbitInstanceUpdateSchema = z
  .object({
    customerReference: z.string().trim().max(120).nullable().optional(),
    status: z.enum(["active", "suspended"]).optional(),
    seatLimit: z.number().int().min(1).max(1_000_000).optional(),
    courseLimit: z.number().int().min(1).max(1_000_000).optional(),
    entitlements: z.array(z.enum(ORBIT_ENTITLEMENTS)).max(6).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Mindestens ein Instanzwert muss angegeben werden.",
  });

export const orbitDelegationSchema = z
  .object({
    partnerAccountId: uuid,
    organizationId: uuid,
    permissions: z
      .array(
        z.enum([
          "instances:read",
          "transfers:read",
          "transfers:create",
          "audit:read",
        ]),
      )
      .min(1)
      .max(4),
    expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();

export const orbitClaimCreateSchema = z.object({}).strict();

export const orbitBillingUpdateSchema = z
  .object({
    status: z.enum(["active", "past_due", "suspended"]),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    billingInterval: z.enum(["monthly", "annual"]),
    baseFeeCents: z.number().int().min(0).max(100_000_000_000),
    includedInstanceSlots: z.number().int().min(0).max(10_000),
    additionalInstanceFeeCents: z
      .number()
      .int()
      .min(0)
      .max(100_000_000_000),
    settlementMode: z.enum(["manual", "external"]),
    externalCustomerReference: z.string().trim().max(180).nullable(),
    expectedRevision: z.number().int().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.settlementMode === "manual" &&
      value.externalCustomerReference !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["externalCustomerReference"],
        message: "Im manuellen Modus darf keine externe Kundenreferenz gesetzt sein.",
      });
    }
    if (value.settlementMode === "external" && !value.externalCustomerReference) {
      context.addIssue({
        code: "custom",
        path: ["externalCustomerReference"],
        message: "Fuer externe Abrechnung ist eine Kundenreferenz erforderlich.",
      });
    }
  });

export const orbitBillingFinalizeSchema = z.object({}).strict();

export const orbitClaimRedeemSchema = z
  .object({
    token: z.string().trim().min(32).max(256),
    customerReference: z.string().trim().max(120).nullable().default(null),
  })
  .strict();

const orbitTransferFields = {
  sourceOrganizationId: uuid,
  targetOrganizationId: uuid,
  sourceCourseIds: z.array(uuid).min(1).max(25),
  authorMappings: z
    .array(orbitTransferAuthorMappingSchema)
    .max(MAX_ORBIT_TRANSFER_AUTHOR_MAPPINGS)
    .default([]),
};

const differentTransferInstances = (value: {
  sourceOrganizationId: string;
  targetOrganizationId: string;
}) => value.sourceOrganizationId !== value.targetOrganizationId;

const normalizeOrbitTransfer = <
  T extends {
    sourceCourseIds: string[];
    authorMappings: Array<{ sourceUserId: string; targetUserId: string }>;
  },
>(
  value: T,
) => ({
  ...value,
  sourceCourseIds: [...new Set(value.sourceCourseIds)].sort(),
  authorMappings: [...value.authorMappings].sort((left, right) =>
    left.sourceUserId.localeCompare(right.sourceUserId) ||
    left.targetUserId.localeCompare(right.targetUserId),
  ),
});

export const orbitTransferSchema = z
  .object(orbitTransferFields)
  .strict()
  .refine(differentTransferInstances, {
    message: "Quell- und Zielinstanz muessen verschieden sein.",
  })
  .superRefine((value, context) => {
    if (
      new Set(value.authorMappings.map((mapping) => mapping.sourceUserId)).size !==
      value.authorMappings.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["authorMappings"],
        message: "Quellautoren duerfen nur einmal zugeordnet werden.",
      });
    }
  })
  .transform(normalizeOrbitTransfer);

export const orbitTransferExecutionSchema = z
  .object({
    ...orbitTransferFields,
    confirmationToken: z.string().regex(/^[0-9a-f]{64}$/),
    acceptedWarnings: z.array(z.enum(ORBIT_TRANSFER_WARNING_CODES)).max(
      ORBIT_TRANSFER_WARNING_CODES.length,
    ),
  })
  .strict()
  .refine(differentTransferInstances, {
    message: "Quell- und Zielinstanz muessen verschieden sein.",
  })
  .superRefine((value, context) => {
    if (new Set(value.acceptedWarnings).size !== value.acceptedWarnings.length) {
      context.addIssue({
        code: "custom",
        path: ["acceptedWarnings"],
        message: "Bestaetigte Transferwarnungen muessen eindeutig sein.",
      });
    }
    if (
      new Set(value.authorMappings.map((mapping) => mapping.sourceUserId)).size !==
      value.authorMappings.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["authorMappings"],
        message: "Quellautoren duerfen nur einmal zugeordnet werden.",
      });
    }
  })
  .transform(normalizeOrbitTransfer);

export type OrbitBootstrapInput = z.infer<typeof orbitBootstrapSchema>;
export type OrbitPermissionSetInput = z.infer<typeof orbitPermissionSetSchema>;
export type OrbitMembershipInput = z.infer<typeof orbitMembershipSchema>;
export type OrbitInstanceUpdateInput = z.infer<typeof orbitInstanceUpdateSchema>;
export type OrbitDelegationInput = z.infer<typeof orbitDelegationSchema>;
export type OrbitBillingUpdateInput = z.infer<typeof orbitBillingUpdateSchema>;
export type OrbitTransferInput = z.input<typeof orbitTransferSchema>;
export type OrbitTransferExecutionInput = z.input<
  typeof orbitTransferExecutionSchema
>;
