import { auditLogs } from '@click-deploy/database';

export async function audit(db: any, ctx: { session: { organizationId: string; userId: string } }, params: {
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  description?: string;
  metadata?: Record<string, any>;
}) {
  try {
    await db.insert(auditLogs).values({
      organizationId: ctx.session.organizationId,
      userId: ctx.session.userId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      resourceName: params.resourceName,
      description: params.description,
      metadata: params.metadata || {},
    });
  } catch (e) {
    console.warn('[audit] Failed to write audit log:', e);
  }
}
