import { MigrationInterface, QueryRunner } from 'typeorm';

// S5.1 (document-types): add a JSONB `metadata` column to `documents` for
// type-specific structured extraction (contract parties/value, delivery note
// delivery_date, PO expected_delivery_date, offer validity_date, ...).
//
// Renamed from 20260630000000-AddDocumentMetadata: TypeORM parses the
// migration timestamp as the last 13 characters of the class name, so the
// 14-digit suffix sorted before the 1729… migrations and broke ordering.
// Databases that recorded the old class name will simply re-run this
// idempotent statement.
export class AddDocumentMetadata1782777600000 implements MigrationInterface {
  name = 'AddDocumentMetadata1782777600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "metadata"`);
  }
}
