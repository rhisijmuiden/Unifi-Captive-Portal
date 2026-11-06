CREATE TABLE "access_request_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"approver" text NOT NULL,
	"token_hash" text NOT NULL,
	CONSTRAINT "access_request_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guest_session_id" uuid,
	"client_mac" text NOT NULL,
	"ssid" text,
	"name" text,
	"email" text,
	"message" text,
	"locale" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_settings" ALTER COLUMN "auth" SET DEFAULT '{"methods":["free"],"emailName":"optional","emailPhone":"off","marketingOptIn":false,"welcomeMail":false,"paymentEmail":"required","approvers":[],"approvalRemember":true}'::jsonb;--> statement-breakpoint
ALTER TABLE "access_request_links" ADD CONSTRAINT "access_request_links_request_id_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."access_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_request_links_request_idx" ON "access_request_links" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "access_requests_device_idx" ON "access_requests" USING btree ("tenant_id","client_mac","created_at");--> statement-breakpoint
CREATE INDEX "access_requests_tenant_idx" ON "access_requests" USING btree ("tenant_id","created_at");