CREATE TABLE "ad_stats" (
	"ad_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ad_stats_ad_id_day_pk" PRIMARY KEY("ad_id","day")
);
--> statement-breakpoint
CREATE TABLE "guest_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"phone" text,
	"locale" text,
	"source" text,
	"opt_in" boolean DEFAULT false NOT NULL,
	"opt_in_at" timestamp with time zone,
	"visits" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_error" text
);
--> statement-breakpoint
CREATE TABLE "portal_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"media_id" uuid,
	"link_url" text,
	"placement" text NOT NULL,
	"seconds" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text,
	"email_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"via" text DEFAULT 'guest' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "privacy_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guest_session_id" uuid,
	"rating" integer NOT NULL,
	"comment" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_responses_guest_session_id_unique" UNIQUE("guest_session_id")
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "ad_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_stats" ADD CONSTRAINT "ad_stats_ad_id_portal_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."portal_ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_contacts" ADD CONSTRAINT "guest_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_ads" ADD CONSTRAINT "portal_ads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_ads" ADD CONSTRAINT "portal_ads_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contacts_email_unique" ON "guest_contacts" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "guest_contacts_seen_idx" ON "guest_contacts" USING btree ("tenant_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "portal_ads_tenant_idx" ON "portal_ads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_tenant_idx" ON "privacy_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "survey_responses_tenant_idx" ON "survey_responses" USING btree ("tenant_id","created_at");