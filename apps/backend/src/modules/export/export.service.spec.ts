// U-9 (audit): exporting an empty result set must fail with 400 instead of
// producing a title-only xlsx. Selection exports with 0 matching ids are
// covered by the same guard.
import { BadRequestException } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ExportService } from './export.service';
import { Document } from '../documents/entities/document.entity';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { ExportQueryDto } from './dto/export-query.dto';

const makeQb = (rows: unknown[]) => {
  const qb: Record<string, unknown> = {};
  const chain = () => qb;
  qb['leftJoinAndSelect'] = chain;
  qb['where'] = chain;
  qb['andWhere'] = chain;
  qb['orderBy'] = chain;
  qb['getMany'] = async () => rows;
  return qb as unknown as SelectQueryBuilder<Invoice>;
};

const makeService = (invoiceRows: unknown[]) => {
  const invoicesRepo = {
    createQueryBuilder: jest.fn(() => makeQb(invoiceRows)),
  };
  const itemsRepo = { find: jest.fn(async () => []) };
  const documentsRepo = { createQueryBuilder: jest.fn(() => makeQb([])) };
  const service = new ExportService(
    invoicesRepo as unknown as Repository<Invoice>,
    itemsRepo as unknown as Repository<InvoiceItem>,
    documentsRepo as unknown as Repository<Document>,
  );
  return service;
};

describe('ExportService empty-result guard (U-9)', () => {
  it('rejects an empty invoice list with BadRequestException', async () => {
    const service = makeService([]);
    await expect(
      service.generateExcel('user-1', {} as ExportQueryDto, 'excel', undefined, 'de'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a selection export whose ids match nothing', async () => {
    const service = makeService([]);
    await expect(
      service.generateExcel('user-1', {} as ExportQueryDto, 'excel', ['nope-1'], 'en'),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns a buffer when there is data', async () => {
    const invoice = {
      id: 'inv-1',
      invoice_number: 'R-1',
      invoice_date: new Date('2026-04-03'),
      due_date: null,
      amount_total: '1200.50',
      vat_amount: '0',
      currency: 'EUR',
      supplier_name: 'Müller GmbH',
      supplier_address: null,
      validated: true,
      document: { id: 'doc-1', status: 'parsed' },
    } as unknown as Invoice;
    const service = makeService([invoice]);

    const result = await service.generateExcel('user-1', {} as ExportQueryDto, 'excel', undefined, 'en');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
