// ============================================================
// Click-Deploy — Post-Registration Setup
// ============================================================
// After a user signs up, we need to create their organization
// and assign them as owner. This runs as a Next.js API route
// that better-auth's afterSignup hook would call, or we call
// it manually after signup on the client side.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { db, organizations, users, eq } from '@click-deploy/database';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, orgName, orgSlug } = body;

    if (!userId || !orgName) {
      return NextResponse.json(
        { error: 'userId and orgName are required' },
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

    const [org] = await db
      .insert(organizations)
      .values({
        name: orgName,
        slug,
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
