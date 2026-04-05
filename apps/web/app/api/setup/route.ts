// ============================================================
// Click-Deploy — Post-Registration Setup
// ============================================================
// After a user signs up, we need to create their organization
// and assign them as owner. This runs as a Next.js API route
// called by the client after better-auth creates the user.
//
// SECURITY: The route verifies that the session's userId matches
// the requested userId. This prevents callers from hijacking
// another user's account into a different organization.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { db, organizations, users, eq } from '@click-deploy/database';
import { auth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orgName, orgSlug } = body;

    // ── SECURITY: Verify the caller is authenticated ────────
    // Do NOT accept userId from the request body — always derive
    // it from the server-side session to prevent account hijacking.
    const sessionData = await auth.api.getSession({ headers: req.headers });
    if (!sessionData?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized — no active session' }, { status: 401 });
    }
    const userId = sessionData.user.id;

    if (!orgName) {
      return NextResponse.json(
        { error: 'orgName is required' },
        { status: 400 }
      );
    }

    // Check if user already has an organization
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.organizationId) {
      return NextResponse.json({
        message: 'User already has an organization',
        organizationId: user.organizationId,
      });
    }

    // Create organization
    const slug = orgSlug || orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Ensure slug is unique by appending a suffix if needed
    const existingOrg = await db.query.organizations.findFirst({
      where: eq(organizations.slug, slug),
    });
    const finalSlug = existingOrg ? `${slug}-${Date.now().toString(36)}` : slug;

    const [org] = await db
      .insert(organizations)
      .values({
        name: orgName,
        slug: finalSlug,
      })
      .returning();

    // Assign user to org as owner
    await db
      .update(users)
      .set({
        organizationId: org.id,
        role: 'owner',
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return NextResponse.json({
      success: true,
      organizationId: org.id,
      slug: org.slug,
    });
  } catch (err: any) {
    console.error('❌ Setup error:', err);
    return NextResponse.json(
      { error: err.message || 'Setup failed' },
      { status: 500 }
    );
  }
}
