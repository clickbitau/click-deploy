CREATE TYPE "public"."in_app_notification_level" AS ENUM('info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"title" varchar(200) NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"level" "in_app_notification_level" DEFAULT 'info' NOT NULL,
	"category" varchar(50) DEFAULT 'system' NOT NULL,
	"resource_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text DEFAULT 'refresh' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deploy_node_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "can_build" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "can_deploy" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "in_app_notif_org_idx" ON "in_app_notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "in_app_notif_user_idx" ON "in_app_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "in_app_notif_read_idx" ON "in_app_notifications" USING btree ("read_at");