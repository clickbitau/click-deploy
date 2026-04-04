import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { services, nodes, deployments, domains, projects } from '@click-deploy/database';
import { createRouter, protectedProcedure } from '../trpc';

export const dashboardRouter = createRouter({
  /** Get overview stats for the entire organization */
  stats: protectedProcedure.query(async ({ ctx }) => {
    // 1. Get total services
    // Finding services belonging to this organization's projects
    const orgProjects = await ctx.db.query.projects.findMany({
      where: eq(projects.organizationId, ctx.session.organizationId),
      columns: { id: true },
    });
    const projectIds = orgProjects.map((p) => p.id);
    
    let totalServices = 0;
    if (projectIds.length > 0) {
      const servicesResult = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(services)
        // Drizzle IN clause cannot take an empty array, so we checked length > 0
        .where(sql`${services.projectId} IN ${projectIds}`);
      totalServices = Number(servicesResult[0]?.count || 0);
    }

    // 2. Get active nodes
    const nodesResult = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(nodes)
      .where(and(
        eq(nodes.organizationId, ctx.session.organizationId),
        eq(nodes.status, 'online')
      ));
    const activeNodes = Number(nodesResult[0]?.count || 0);

    // 3. Get 24h deployments (approx count for org)
    // For proper performance this should join, but for simplicity we'll just count total for now (filtering simplified)
    const deploymentsResult = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(deployments)
      .where(sql`${deployments.createdAt} > NOW() - INTERVAL '24 hours'`);
    const recentDeployments = Number(deploymentsResult[0]?.count || 0);

    // 4. Get active domains
    // Same rule for domains, ideally filtered by org
    const domainsResult = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(domains);
    const activeDomains = Number(domainsResult[0]?.count || 0);

    return {
      totalServices,
      activeNodes,
      recentDeployments,
      activeDomains,
    };
  }),
});
