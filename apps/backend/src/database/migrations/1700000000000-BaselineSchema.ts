import { MigrationInterface, QueryRunner } from 'typeorm';

// Baseline schema migration — creates all 8 tables, enums, indices and FKs
// directly from the entity definitions. Before this file existed the schema
// came from TypeORM synchronize (the old `db:reset` schema:sync), which is
// banned under the migrations-only workflow (P1-5).
//
// Every statement is IDEMPOTENT so this migration is safe on BOTH:
//  - a clean database (fresh clone / new deployment): everything is created
//  - a database provisioned earlier via synchronize: tables/constraints that
//    already exist are skipped instead of aborting the migration run.
//   Timestamp note: TypeORM parses the class-name suffix via substr(-13), so
//   migration timestamps must be exactly 13 digits (this one sorts first).
//
// NEVER run down() against a pre-provisioned database: it would drop the
// live tables. down() only makes sense on a database where this migration
// actually created the schema.

export class BaselineSchema1700000000000 implements MigrationInterface {
  name = 'BaselineSchema1700000000000';

  /** CREATE TYPE guarded against re-runs on already-provisioned databases. */
  private async createEnum(queryRunner: QueryRunner, sql: string): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         CREATE TYPE ${sql};
       EXCEPTION WHEN duplicate_object THEN NULL;
       END $$;`,
    );
  }

  /** ADD CONSTRAINT guarded via pg_constraint (Postgres has no IF NOT EXISTS). */
  private async addConstraint(queryRunner: QueryRunner, name: string, ddl: string): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
           ${ddl};
         END IF;
       END $$;`,
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "email" character varying NOT NULL, "name" character varying, "password_hash" character varying, "oauth_provider" character varying, "oauth_id" character varying, "last_login" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "user_id" uuid, "name" character varying NOT NULL, "tax_id" character varying, "vat_id" character varying, "address" character varying, "city" character varying, "country" character varying, CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_c2f9ebb3eef7869e502644fc0f" ON "customers" ("user_id", "name") `);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "document_id" uuid NOT NULL, "invoice_number" character varying, "invoice_date" date, "due_date" date, "amount_total" numeric(12,2), "vat_amount" numeric(12,2), "currency" character varying NOT NULL DEFAULT 'EUR', "supplier_name" character varying, "supplier_address" character varying, "validated" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_14d8a44ee1acda919f74b9ef52" ON "invoices" ("invoice_date") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_d8f8d3788694e1b3f96c42c36f" ON "invoices" ("invoice_number") `);
    await this.createEnum(queryRunner, `"public"."documents_type_enum" AS ENUM('invoice', 'contract', 'offer', 'delivery_note', 'purchase_order', 'unknown')`);
    await this.createEnum(queryRunner, `"public"."documents_status_enum" AS ENUM('uploaded', 'processing', 'parsed', 'needs_validation', 'validated', 'archived', 'error')`);
    await this.createEnum(queryRunner, `"public"."documents_previous_status_enum" AS ENUM('uploaded', 'processing', 'parsed', 'needs_validation', 'validated', 'archived', 'error')`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "user_id" uuid NOT NULL, "customer_id" uuid, "invoiceId" uuid, "type" "public"."documents_type_enum", "status" "public"."documents_status_enum" NOT NULL DEFAULT 'uploaded', "previous_status" "public"."documents_previous_status_enum", "original_filename" character varying NOT NULL, "s3_key" character varying NOT NULL, "mime_type" character varying NOT NULL, "file_size" integer NOT NULL, "page_count" integer, "processed_at" TIMESTAMP WITH TIME ZONE, "extraction_confidence" real, "extraction_issues" jsonb, "metadata" jsonb, CONSTRAINT "REL_998c6b9d2d3f298243299a14d7" UNIQUE ("invoiceId"), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_709389d904fa03bdf5ec84998d" ON "documents" ("status") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_c7481daf5059307842edef74d7" ON "documents" ("user_id") `);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "invoice_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "invoice_id" uuid NOT NULL, "description" text, "unit" text, "quantity" numeric(10,2), "unit_price" numeric(10,2), "line_total" numeric(10,2), CONSTRAINT "PK_53b99f9e0e2945e69de1a12b75a" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "field_extractions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "document_id" uuid NOT NULL, "field_name" character varying NOT NULL, "value" text NOT NULL, "confidence" numeric(3,2) NOT NULL, "source" character varying NOT NULL, "snippet" text, CONSTRAINT "PK_1a6f349813d04d517150064e03a" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_47a3f98435150f5ceff1de5e53" ON "field_extractions" ("field_name") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_707eb772127538eb81f29dcb1a" ON "field_extractions" ("document_id") `);
    await this.createEnum(queryRunner, `"public"."jobs_job_type_enum" AS ENUM('process_document', 'run_ocr', 'llm_parse', 'generate_excel', 'reprocess_document')`);
    await this.createEnum(queryRunner, `"public"."jobs_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed')`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "job_type" "public"."jobs_job_type_enum" NOT NULL, "status" "public"."jobs_status_enum" NOT NULL DEFAULT 'pending', "document_id" uuid, "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "progress" json, CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), "entity_type" character varying NOT NULL, "entity_id" character varying NOT NULL, "user_id" uuid, "action" character varying NOT NULL, "old_value" jsonb, "new_value" jsonb, CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
    await this.addConstraint(queryRunner, 'FK_11d81cd7be87b6f8865b0cf7661', `ALTER TABLE "customers" ADD CONSTRAINT "FK_11d81cd7be87b6f8865b0cf7661" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_04c08bd4d32a782db66084f7197', `ALTER TABLE "invoices" ADD CONSTRAINT "FK_04c08bd4d32a782db66084f7197" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_c7481daf5059307842edef74d73', `ALTER TABLE "documents" ADD CONSTRAINT "FK_c7481daf5059307842edef74d73" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_390b85354b70567464f6f9f4364', `ALTER TABLE "documents" ADD CONSTRAINT "FK_390b85354b70567464f6f9f4364" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_998c6b9d2d3f298243299a14d72', `ALTER TABLE "documents" ADD CONSTRAINT "FK_998c6b9d2d3f298243299a14d72" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_dc991d555664682cfe892eea2c1', `ALTER TABLE "invoice_items" ADD CONSTRAINT "FK_dc991d555664682cfe892eea2c1" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_707eb772127538eb81f29dcb1ab', `ALTER TABLE "field_extractions" ADD CONSTRAINT "FK_707eb772127538eb81f29dcb1ab" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_13b938014ede30673d6f5ed966a', `ALTER TABLE "jobs" ADD CONSTRAINT "FK_13b938014ede30673d6f5ed966a" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.addConstraint(queryRunner, 'FK_bd2726fd31b35443f2245b93ba0', `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Guarded drops only — see the header: never run against live data you
    // care about; this exists so a fresh dev database can be torn down.
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "FK_bd2726fd31b35443f2245b93ba0"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "FK_13b938014ede30673d6f5ed966a"`);
    await queryRunner.query(`ALTER TABLE "field_extractions" DROP CONSTRAINT IF EXISTS "FK_707eb772127538eb81f29dcb1ab"`);
    await queryRunner.query(`ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "FK_dc991d555664682cfe892eea2c1"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "FK_998c6b9d2d3f298243299a14d72"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "FK_390b85354b70567464f6f9f4364"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "FK_c7481daf5059307842edef74d73"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_04c08bd4d32a782db66084f7197"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "FK_11d81cd7be87b6f8865b0cf7661"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "jobs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."jobs_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."jobs_job_type_enum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_707eb772127538eb81f29dcb1a"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_47a3f98435150f5ceff1de5e53"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "field_extractions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_items"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_c7481daf5059307842edef74d7"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_709389d904fa03bdf5ec84998d"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "documents"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."documents_previous_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."documents_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."documents_type_enum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_d8f8d3788694e1b3f96c42c36f"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_14d8a44ee1acda919f74b9ef52"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoices"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_c2f9ebb3eef7869e502644fc0f"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
