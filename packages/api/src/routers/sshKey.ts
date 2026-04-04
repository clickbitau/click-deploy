// ============================================================
// Click-Deploy — SSH Key Router
// ============================================================
// CRUD for SSH keys with encryption at rest.
// Private keys are encrypted using AES-256-GCM before storage.
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { sshKeys } from '@click-deploy/database';
import { createRouter, adminProcedure } from '../trpc';
import { encryptPrivateKey, decryptPrivateKey, computeFingerprint } from '../crypto';

export const sshKeyRouter = createRouter({
  /** List SSH keys (without private key content) */
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.query.sshKeys.findMany({
      where: eq(sshKeys.organizationId, ctx.session.organizationId),
      columns: {
        id: true,
        name: true,
        publicKey: true,
        fingerprint: true,
        createdAt: true,
        // private key deliberately excluded
      },
    });
  }),

  /** Add a new SSH key (encrypts private key before storage) */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      privateKey: z.string().min(1),
      publicKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Encrypt the private key before storing
      const encryptedKey = encryptPrivateKey(input.privateKey);

      // Compute fingerprint from public key if provided
      const fingerprint = input.publicKey
        ? computeFingerprint(input.publicKey)
        : undefined;

      const [key] = await ctx.db
        .insert(sshKeys)
        .values({
          name: input.name,
          privateKey: encryptedKey,
          publicKey: input.publicKey,
          fingerprint,
          organizationId: ctx.session.organizationId,
        })
        .returning({
          id: sshKeys.id,
          name: sshKeys.name,
          publicKey: sshKeys.publicKey,
          fingerprint: sshKeys.fingerprint,
          createdAt: sshKeys.createdAt,
        });

      return key;
    }),

  /** Generate a new Ed25519 keypair server-side */
  generate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const sshpk = await import('sshpk');

      // Generate Ed25519 keypair using sshpk which outputs native OpenSSH format
      const generatedKey = sshpk.generatePrivateKey('ed25519');

      // Convert public key to SSH format for authorized_keys
      const sshPublicKey = generatedKey.toPublic().toString('ssh') + ' ' + input.name;
      const privateKeyStr = generatedKey.toString('openssh');

      // Encrypt the private key before storing
      const encryptedKey = encryptPrivateKey(privateKeyStr);
      const fingerprint = computeFingerprint(sshPublicKey);

      const [key] = await ctx.db
        .insert(sshKeys)
        .values({
          name: input.name,
          privateKey: encryptedKey,
          publicKey: sshPublicKey,
          fingerprint,
          organizationId: ctx.session.organizationId,
        })
        .returning({
          id: sshKeys.id,
          name: sshKeys.name,
          publicKey: sshKeys.publicKey,
          fingerprint: sshKeys.fingerprint,
          createdAt: sshKeys.createdAt,
        });

      // Return public key so user can add it to their servers
      return {
        ...key,
        publicKeyForCopy: sshPublicKey,
      };
    }),

  /** Delete an SSH key */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // The FK constraint (onDelete: 'restrict') on nodes.sshKeyId
      // will prevent deletion if any nodes still reference this key.
      await ctx.db
        .delete(sshKeys)
        .where(
          and(
            eq(sshKeys.id, input.id),
            eq(sshKeys.organizationId, ctx.session.organizationId)
          )
        );

      return { success: true };
    }),
});

