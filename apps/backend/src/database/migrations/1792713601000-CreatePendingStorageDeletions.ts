import { MigrationInterface, QueryRunner } from 'typeorm';

// PD-T1 (public-demo audit): retry queue for storage objects of deleted
// accounts. Idempotent (phase 8.5).
export class CreatePendingStorageDeletions1792713601000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pending_storage_deletions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        s3_key varchar(512) NOT NULL,
        attempts int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_storage_deletions_s3_key ON pending_storage_deletions (s3_key)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pending_storage_deletions`);
  }
}
