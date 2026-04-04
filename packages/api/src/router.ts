// ============================================================
// Click-Deploy — Root Router
// ============================================================
import { createRouter, createCallerFactory } from './trpc';
import { projectRouter } from './routers/project';
import { serviceRouter } from './routers/service';
import { nodeRouter } from './routers/node';
import { deploymentRouter } from './routers/deployment';
import { domainRouter } from './routers/domain';
import { sshKeyRouter } from './routers/sshKey';
import { registryRouter } from './routers/registry';
import { tunnelRouter } from './routers/tunnel';
import { dashboardRouter } from './routers/dashboard';
import { infraRouter } from './routers/infra';
import { notificationRouter } from './routers/notification';
import { systemRouter } from './routers/system';
import { githubRouter } from './routers/github';

export const appRouter = createRouter({
  project: projectRouter,
  service: serviceRouter,
  node: nodeRouter,
  deployment: deploymentRouter,
  domain: domainRouter,
  sshKey: sshKeyRouter,
  registry: registryRouter,
  tunnel: tunnelRouter,
  dashboard: dashboardRouter,
  infra: infraRouter,
  notification: notificationRouter,
  system: systemRouter,
  github: githubRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller factory for testing and server components */
export const createCaller = createCallerFactory(appRouter);
