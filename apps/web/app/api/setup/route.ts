// ============================================================
// Click-Deploy — Post-Registration Setup
// ============================================================
// After a user signs up via Supabase Auth, we need to create
// their organization and link them in our users table.
//
// SECURITY: The route verifies the session via Supabase Auth.
// The userId is derived server-side from the JWT — never from
// the request body.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { db, organizations, users, eq } from '@click-deploy/database';
import { createServerClient } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orgName, orgSlug } = body;

    // ── Extract session from Supabase Auth ────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    const cookieHeader = req.headers.get('cookie') || '';
    const cookieMap = new Map<string, string>();
    cookieHeader.split(';').forEach((c) => {
      const [key, ...rest] = c.trim().split('=');
      if (key) cookieMap.set(key, rest.join('='));
    });

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return Array.from(cookieMap.entries()).map(([name, value]) => ({ name, value }));
        },
        setAll() {},
      },
    });

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized — no active session' }, { status: 401 });
    }

    const userId = authUser.id;
    const userName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User';
    const userEmail = authUser.email || '';

    if (!orgName) {
      return NextResponse.json({ error: 'orgName is required' }, { status: 400 });
    }

    // Check if user already exists in our users table
    let user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    // Fallback: match by email (for pre-existing users from Better-Auth migration)
    if (!user && userEmail) {
      user = await db.query.users.findFirst({
        where: eq(users.email, userEmail),
      });
      // Update the row's ID to match the new Supabase auth ID
      if (user) {
        try {
          await db.update(users)
            .set({ id: userId, updatedAt: new Date() })
            .where(eq(users.id, user.id));
          user = { ...user, id: userId };
        } catch {
          // ID conflict — use existing row as-is
        }
      }
    }

    // If user row already has an organization, we're done
    if (user?.organizationId) {
      return NextResponse.json({
        message: 'User already has an organization',
        organizationId: user.organizationId,
      });
    }

    // Create user row if it doesn't exist yet
    if (!user) {
      const [newUser] = await db.insert(users).values({
        id: userId,
        name: userName,
        email: userEmail,
        emailVerified: !!authUser.email_confirmed_at,
        role: 'owner',
      }).returning();
      user = newUser;
    }

    // Create organization
    const slug = orgSlug || orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existingOrg = await db.query.organizations.findFirst({
      where: eq(organizations.slug, slug),
    });
    const finalSlug = existingOrg ? `${slug}-${Date.now().toString(36)}` : slug;

    const [org] = await db
      .insert(organizations)
      .values({ name: orgName, slug: finalSlug })
      .returning();

    // Assign user to org as owner
    await db
      .update(users)
      .set({ organizationId: org.id, role: 'owner', updatedAt: new Date() })
      .where(eq(users.id, user!.id));

    return NextResponse.json({
      success: true,
      organizationId: org.id,
      slug: org.slug,
    });
  } catch (err: any) {
    console.error('❌ Setup error:', err);
    return NextResponse.json({ error: err.message || 'Setup failed' }, { status: 500 });
  }
}
