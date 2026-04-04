// ============================================================
// Click-Deploy — Public REST API (Bearer Token Auth)
// ============================================================
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Lazy import to avoid bundling issues
  const { validateApiKey } = await import('@click-deploy/api');
  const { db, services, projects, deployments } = await import('@click-deploy/database');
  const { eq, desc } = await import('drizzle-orm');

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
  }

  const result = await validateApiKey(auth.replace('Bearer ', ''));
  if (!result) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  // List services for this organization
  const orgProjects = await db.query.projects.findMany({
    where: eq(projects.organizationId, result.organizationId),
    columns: { id: true },
  });

  const allServices = [];
  for (const project of orgProjects) {
    const svcList = await db.query.services.findMany({
      where: eq(services.projectId, project.id),
      columns: { id: true, name: true, status: true, gitUrl: true, gitBranch: true },
    });
    allServices.push(...svcList);
  }

  return NextResponse.json({
    services: allServices,
    usage: {
      'POST /api/v1/deploy': 'Trigger a deployment for a service',
      'GET /api/v1': 'List services (this endpoint)',
    },
  });
}

export async function POST(req: NextRequest) {
  const { validateApiKey } = await import('@click-deploy/api');
  const { db, services, projects, deployments } = await import('@click-deploy/database');
  const { eq } = await import('drizzle-orm');

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
  }

  const result = await validateApiKey(auth.replace('Bearer ', ''));
  if (!result) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { serviceId, serviceName } = body;
  if (!serviceId && !serviceName) {
    return NextResponse.json({ error: 'Provide either serviceId or serviceName' }, { status: 400 });
  }

  // Find the service
  let service: any = null;
  if (serviceId) {
    service = await db.query.services.findFirst({
      where: eq(services.id, serviceId),
      with: { project: { columns: { organizationId: true } } },
    });
  } else {
    // Find by name within org
    const orgProjects = await db.query.projects.findMany({
      where: eq(projects.organizationId, result.organizationId),
      columns: { id: true },
    });
    for (const p of orgProjects) {
      const found = await db.query.services.findFirst({
        where: eq(services.projectId, p.id),
        with: { project: { columns: { organizationId: true } } },
      });
      if (found && found.name === serviceName) {
        service = found;
        break;
      }
    }
  }

  if (!service || service.project.organizationId !== result.organizationId) {
    return NextResponse.json({ error: 'Service not found in your organization' }, { status: 404 });
  }

  // Create a deployment record
  const [deployment] = await db.insert(deployments).values({
    serviceId: service.id,
    triggeredBy: 'manual',
    branch: service.gitBranch || 'main',
    buildStatus: 'pending',
    deployStatus: 'pending',
  }).returning();

  // Trigger the engine asynchronously
  try {
    const { deploymentEngine } = await import('@click-deploy/api');
    deploymentEngine.runDeployment(deployment.id).catch((err: any) => {
      console.error(`[api/v1] Deployment ${deployment.id} failed:`, err);
    });
  } catch (err) {
    console.error('[api/v1] Failed to start engine:', err);
  }

  return NextResponse.json({
    success: true,
    deploymentId: deployment.id,
    message: `Deployment triggered for ${service.name}`,
    dashboardUrl: `/dashboard/deployments/${deployment.id}`,
  }, { status: 201 });
}
