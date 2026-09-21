import { MigrationInterface, QueryRunner } from 'typeorm';

// U-4 (line items): add a nullable `unit` column to `invoice_items` — the
// quantity unit (Stück, Stk., Std., m, kg, ...) extracted by GLM and editable
// in the validation UI. Null when the document doesn't state one.
export class AddInvoiceItemUnit20260922000000 implements MigrationInterface {
  name = 'AddInvoiceItemUnit20260922000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "unit" text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_items" DROP COLUMN IF EXISTS "unit"`);
  }
}
