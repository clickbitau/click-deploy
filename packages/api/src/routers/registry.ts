// ============================================================
// Click-Deploy — Registry Router
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { registries, nodes, sshKeys } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';
import { encryptPrivateKey, decryptPrivateKey } from '../crypto';
import { sshManager } from '@click-deploy/docker';

export const registryRouter = createRouter({
  /** List registries for org (credentials masked) */
  list: protectedProcedure.query(async ({ ctx }) => {
    const regs = await ctx.db.query.registries.findMany({
      where: eq(registries.organizationId, ctx.session.organizationId),
    });

    // Mask credentials
    return regs.map((r) => ({
      ...r,
      username: r.username ? '***' : null,
      password: r.password ? '***' : null,
    }));
  }),

  /** Add a registry */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      type: z.enum(['dockerhub', 'ghcr', 'ecr', 'self_hosted', 'custom']),
      url: z.string().url().max(500),
      username: z.string().optional(),
      password: z.string().optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // If setting as default, unset any existing default
      if (input.isDefault) {
        await ctx.db
          .update(registries)
          .set({ isDefault: false })
          .where(eq(registries.organizationId, ctx.session.organizationId));
      }

      // Encrypt credentials before storage
      const encryptedUsername = input.username ? encryptPrivateKey(input.username) : null;
      const encryptedPassword = input.password ? encryptPrivateKey(input.password) : null;

      const [registry] = await ctx.db
        .insert(registries)
        .values({
          ...input,
          username: encryptedUsername,
          password: encryptedPassword,
          organizationId: ctx.session.organizationId,
        })
        .returning();

      return registry;
    }),

  /** Delete a registry */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(registries)
        .where(
          and(
            eq(registries.id, input.id),
            eq(registries.organizationId, ctx.session.organizationId)
          )
        );

      return { success: true };
    }),

  /** Test registry connectivity — actually runs docker login on the manager node */
  testConnection: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const registry = await ctx.db.query.registries.findFirst({
        where: and(
          eq(registries.id, input.id),
          eq(registries.organizationId, ctx.session.organizationId)
        ),
      });

      if (!registry) throw new Error('Registry not found');

      // Self-hosted registries might not need login — just check /v2/
      if (registry.type === 'self_hosted' && !registry.username) {
        try {
          const managerNode = await ctx.db.query.nodes.findFirst({
            where: and(
              eq(nodes.organizationId, ctx.session.organizationId),
              eq(nodes.role, 'manager'),
              eq(nodes.status, 'online'),
            ),
            with: { sshKey: true },
          });

          if (!managerNode?.sshKey) {
            return { success: false, message: 'No online manager node available to test' };
          }

          const sshConfig = {
            host: managerNode.host,
            port: managerNode.port,
            username: managerNode.sshUser,
            privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
          };

          const result = await sshManager.exec(sshConfig, `curl -sf -m 5 ${registry.url}/v2/ >/dev/null 2>&1 && echo 'ok' || echo 'fail'`);
          const ok = result.stdout.trim() === 'ok';
          return { success: ok, message: ok ? 'Registry is reachable' : 'Registry is not reachable' };
        } catch (err: any) {
          return { success: false, message: err.message || 'Connection failed' };
        }
      }

      // For authenticated registries, try docker login
      if (registry.username && registry.password) {
        try {
          const managerNode = await ctx.db.query.nodes.findFirst({
            where: and(
              eq(nodes.organizationId, ctx.session.organizationId),
              eq(nodes.role, 'manager'),
              eq(nodes.status, 'online'),
            ),
            with: { sshKey: true },
          });

          if (!managerNode?.sshKey) {
            return { success: false, message: 'No online manager node available to test' };
          }

          const sshConfig = {
            host: managerNode.host,
            port: managerNode.port,
            username: managerNode.sshUser,
            privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
          };

          const username = decryptPrivateKey(registry.username);
          const password = decryptPrivateKey(registry.password);

          const result = await sshManager.exec(
            sshConfig,
            `echo '${password.replace(/'/g, "'\\''")}' | docker login ${registry.url} -u '${username.replace(/'/g, "'\\''")}' --password-stdin 2>&1`
          );

          const ok = result.code === 0;
          // Clean up docker config after test
          await sshManager.exec(sshConfig, `docker logout ${registry.url} 2>/dev/null || true`);

          return {
            success: ok,
            message: ok ? 'Login successful' : result.stdout.trim() || result.stderr.trim() || 'Login failed',
          };
        } catch (err: any) {
          return { success: false, message: err.message || 'Connection failed' };
        }
      }

      return { success: true, message: 'No credentials to test — registry assumed reachable' };
    }),
});
