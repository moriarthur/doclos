// Part 2: Data Model - Database configuration with TypeORM
import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as dns from 'dns';

// Force IPv4 — WSL2 doesn't route IPv6 to external hosts
dns.setDefaultResultOrder('ipv4first');

// Explicitly import entities for Webpack compatibility
import { User } from '../modules/auth/entities/user.entity';
import { Customer } from '../modules/documents/entities/customer.entity';
import { Document } from '../modules/documents/entities/document.entity';
import { Invoice } from '../modules/documents/entities/invoice.entity';
import { InvoiceItem } from '../modules/documents/entities/invoice-item.entity';
import { FieldExtraction } from '../modules/documents/entities/field-extraction.entity';
import { Job } from '../modules/jobs/entities/job.entity';
import { AuditLog } from '../modules/jobs/entities/audit-log.entity';

// Load .env file early for TypeORM configuration
// From dist/apps/backend/database, we need to go up 4 levels to reach project root
// From src/apps/backend/database during dev, we need to go up 3 levels
const possibleEnvPaths = [
  path.join(__dirname, '../../../.env'), // From src during dev
  path.join(__dirname, '../../../../.env'), // From dist during build
  path.join(process.cwd(), '../../.env'), // Relative to working directory
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

// Parse DATABASE_URL to get individual components
const databaseUrl = process.env.DATABASE_URL || '';
const urlMatch = databaseUrl.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
let host, port, username, password, database;

if (urlMatch) {
  [, username, password, host, port, database] = urlMatch;
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: host || process.env.DB_HOST,
  port: port ? parseInt(port, 10) : (process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432),
  username: username || process.env.DB_USERNAME,
  password: password || process.env.DB_PASSWORD,
  database: database || process.env.DB_NAME,
  // Explicitly list entities for Webpack compatibility
  entities: [
    User,
    Customer,
    Document,
    Invoice,
    InvoiceItem,
    FieldExtraction,
    Job,
    AuditLog,
  ],
  migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
  synchronize: process.env.NODE_ENV !== 'production', // Use migrations in production
  // Log only failed queries — normal per-query logging was flooding the logs.
  logging: ['error'],
  // Supabase Pooler requires SSL; rejectUnauthorized disabled for dev behind corporate proxy/AV
  ssl: host?.includes('pooler.supabase.com')
    ? { rejectUnauthorized: process.env.NODE_ENV === 'production' }
    : false,
};

// Default data source for CLI commands
export default new DataSource(dataSourceOptions);
