// Idempotent demo seed for the public demo preview.
//
//   DEMO_EMAIL=... DEMO_PASSWORD=... pnpm db:seed      (or pnpm demo:seed)
//
// 1. Ensures the demo account exists (DEMO_EMAIL / DEMO_PASSWORD); re-syncs
//    the password hash when it drifted, otherwise leaves the account alone.
// 2. Writes the synthetic sample invoice (no PII — see sample-invoice.ts)
//    to apps/backend/seeds/sample-invoice.pdf for the upload demo step.
//
// Safe to run any number of times; it never touches other users or data.
// .env (DEMO_*, DATABASE_URL) is loaded as a side effect of importing
// data-source.ts, exactly like the db:migrate flow. Shell env vars win
// over .env values (dotenv never overrides already-set variables).

import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../modules/auth/entities/user.entity';
import { dataSourceOptions } from '../data-source';
import { buildSampleInvoicePdf } from './sample-invoice';

const DEMO_USER_NAME = 'Demo Account';
export const SAMPLE_INVOICE_RELATIVE_PATH = path.join('seeds', 'sample-invoice.pdf');

export function resolveSampleInvoicePath(): string {
  // ts-node runs from apps/backend; resolve against cwd like db:seed does.
  return path.resolve(process.cwd(), SAMPLE_INVOICE_RELATIVE_PATH);
}

export function writeSampleInvoiceFile(targetPath?: string): string {
  const filePath = targetPath ?? resolveSampleInvoicePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buildSampleInvoicePdf());
  return filePath;
}

/** Create the demo account on first run; keep its password in sync afterwards. */
export async function ensureDemoUser(dataSource: DataSource): Promise<{
  created: boolean;
  passwordResynced: boolean;
}> {
  const email = (process.env.DEMO_EMAIL || '').toLowerCase().trim();
  const password = process.env.DEMO_PASSWORD || '';

  if (!email || !password) {
    throw new Error(
      'DEMO_EMAIL and DEMO_PASSWORD must be set (see .env.example) before running the demo seed',
    );
  }
  // Mirror the registration policy (class-validator min length 12) so the
  // demo account cannot be created with a password the login form rejects.
  if (password.length < 12) {
    throw new Error('DEMO_PASSWORD must be at least 12 characters (registration policy)');
  }

  const usersRepository = dataSource.getRepository(User);
  const existing = await usersRepository.findOne({ where: { email } });
  const passwordMatches = existing
    ? await bcrypt.compare(password, existing.password_hash)
    : false;

  if (!existing) {
    await usersRepository.insert({
      email,
      name: DEMO_USER_NAME,
      password_hash: await bcrypt.hash(password, 10),
    });
    return { created: true, passwordResynced: false };
  }

  if (!passwordMatches) {
    // Only accounts explicitly marked as the demo account may be re-synced —
    // never overwrite the password of an ordinary user who happened to match
    // DEMO_EMAIL. FORCE_DEMO_SEED=1 is the deliberate escape hatch.
    const isDemoAccount = existing.name === DEMO_USER_NAME;
    if (!isDemoAccount && process.env.FORCE_DEMO_SEED !== '1') {
      throw new Error(
        `DEMO_EMAIL ${email} already belongs to a non-demo account ("${existing.name}"). ` +
          'Pick a different DEMO_EMAIL, or set FORCE_DEMO_SEED=1 to take the account over.',
      );
    }
    existing.password_hash = await bcrypt.hash(password, 10);
    await usersRepository.save(existing);
    return { created: false, passwordResynced: true };
  }

  return { created: false, passwordResynced: false };
}

async function main() {
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();
  try {
    const { created, passwordResynced } = await ensureDemoUser(dataSource);
    const email = (process.env.DEMO_EMAIL || '').toLowerCase().trim();
    if (created) console.log(`✅ demo user created: ${email}`);
    else if (passwordResynced) console.log(`✅ demo user password re-synced: ${email}`);
    else console.log(`✅ demo user already up to date: ${email}`);

    const filePath = writeSampleInvoiceFile();
    console.log(`✅ synthetic sample invoice written: ${filePath}`);
    console.log('   (fictional data only — upload it via the UI for the processing demo)');
  } finally {
    await dataSource.destroy();
  }
}

const isDirectRun = process.argv[1]?.endsWith('demo.seed.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error('❌ demo seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
