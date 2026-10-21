ALTER TYPE "public"."user_role" ADD VALUE 'reseller_admin';--> statement-breakpoint
CREATE TABLE "resellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"contact_email" text,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"max_tenants" integer,
	"brand_name" text NOT NULL,
	"logo_url" text,
	"logo_dark_url" text,
	"accent_color" text,
	"website_url" text,
	"support_email" text,
	"admin_hostname" text,
	"show_powered_by" boolean DEFAULT true NOT NULL,
	"show_designed_by" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resellers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "resellers_admin_hostname_unique" UNIQUE("admin_hostname")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "reseller_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reseller_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_reseller_id_resellers_id_fk" FOREIGN KEY ("reseller_id") REFERENCES "public"."resellers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reseller_id_resellers_id_fk" FOREIGN KEY ("reseller_id") REFERENCES "public"."resellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenants_reseller_idx" ON "tenants" USING btree ("reseller_id");--> statement-breakpoint
CREATE INDEX "users_reseller_idx" ON "users" USING btree ("reseller_id");