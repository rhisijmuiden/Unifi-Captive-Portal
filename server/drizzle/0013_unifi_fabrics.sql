CREATE TABLE "unifi_fabrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"api_key" text NOT NULL,
	"status" "health_status" DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"last_check_at" timestamp with time zone,
	"hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"known_host_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consoles" ADD COLUMN "fabric_id" uuid;--> statement-breakpoint
ALTER TABLE "unifi_fabrics" ADD CONSTRAINT "unifi_fabrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consoles" ADD CONSTRAINT "consoles_fabric_id_unifi_fabrics_id_fk" FOREIGN KEY ("fabric_id") REFERENCES "public"."unifi_fabrics"("id") ON DELETE cascade ON UPDATE no action;