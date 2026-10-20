CREATE TYPE "public"."console_connection" AS ENUM('site_manager', 'direct');--> statement-breakpoint
CREATE TYPE "public"."guest_status" AS ENUM('pending', 'authorized', 'failed');--> statement-breakpoint
CREATE TYPE "public"."health_status" AS ENUM('unknown', 'ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."hostname_status" AS ENUM('pending', 'dns_ok', 'active', 'error');--> statement-breakpoint
CREATE TABLE "console_devices" (
	"mac" text PRIMARY KEY NOT NULL,
	"console_site_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text,
	"model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"console_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unifi_site_id" text NOT NULL,
	"site_name" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consoles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"connection" "console_connection" NOT NULL,
	"host_id" text,
	"base_url" text,
	"api_key" text NOT NULL,
	"verify_tls" boolean DEFAULT true NOT NULL,
	"status" "health_status" DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"console_site_id" uuid,
	"client_mac" text NOT NULL,
	"ap_mac" text,
	"ssid" text,
	"original_url" text,
	"status" "guest_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authorized_at" timestamp with time zone,
	"access_until" timestamp with time zone,
	CONSTRAINT "guest_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "hostnames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"status" "hostname_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hostnames_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "portal_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"title" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"welcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accent_color" text DEFAULT '#FF6B57' NOT NULL,
	"require_terms" boolean DEFAULT true NOT NULL,
	"time_limit_minutes" integer DEFAULT 480 NOT NULL,
	"data_limit_mb" integer,
	"down_kbps" integer,
	"up_kbps" integer,
	"success_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "console_devices" ADD CONSTRAINT "console_devices_console_site_id_console_sites_id_fk" FOREIGN KEY ("console_site_id") REFERENCES "public"."console_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_devices" ADD CONSTRAINT "console_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_sites" ADD CONSTRAINT "console_sites_console_id_consoles_id_fk" FOREIGN KEY ("console_id") REFERENCES "public"."consoles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_sites" ADD CONSTRAINT "console_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consoles" ADD CONSTRAINT "consoles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_console_site_id_console_sites_id_fk" FOREIGN KEY ("console_site_id") REFERENCES "public"."console_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostnames" ADD CONSTRAINT "hostnames_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "console_sites_unique" ON "console_sites" USING btree ("console_id","unifi_site_id");--> statement-breakpoint
CREATE INDEX "console_sites_name_idx" ON "console_sites" USING btree ("site_name");--> statement-breakpoint
CREATE INDEX "guest_sessions_tenant_idx" ON "guest_sessions" USING btree ("tenant_id","created_at");