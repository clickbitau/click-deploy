// ============================================================
// Click-Deploy — Public REST API (Bearer Token Auth)
// ============================================================
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { validateApiKey } = await import('@click-deploy/api');
    const { db, services, projects } = await import('@click-deploy/database');
    const { eq } = await import('drizzle-orm');

    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const result = await validateApiKey(auth.replace('Bearer ', ''));
    if (!result) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    // List services for this organization across all projects
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
        'POST /api/v1': 'Trigger a deployment — body: { serviceId | serviceName, branch? }',
        'GET /api/v1': 'List services (this endpoint)',
      },
    });
  } catch (err: any) {
    console.error('[api/v1] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { validateApiKey } = await import('@click-deploy/api');
    const { db, services, projects, deployments, nodes } = await import('@click-deploy/database');
    const { eq, and } = await import('drizzle-orm');

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

    const { serviceId, serviceName, branch } = body;
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
      // Find by name across all org projects
      const orgProjects = await db.query.projects.findMany({
        where: eq(projects.organizationId, result.organizationId),
        columns: { id: true },
      });
      for (const p of orgProjects) {
        const svcList = await db.query.services.findMany({
          where: eq(services.projectId, p.id),
          with: { project: { columns: { organizationId: true } } },
        });
        const match = svcList.find((s: any) => s.name === serviceName);
        if (match) {
          service = match;
          break;
        }
      }
    }

    if (!service || service.project.organizationId !== result.organizationId) {
      return NextResponse.json({ error: 'Service not found in your organization' }, { status: 404 });
    }

    // Auto-resolve build and deploy nodes (same logic as deployment.trigger)
    const orgNodes = await db.query.nodes.findMany({
      where: eq(nodes.organizationId, result.organizationId),
    });

    let buildNodeId = service.buildNodeId;
    if (service.sourceType === 'git') {
      const buildCapable = orgNodes.filter((n: any) => n.canBuild && n.status === 'online');
      if (buildCapable.length > 0) {
        const configured = buildCapable.find((n: any) => n.id === service.buildNodeId);
        buildNodeId = configured ? configured.id : buildCapable[0]!.id;
      } else if (orgNodes.length > 0) {
        const online = orgNodes.filter((n: any) => n.status === 'online');
        buildNodeId = online.length > 0 ? online[0]!.id : orgNodes[0]!.id;
      }
    }

    let deployNodeId = service.targetNodeId;
    if (!deployNodeId) {
      const deployCap = orgNodes.filter((n: any) => n.canDeploy && n.status === 'online');
      deployNodeId = deployCap.length > 0 ? deployCap[0]!.id : orgNodes[0]?.id ?? null;
    }

    // Create a deployment record
    const [deployment] = await db.insert(deployments).values({
      serviceId: service.id,
      triggeredBy: 'api',
      branch: branch || service.gitBranch || 'main',
      buildStatus: 'pending',
      deployStatus: 'pending',
      buildNodeId,
      deployNodeId,
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
      service: service.name,
      branch: branch || service.gitBranch || 'main',
      message: `Deployment triggered for ${service.name}`,
    }, { status: 201 });
  } catch (err: any) {
    console.error('[api/v1] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
