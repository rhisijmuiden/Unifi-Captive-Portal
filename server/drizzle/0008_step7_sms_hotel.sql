CREATE TABLE "guest_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guest_session_id" uuid,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotel_stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"room" text NOT NULL,
	"surname" text NOT NULL,
	"surname_key" text NOT NULL,
	"arrival" timestamp with time zone NOT NULL,
	"departure" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "hotel_stay_id" uuid;--> statement-breakpoint
ALTER TABLE "guest_verifications" ADD CONSTRAINT "guest_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_verifications" ADD CONSTRAINT "guest_verifications_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_stays" ADD CONSTRAINT "hotel_stays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_verifications_session_idx" ON "guest_verifications" USING btree ("guest_session_id","created_at");--> statement-breakpoint
CREATE INDEX "guest_verifications_tenant_idx" ON "guest_verifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "guest_verifications_phone_idx" ON "guest_verifications" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "hotel_stays_room_idx" ON "hotel_stays" USING btree ("tenant_id","room","departure");--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_stays_external_unique" ON "hotel_stays" USING btree ("tenant_id","source","external_id");--> statement-breakpoint
CREATE INDEX "guest_sessions_hotel_idx" ON "guest_sessions" USING btree ("hotel_stay_id");