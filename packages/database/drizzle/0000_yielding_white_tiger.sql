CREATE TYPE "public"."org_plan" AS ENUM('free', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('production', 'staging', 'development');--> statement-breakpoint
CREATE TYPE "public"."git_provider" AS ENUM('github', 'gitlab', 'gitea', 'bitbucket');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('running', 'stopped', 'deploying', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('application', 'database', 'compose', 'redis', 'postgres', 'mysql', 'mongo', 'mariadb');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('git', 'image', 'compose');--> statement-breakpoint
CREATE TYPE "public"."build_status" AS ENUM('pending', 'building', 'built', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deploy_status" AS ENUM('pending', 'building', 'built', 'deploying', 'running', 'failed', 'rolled_back', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deploy_trigger" AS ENUM('webhook', 'manual', 'rollback', 'schedule', 'api');--> statement-breakpoint
CREATE TYPE "public"."node_role" AS ENUM('manager', 'worker', 'build');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('online', 'offline', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."swarm_status" AS ENUM('active', 'drain', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."registry_type" AS ENUM('dockerhub', 'ghcr', 'ecr', 'self_hosted', 'custom');--> statement-breakpoint
CREATE TYPE "public"."ssl_provider" AS ENUM('letsencrypt', 'cloudflare', 'custom', 'none');--> statement-breakpoint
CREATE TYPE "public"."tunnel_status" AS ENUM('active', 'inactive', 'error');--> statement-breakpoint
CREATE TYPE "public"."notification_event" AS ENUM('deploy_success', 'deploy_fail', 'service_down', 'service_up', 'node_offline', 'node_online', 'build_fail', 'certificate_expiring');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('slack', 'discord', 'telegram', 'email', 'webhook');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"plan" "org_plan" DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"organization_id" uuid,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"organization_id" uuid NOT NULL,
	"environment" "environment" DEFAULT 'production' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "service_type" DEFAULT 'application' NOT NULL,
	"source_type" "source_type" NOT NULL,
	"git_url" text,
	"git_branch" varchar(255) DEFAULT 'main',
	"git_provider" "git_provider",
	"dockerfile_path" varchar(500) DEFAULT 'Dockerfile',
	"docker_context" varchar(500) DEFAULT '.',
	"compose_file" text,
	"image_name" varchar(500),
	"image_tag" varchar(255) DEFAULT 'latest',
	"build_node_id" uuid,
	"target_node_id" uuid,
	"replicas" integer DEFAULT 1 NOT NULL,
	"env_vars" jsonb DEFAULT '{}'::jsonb,
	"ports" jsonb DEFAULT '[]'::jsonb,
	"volumes" jsonb DEFAULT '[]'::jsonb,
	"health_check" jsonb,
	"deploy_config" jsonb,
	"resource_limits" jsonb,
	"labels" jsonb DEFAULT '{}'::jsonb,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"swarm_service_id" varchar(100),
	"status" "service_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"triggered_by" "deploy_trigger" DEFAULT 'manual' NOT NULL,
	"commit_sha" varchar(40),
	"commit_message" text,
	"branch" varchar(255),
	"build_status" "build_status" DEFAULT 'pending' NOT NULL,
	"deploy_status" "deploy_status" DEFAULT 'pending' NOT NULL,
	"build_node_id" uuid,
	"deploy_node_id" uuid,
	"image_digest" varchar(100),
	"image_name" varchar(500),
	"build_duration_ms" integer,
	"deploy_duration_ms" integer,
	"error_message" text,
	"build_logs" text,
	"deploy_logs" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"organization_id" uuid NOT NULL,
	"role" "node_role" NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"ssh_user" varchar(100) DEFAULT 'root' NOT NULL,
	"ssh_key_id" uuid NOT NULL,
	"docker_version" varchar(50),
	"docker_endpoint" varchar(255) DEFAULT 'unix:///var/run/docker.sock',
	"runtime_type" varchar(20) DEFAULT 'host',
	"swarm_node_id" varchar(100),
	"swarm_status" "swarm_status" DEFAULT 'unknown',
	"labels" jsonb DEFAULT '{}'::jsonb,
	"resources" jsonb DEFAULT '{}'::jsonb,
	"last_heartbeat_at" timestamp with time zone,
	"status" "node_status" DEFAULT 'offline' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"private_key" text NOT NULL,
	"public_key" text,
	"fingerprint" varchar(100),
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"ssl_enabled" boolean DEFAULT true NOT NULL,
	"ssl_provider" "ssl_provider" DEFAULT 'letsencrypt',
	"certificate" text,
	"private_key_cert" text,
	"tunnel_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "registry_type" NOT NULL,
	"url" varchar(500) NOT NULL,
	"username" text,
	"password" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnel_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tunnel_id" uuid NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"service" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"organization_id" uuid NOT NULL,
	"cloudflare_tunnel_id" varchar(100),
	"cloudflare_account_id" varchar(100),
	"token" text,
	"status" "tunnel_status" DEFAULT 'inactive',
	"node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"event" "notification_event" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"app_id" varchar(255) NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"client_secret" text NOT NULL,
	"webhook_secret" varchar(255) NOT NULL,
	"private_key" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_apps_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_app_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"installation_id" varchar(255) NOT NULL,
	"account_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_node_id_nodes_id_fk" FOREIGN KEY ("build_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deploy_node_id_nodes_id_fk" FOREIGN KEY ("deploy_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_ssh_key_id_ssh_keys_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_tunnel_id_tunnels_id_fk" FOREIGN KEY ("tunnel_id") REFERENCES "public"."tunnels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registries" ADD CONSTRAINT "registries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnel_routes" ADD CONSTRAINT "tunnel_routes_tunnel_id_tunnels_id_fk" FOREIGN KEY ("tunnel_id") REFERENCES "public"."tunnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnels" ADD CONSTRAINT "tunnels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunnels" ADD CONSTRAINT "tunnels_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_apps" ADD CONSTRAINT "github_apps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_github_app_id_github_apps_id_fk" FOREIGN KEY ("github_app_id") REFERENCES "public"."github_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;