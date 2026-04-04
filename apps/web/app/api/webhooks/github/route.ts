// ============================================================
// Click-Deploy — GitHub Webhook Handler
// ============================================================
// Receives push events from GitHub, verifies signature,
// finds matching services, and triggers auto-deployments.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, services, deployments } from '@click-deploy/database';
import { deploymentEngine } from '@click-deploy/api';

// Webhook secret from env — global for now, per-service later
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

/**
 * Verify the GitHub webhook signature (X-Hub-Signature-256).
 */
function verifySignature(payload: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;

  const expected = `sha256=${createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const event = req.headers.get('x-github-event');

    // Verify signature if secret is configured
    if (WEBHOOK_SECRET && !verifySignature(body, signature)) {
      console.error('[webhook] Invalid GitHub webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Only handle push events
    if (event !== 'push') {
      return NextResponse.json({ status: 'ignored', event });
    }

    const payload = JSON.parse(body);

    // Extract push info
    const repoUrl = payload.repository?.clone_url || payload.repository?.html_url;
    const ref = payload.ref; // e.g. "refs/heads/main"
    const branch = ref?.replace('refs/heads/', '');
    const commitSha = payload.after;
    const commitMessage = payload.head_commit?.message || '';
    const pusher = payload.pusher?.name || 'unknown';

    if (!repoUrl || !branch) {
      return NextResponse.json(
        { error: 'Missing repo URL or branch' },
        { status: 400 }
      );
    }

    console.log(`[webhook] Push to ${repoUrl} (${branch}) by ${pusher}`);

    // Find all services with auto-deploy enabled
    const allServices = await db.query.services.findMany({
      where: eq(services.autoDeploy, true),
    });

    // Match by git URL (normalize URLs for comparison)
    const normalizeUrl = (url: string) =>
      url.replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();

    const matchingServices = allServices.filter((svc) => {
      if (!svc.gitUrl) return false;
      const urlMatch = normalizeUrl(svc.gitUrl) === normalizeUrl(repoUrl);
      const branchMatch = (svc.gitBranch || 'main') === branch;
      return urlMatch && branchMatch;
    });

    if (matchingServices.length === 0) {
      console.log('[webhook] No matching services found');
      return NextResponse.json({
        status: 'no_match',
        repoUrl,
        branch,
      });
    }

    // Trigger deployments for all matching services
    const triggered: string[] = [];

    for (const svc of matchingServices) {
      try {
        const [deployment] = await db
          .insert(deployments)
          .values({
            serviceId: svc.id,
            triggeredBy: 'webhook',
            branch,
            commitSha,
            commitMessage: commitMessage.slice(0, 500),
            buildStatus: 'pending',
            deployStatus: 'pending',
            buildNodeId: svc.buildNodeId,
            deployNodeId: svc.targetNodeId,
          })
          .returning();

        // Trigger deployment via engine
        deploymentEngine.runDeployment(deployment!.id).catch((err: Error) => {
          console.error(`[webhook] Deployment ${deployment!.id} failed:`, err);
        });

        triggered.push(svc.name);
        console.log(`[webhook] Triggered deployment for service: ${svc.name}`);
      } catch (err) {
        console.error(`[webhook] Failed to trigger for ${svc.name}:`, err);
      }
    }

    return NextResponse.json({
      status: 'triggered',
      services: triggered,
      branch,
      commitSha: commitSha?.slice(0, 7),
    });

  } catch (err: any) {
    const message = err?.message || err?.toString?.() || 'Unknown error';
    const stack = err?.stack || '';
    console.error('[webhook] Error processing webhook:', message, stack);
    return NextResponse.json(
      { error: 'Internal server error', detail: message },
      { status: 500 }
    );
  }
}

// GitHub sends a GET to verify the endpoint exists
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Click-Deploy GitHub Webhook',
    timestamp: new Date().toISOString(),
  });
}
