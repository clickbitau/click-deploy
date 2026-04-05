import { eq, and } from 'drizzle-orm';
import { notificationChannels, inAppNotifications, organizations } from '@click-deploy/database';

export async function sendEmail(smtpConfig: { host: string; port: number | string; user: string; password: string; from: string }, to: string, subject: string, html: string) {
  // Dynamic import to avoid bundling issues
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: smtpConfig.host,
    port: Number(smtpConfig.port) || 587,
    secure: Number(smtpConfig.port) === 465,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.password,
    },
  });
  await transport.sendMail({
    from: smtpConfig.from || smtpConfig.user,
    to,
    subject,
    html,
  });
}

export async function dispatchDeploymentEvent(
  db: any,
  organizationId: string,
  event: 'deploy_success' | 'deploy_fail',
  serviceName: string,
  message: string,
  deploymentId: string
) {
  // 1. In-App Notification (always)
  await db.insert(inAppNotifications).values({
    organizationId,
    title: event === 'deploy_success' ? `Deploy succeeded: ${serviceName}` : `Deploy failed: ${serviceName}`,
    message: message.slice(0, 200),
    level: event === 'deploy_success' ? 'success' : 'error',
    category: 'deployment',
    resourceId: deploymentId,
  }).catch(() => {});

  // 2. Fetch external channels that subscribe to this event
  const channels = await db.query.notificationChannels.findMany({
    where: and(
      eq(notificationChannels.organizationId, organizationId),
      eq(notificationChannels.enabled, true)
    ),
    with: { rules: true },
  });

  const subscribedChannels = channels.filter((c: any) => 
    c.rules.some((r: any) => r.event === event)
  );

  if (subscribedChannels.length === 0) return;

  // 3. For email channels, we need SMTP config from organization settings
  let smtpConfig = null;
  const emailChannels = subscribedChannels.filter((c: any) => c.type === 'email');
  if (emailChannels.length > 0) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    const settings = (org?.settings as any) || {};
    if (settings.smtpHost && settings.smtpUser && settings.smtpPassword) {
      smtpConfig = {
        host: settings.smtpHost,
        port: settings.smtpPort,
        user: settings.smtpUser,
        password: settings.smtpPassword,
        from: settings.smtpFrom || settings.smtpUser,
      };
    }
  }

  // 4. Dispatch!
  for (const channel of subscribedChannels) {
     if (channel.type === 'email' && smtpConfig && channel.config?.email) {
       sendEmail(
         smtpConfig,
         channel.config.email,
         event === 'deploy_success' ? `✅ Deploy Succeeded: ${serviceName}` : `❌ Deploy Failed: ${serviceName}`,
         `<h3>${event === 'deploy_success' ? 'Deployment Successful' : 'Deployment Failed'}</h3>
          <p><strong>Service:</strong> ${serviceName}</p>
          <p><strong>Details:</strong> ${message}</p>
          <p><a href="https://app.clickdeploy.io/dashboard/project/${serviceName}/deployments/${deploymentId}">View Deployment</a></p>`
       ).catch((err: any) => console.error('[dispatch] Email failed:', err));
     } else if (channel.type === 'webhook' && channel.config?.url) {
       fetch(channel.config.url, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           event,
           serviceName,
           message,
           deploymentId
         })
       }).catch((err: any) => console.error('[dispatch] Webhook failed:', err));
     }
  }
}
