// P0-2 / P1-5 (audit): customers become per-tenant. First real migration —
// replaces the schema:drop && schema:sync "db:migrate" workflow.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerUserId1729500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable: legacy rows the backfill can't attribute stay invisible
    // (scripts/backfill-customer-user-id.cjs attributes the rest)
    await queryRunner.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS user_id varchar NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS IDX_customers_user_id_name ON customers (user_id, name)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS IDX_customers_user_id_name`);
    await queryRunner.query(`ALTER TABLE customers DROP COLUMN IF EXISTS user_id`);
  }
}
