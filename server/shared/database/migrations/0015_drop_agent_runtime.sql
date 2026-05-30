ALTER TABLE "specifyr_vault"."jwt_signing_key" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_agent_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runner_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "specifyr_vault"."jwt_signing_key" CASCADE;--> statement-breakpoint
DROP TABLE "llm_agent_profiles" CASCADE;--> statement-breakpoint
DROP POLICY "llm_credentials_proxy_owner_isolation_select" ON "llm_credentials" CASCADE;--> statement-breakpoint
DROP POLICY "llm_credentials_proxy_owner_isolation_update" ON "llm_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "llm_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "runner_sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "orgs" DROP CONSTRAINT "orgs_bridge_subnet_is_24_chk";--> statement-breakpoint
DROP INDEX "orgs_bridge_subnet_uq";--> statement-breakpoint
ALTER TABLE "orgs" DROP COLUMN "bridge_subnet";--> statement-breakpoint
ALTER TABLE "orgs" DROP COLUMN "init_status";--> statement-breakpoint
DROP SCHEMA "specifyr_vault";
