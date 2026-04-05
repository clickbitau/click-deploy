// ============================================================
// Click-Deploy — GitHub Integration Router
// ============================================================
import { z } from 'zod';
import { publicProcedure, protectedProcedure, createRouter } from '../trpc';
import { db } from '@click-deploy/database';
import { githubApps, githubInstallations } from '@click-deploy/database/src/schema/integrations';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { encryptPrivateKey, decryptPrivateKey } from '../crypto';
import jwt from 'jsonwebtoken';

// Authenticates with GitHub API using App Private Key to get an Installation Access Token
export async function getInstallationToken(organizationId: string): Promise<string | null> {
  try {
    return (await getInstallationConfig(organizationId)).token;
  } catch {
    return null; // No GitHub App configured — public repos only
  }
}

async function getInstallationConfig(organizationId: string) {
  // Find the joined installation
  const app = await db.query.githubApps.findFirst({
    where: eq(githubApps.organizationId, organizationId),
    with: {
      installations: true,
    }
  });

  if (!app) throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub App not configured for this organization' });
  if (app.installations.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub App installed, but no repository installations found' });

  // Use the first installation
  const installation = app.installations[0];
  const pem = decryptPrivateKey(app.privateKey);

  // 1. Create JWT
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      iat: now - 60,
      exp: now + (10 * 60),
      iss: app.appId,
    },
    pem,
    { algorithm: 'RS256' }
  );

  // 2. Exchange JWT for Installation Access Token
  const response = await fetch(`https://api.github.com/app/installations/${installation.installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Click-Deploy'
    }
  });

  if (!response.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to acquire GitHub token: ${await response.text()}` });
  }

  const data = await response.json();
  return { token: data.token, installation };
}

export const githubRouter = createRouter({
  
  // Exchange Manifest Code for App Credentials
  createAppFromManifest: protectedProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app-from-a-manifest
      const response = await fetch(`https://api.github.com/app-manifests/${input.code}/conversions`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        }
      });

      if (!response.ok) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `GitHub API error: ${await response.text()}` });
      }

      const appData = await response.json();

      // Upsert the GitHub App for this organization
      const existing = await db.query.githubApps.findFirst({
        where: eq(githubApps.organizationId, ctx.session.organizationId)
      });

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A GitHub App is already configured for this organization.' });
      }

      await db.insert(githubApps).values({
        organizationId: ctx.session.organizationId,
        appId: appData.id.toString(),
        clientId: appData.client_id,
        clientSecret: encryptPrivateKey(appData.client_secret),
        webhookSecret: encryptPrivateKey(appData.webhook_secret),
        privateKey: encryptPrivateKey(appData.pem),
        name: appData.name,
      });

      return { success: true, appUrl: appData.html_url };
    }),

  // Link an installation to the workspace
  saveInstallation: protectedProcedure
    .input(z.object({ installationId: z.string(), setupAction: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const app = await db.query.githubApps.findFirst({
        where: eq(githubApps.organizationId, ctx.session.organizationId)
      });

      if (!app) throw new TRPCError({ code: 'NOT_FOUND', message: 'No GitHub App found. Please create one first.' });

      // Identify the installation details via JWT API
      const now = Math.floor(Date.now() / 1000);
      const token = jwt.sign(
        { iat: now - 60, exp: now + (10 * 60), iss: app.appId },
        decryptPrivateKey(app.privateKey),
        { algorithm: 'RS256' }
      );

      const response = await fetch(`https://api.github.com/app/installations/${input.installationId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Click-Deploy'
        }
      });

      if (!response.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to verify installation ID' });
      const installData = await response.json();

      // Save to database
      await db.insert(githubInstallations).values({
        githubAppId: app.id,
        organizationId: ctx.session.organizationId,
        installationId: input.installationId,
        accountName: installData.account.login,
      }).onConflictDoNothing();

      return { success: true };
    }),

  // Get current integration status
  status: protectedProcedure.query(async ({ ctx }) => {
    const app = await db.query.githubApps.findFirst({
      where: eq(githubApps.organizationId, ctx.session.organizationId),
      with: { installations: true }
    });

    if (!app) return { connected: false, installations: [] };
    
    return {
      connected: true,
      appName: app.name,
      appId: app.appId,
      installations: app.installations.map(i => ({ account: i.accountName, id: i.installationId }))
    };
  }),

  // List all repositories available to the installation
  listRepositories: protectedProcedure.query(async ({ ctx }) => {
    const { token } = await getInstallationConfig(ctx.session.organizationId);

    const response = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Click-Deploy'
      }
    });

    if (!response.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list repositories' });
    
    const data = await response.json();
    return data.repositories.map((repo: any) => ({
      id: repo.id,
      name: repo.full_name,
      private: repo.private,
      url: repo.clone_url,
      defaultBranch: repo.default_branch,
    }));
  }),

  // List branches for a specific repository
  listBranches: protectedProcedure
    .input(z.object({ repoFullName: z.string() }))
    .query(async ({ ctx, input }) => {
      const { token } = await getInstallationConfig(ctx.session.organizationId);

      const response = await fetch(`https://api.github.com/repos/${input.repoFullName}/branches?per_page=100`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Click-Deploy'
        }
      });

      if (!response.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list branches' });
      
      const branches = await response.json();
      return branches.map((b: any) => b.name);
    }),

  // Delete/Disconnect app
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    // Cascade pulls down installations too
    await db.delete(githubApps).where(eq(githubApps.organizationId, ctx.session.organizationId));
    return { success: true };
  })
});
