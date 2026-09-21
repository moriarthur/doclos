import { MigrationInterface, QueryRunner } from 'typeorm';

// S5.1 (document-types): add a JSONB `metadata` column to `documents` for
// type-specific structured extraction (contract parties/value, delivery note
// delivery_date, PO expected_delivery_date, offer validity_date, ...).
//
// DEV does not need this — data-source.ts runs with synchronize:true outside
// production, so the column is auto-created from the entity. This file is the
// PRODUCTION migration.
//
// NOTE: the migration runner has never been exercised in this project.
// data-source.ts:64 globs `__dirname + '/database/migrations/*'`, which (because
// __dirname is already .../src/database) resolves to a doubled
// `.../src/database/database/migrations` path — so this file will NOT be picked
// up as-is. Before running migrations against a prod-shaped DB, fix that glob to
// `__dirname + '/migrations/*'` and verify `typeorm migration:run` finds it.
export class AddDocumentMetadata20260630000000 implements MigrationInterface {
  name = 'AddDocumentMetadata20260630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "metadata"`);
  }
}
