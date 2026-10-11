// Audit P2 (follow-up to P0-2): give customers.user_id a real FK to users.
// The column was created as varchar by the first migration while users.id is
// uuid, so the type is aligned first. Legacy NULL rows stay NULL (FK ignores
// them); every value present is a real uuid written by scoped code paths.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomersUserIdFk1729500000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fresh installs get user_id as uuid straight from the baseline schema —
    // only convert when the column is still the legacy varchar.
    await queryRunner.query(
      `DO $$ BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'customers' AND column_name = 'user_id'
             AND data_type <> 'uuid'
         ) THEN
           ALTER TABLE customers ALTER COLUMN user_id TYPE uuid
             USING NULLIF(user_id::text, '')::uuid;
         END IF;
       END $$;`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_customers_user_id'
        ) THEN
          ALTER TABLE customers
            ADD CONSTRAINT fk_customers_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE customers DROP CONSTRAINT IF EXISTS fk_customers_user_id`,
    );
    await queryRunner.query(
      `ALTER TABLE customers ALTER COLUMN user_id TYPE varchar USING user_id::text`,
    );
  }
}
