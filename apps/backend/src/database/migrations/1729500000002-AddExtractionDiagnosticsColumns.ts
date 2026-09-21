// Reconciliation follow-up: the July S5.1 migration added only the `metadata`
// jsonb column, but the entity also carries `extraction_confidence` (real) and
// `extraction_issues` (jsonb). On the author's machine synchronize:true hid the
// gap; under P1-5 (migrations-only) the columns must come from a migration.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExtractionDiagnosticsColumns1729500000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_confidence real NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_issues jsonb NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE documents DROP COLUMN IF EXISTS extraction_issues`);
    await queryRunner.query(`ALTER TABLE documents DROP COLUMN IF EXISTS extraction_confidence`);
  }
}
