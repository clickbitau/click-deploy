// ============================================================
// Click-Deploy — System Router (Platform Administration)
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { nodes, sshKeys, organizations, users } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';
import { sshManager } from '@click-deploy/docker';
import { decryptPrivateKey } from '../crypto';
import { randomBytes } from 'crypto';

/**
 * Finds the actual manager node that hosts the Click-Deploy source code installation.
 * It checks manager nodes until it finds one with /opt/click-deploy present.
 */
async function getPrimaryManagerNode(ctx: { db: typeof import('@click-deploy/database').db; session: { organizationId: string } }) {
  const orgNodes = await ctx.db.query.nodes.findMany({
    where: eq(nodes.organizationId, ctx.session.organizationId),
  });
  
  // Try online managers only
  const managers = orgNodes.filter((n) => n.role === 'manager');
  const candidates = managers.filter((n) => n.status === 'online');

  for (const node of candidates) {
    const keyRecord = await ctx.db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, node.sshKeyId),
    });
    if (!keyRecord) continue;

    const sshConfig = {
      host: node.tailscaleIp || node.host,
      port: node.port,
      username: node.sshUser,
      privateKey: decryptPrivateKey(keyRecord.privateKey),
    };

    try {
      const dirCheck = await sshManager.exec(sshConfig, 'test -d /opt/click-deploy && echo "exists" || echo "missing"');
      if (dirCheck.stdout.trim() === 'exists') {
        return { sshConfig };
      }
    } catch { }
  }
  return null;
}

import { sendEmail } from '../notifications';
export const systemRouter = createRouter({
  /** Get the current platform version */
  version: protectedProcedure
    .query(async () => {
      let version = '0.1.0';
      let commitSha = process.env.GIT_COMMIT_SHA || 'unknown';
      try {
        const fs = await import('fs');
        // Try /app (Docker container) first, then /opt/click-deploy (host)
        for (const p of ['/app/package.json', '/opt/click-deploy/package.json']) {
          try {
            const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
            if (pkg.version) { version = pkg.version; break; }
          } catch {}
        }
      } catch {}
      // Fallback: try git if env var is missing
      if (commitSha === 'unknown') {
        try {
          const { execSync } = await import('child_process');
          commitSha = execSync('git rev-parse --short HEAD 2>/dev/null', { cwd: '/opt/click-deploy' }).toString().trim() || 'unknown';
        } catch {}
      }
      return { version, commitSha };
    }),

  /** Get the current user's profile (bypasses session cache) */
  getProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.userId),
        columns: { id: true, name: true, email: true, image: true },
      });
      return user || null;
    }),

  /** Get current organization details */
  getOrganization: protectedProcedure
    .query(async ({ ctx }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
        columns: { id: true, name: true, slug: true },
      });
      return org || null;
    }),

  /** Update the current user's profile (name, email, image) */
  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      email: z.string().email().optional(),
      image: z.string().max(200_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users).set({
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
      }).where(eq(users.id, ctx.session.userId));
      return { success: true, name: input.name, email: input.email, image: input.image };
    }),

  /** Update organization detail */
  updateOrganization: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      slug: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(organizations).set({
        name: input.name,
        slug: input.slug,
        updatedAt: new Date(),
      }).where(eq(organizations.id, ctx.session.organizationId));
      return { success: true };
    }),


  /** Change the current user's password */
  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const { accounts } = await import('@click-deploy/database');
      const { hashPassword, verifyPassword } = await import('better-auth/crypto');

      // Find the credential account for this user
      const account = await ctx.db.query.accounts.findFirst({
        where: and(
          eq(accounts.userId, ctx.session.userId),
          eq(accounts.providerId, 'credential'),
        ),
      });

      if (!account?.password) {
        throw new Error('No password credential found for this account');
      }

      // Verify current password using better-auth's scrypt verifier
      const valid = await verifyPassword({ hash: account.password, password: input.currentPassword });
      if (!valid) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password with better-auth's scrypt and update
      const hashed = await hashPassword(input.newPassword);
      await ctx.db.update(accounts)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(accounts.id, account.id));

      return { success: true };
    }),

  /** Check if there are updates available on the remote repository */
  checkUpdate: adminProcedure
    .query(async ({ ctx }) => {
      const primary = await getPrimaryManagerNode(ctx);
      if (!primary) {
        return { updateAvailable: false, error: 'Installation directory not found on any manager node', commits: [] };
      }
      const { sshConfig } = primary;

      try {

        await sshManager.exec(sshConfig, 'cd /opt/click-deploy && git fetch origin');
        
        const gitLog = await sshManager.exec(sshConfig, 'cd /opt/click-deploy && git log HEAD..origin/main --oneline');

        const commits = gitLog.stdout
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0);

        return {
          updateAvailable: commits.length > 0,
          commits,
        };
      } catch (err: any) {
        console.error('[system] Failed to check for updates:', err);
        return { updateAvailable: false, error: err.message || 'SSH Connection failed', commits: [] };
      }
    }),

  /** Trigger an asynchronous update of the host machine */
  triggerUpdate: adminProcedure
    .mutation(async ({ ctx }) => {
      const primary = await getPrimaryManagerNode(ctx);
      if (!primary) {
        throw new Error('Installation directory not found on any manager node');
      }
      const { sshConfig } = primary;

      try {
        // Run the update detached so it survives the container stopping.
        // We write GIT_COMMIT_SHA into .env so docker compose build args pick it up.
        const command = [
          "nohup sh -c '",
          'cd /opt/click-deploy',
          '&& : > update.log',
          '&& echo "[update] Pulling latest code..." >> update.log',
          '&& git pull origin main >> update.log 2>&1',
          '&& SHA=$(git rev-parse --short HEAD)',
          '&& sed -i "/^GIT_COMMIT_SHA=/d" .env',
          '&& echo "GIT_COMMIT_SHA=$SHA" >> .env',
          '&& echo "[update] Building with commit $SHA..." >> update.log',
          '&& GIT_COMMIT_SHA=$SHA docker compose up -d --build >> update.log 2>&1',
          '&& echo "[update] ✓ Update complete!" >> update.log',
          "|| echo '[update] ✗ Update failed!' >> update.log",
          "' > /dev/null 2>&1 &",
        ].join(' ');
        await sshManager.exec(sshConfig, command);
        
        return { success: true };
      } catch (err: any) {
        console.error('[system] Failed to trigger update:', err);
        throw new Error('Failed to start update script: ' + (err.message || 'SSH error'));
      }
    }),

  /** Stream update.log from the manager node (live build output) */
  getUpdateLogs: adminProcedure
    .query(async ({ ctx }) => {
      const primary = await getPrimaryManagerNode(ctx);
      if (!primary) return { logs: '', running: false };
      
      const { sshConfig } = primary;

      try {
        // Read the last 200 lines of the update log
        const logResult = await sshManager.exec(sshConfig, 'tail -200 /opt/click-deploy/update.log 2>/dev/null || echo ""');
        // Check if the update process is still running
        const pidResult = await sshManager.exec(sshConfig, 'pgrep -f "docker compose up -d --build" >/dev/null 2>&1 && echo "running" || echo "done"');

        return {
          logs: logResult.stdout,
          running: pidResult.stdout.trim() === 'running',
        };
      } catch {
        return { logs: '', running: false };
      }
    }),

  // ── SMTP Config ─────────────────────────────────────────────

  /** Get SMTP settings for this organization */
  getSmtp: adminProcedure
    .query(async ({ ctx }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const settings = (org?.settings as any) || {};
      return {
        host: settings.smtpHost || '',
        port: settings.smtpPort || '587',
        user: settings.smtpUser || '',
        password: settings.smtpPassword ? '••••••••' : '',
        from: settings.smtpFrom || '',
        configured: !!(settings.smtpHost && settings.smtpUser && settings.smtpPassword),
      };
    }),

  /** Save SMTP settings */
  saveSmtp: adminProcedure
    .input(z.object({
      host: z.string().min(1),
      port: z.string().default('587'),
      user: z.string().min(1),
      password: z.string().min(1),
      from: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const existing = (org?.settings as any) || {};
      
      await ctx.db.update(organizations)
        .set({
          settings: {
            ...existing,
            smtpHost: input.host,
            smtpPort: input.port,
            smtpUser: input.user,
            smtpPassword: input.password,
            smtpFrom: input.from || input.user,
          },
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, ctx.session.organizationId));

      return { success: true };
    }),

  /** Test SMTP connection */
  testSmtp: adminProcedure
    .input(z.object({
      host: z.string(),
      port: z.string(),
      user: z.string(),
      password: z.string(),
      from: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userRecord = await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.session.userId),
        });
        await sendEmail(
          { host: input.host, port: input.port, user: input.user, password: input.password, from: input.from || input.user },
          userRecord?.email || input.user,
          'Click-Deploy SMTP Test',
          '<h2>✓ SMTP is working!</h2><p>This is a test email from your Click-Deploy platform.</p>'
        );
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }),

  // ── Team Invitations ────────────────────────────────────────

  /** Invite a member by email — generates link, optionally sends email */
  inviteMember: adminProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'member', 'viewer']).default('member'),
    }))
    .mutation(async ({ ctx, input }) => {
      // Generate unique invite token
      const token = randomBytes(32).toString('hex');
      
      // Store invite in org settings
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const settings = (org?.settings as any) || {};
      const invites = settings.pendingInvites || [];
      
      // Check for duplicate
      const existing = invites.find((i: any) => i.email === input.email);
      if (existing) {
        return { success: false, error: 'This email has already been invited' };
      }

      invites.push({
        email: input.email,
        role: input.role,
        token,
        invitedAt: new Date().toISOString(),
        invitedBy: ctx.session.userId,
      });

      await ctx.db.update(organizations)
        .set({ settings: { ...settings, pendingInvites: invites }, updatedAt: new Date() })
        .where(eq(organizations.id, ctx.session.organizationId));

      // Try to send email if SMTP is configured
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const inviteLink = `${baseUrl}/register?invite=${token}&org=${ctx.session.organizationId}`;
      let emailSent = false;

      if (settings.smtpHost && settings.smtpUser && settings.smtpPassword) {
        try {
          await sendEmail(
            { host: settings.smtpHost, port: settings.smtpPort, user: settings.smtpUser, password: settings.smtpPassword, from: settings.smtpFrom },
            input.email,
            `You've been invited to ${org?.name || 'Click-Deploy'}`,
            `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
              <h2>You're invited!</h2>
              <p>You've been invited to join <strong>${org?.name}</strong> on Click-Deploy as a <strong>${input.role}</strong>.</p>
              <p style="margin:24px 0;">
                <a href="${inviteLink}" style="background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Accept Invitation</a>
              </p>
              <p style="color:#666;font-size:12px;">Or copy this link: ${inviteLink}</p>
            </div>`
          );
          emailSent = true;
        } catch (err) {
          console.error('[system] Failed to send invite email:', err);
        }
      }

      return { success: true, inviteLink, emailSent };
    }),

  /** List team members and pending invites */
  getTeam: protectedProcedure
    .query(async ({ ctx }) => {
      const members = await ctx.db.query.users.findMany({
        where: eq(users.organizationId, ctx.session.organizationId),
        columns: { id: true, name: true, email: true, role: true, image: true, createdAt: true },
      });

      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const settings = (org?.settings as any) || {};
      const pendingInvites = (settings.pendingInvites || []).map((inv: any) => ({
        email: inv.email,
        role: inv.role,
        invitedAt: inv.invitedAt,
      }));

      return { members, pendingInvites };
    }),

  /** Cancel a pending invite */
  cancelInvite: adminProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const settings = (org?.settings as any) || {};
      const invites = (settings.pendingInvites || []).filter((i: any) => i.email !== input.email);

      await ctx.db.update(organizations)
        .set({ settings: { ...settings, pendingInvites: invites }, updatedAt: new Date() })
        .where(eq(organizations.id, ctx.session.organizationId));

      return { success: true };
    }),

  // ── API Keys ────────────────────────────────────────────────

  /** Create a new API key */
  createApiKey: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const { createHash } = await import('node:crypto');

      // Generate a random key with cd_ prefix
      const rawKey = `cd_${randomBytes(24).toString('hex')}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 12);

      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const settings = (org?.settings as any) || {};
      const apiKeys = settings.apiKeys || [];

      const newKey = {
        id: randomBytes(8).toString('hex'),
        name: input.name,
        keyHash,
        keyPrefix,
        createdAt: new Date().toISOString(),
        createdBy: ctx.session.userId,
        lastUsedAt: null,
      };

      apiKeys.push(newKey);

      await ctx.db.update(organizations)
        .set({ settings: { ...settings, apiKeys }, updatedAt: new Date() })
        .where(eq(organizations.id, ctx.session.organizationId));

      // Return the full key ONCE — it can never be retrieved again
      return { key: rawKey, id: newKey.id, name: input.name, keyPrefix };
    }),

  /** List API keys (never returns the full key) */
  listApiKeys: protectedProcedure
    .query(async ({ ctx }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const settings = (org?.settings as any) || {};
      const apiKeys = (settings.apiKeys || []).map((k: any) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }));
      return apiKeys;
    }),

  /** Delete an API key */
  deleteApiKey: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.session.organizationId),
      });
      const settings = (org?.settings as any) || {};
      const apiKeys = (settings.apiKeys || []).filter((k: any) => k.id !== input.id);

      await ctx.db.update(organizations)
        .set({ settings: { ...settings, apiKeys }, updatedAt: new Date() })
        .where(eq(organizations.id, ctx.session.organizationId));

      return { success: true };
    }),
});

// ── API Key Validation (for REST routes) ─────────────────────

/**
 * Validate a bearer token and return the organization ID if valid.
 * Updates lastUsedAt on successful validation.
 */
export async function validateApiKey(bearerToken: string): Promise<{ organizationId: string } | null> {
  const { createHash } = await import('crypto');
  const { db } = await import('@click-deploy/database');

  if (!bearerToken.startsWith('cd_')) return null;

  const keyHash = createHash('sha256').update(bearerToken).digest('hex');

  // Search all organizations for a matching key hash
  const allOrgs = await db.query.organizations.findMany();

  for (const org of allOrgs) {
    const settings = (org.settings as any) || {};
    const apiKeys = settings.apiKeys || [];

    const matchIdx = apiKeys.findIndex((k: any) => k.keyHash === keyHash);
    if (matchIdx !== -1) {
      // Update lastUsedAt
      apiKeys[matchIdx].lastUsedAt = new Date().toISOString();
      await db.update(organizations)
        .set({ settings: { ...settings, apiKeys } })
        .where(eq(organizations.id, org.id));

      return { organizationId: org.id };
    }
  }

  return null;
}
