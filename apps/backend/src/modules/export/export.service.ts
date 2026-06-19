import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import ExcelJS from 'exceljs';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { ExportQueryDto } from './dto/export-query.dto';

// Part 6: Excel Export System
// Builds an .xlsx (Invoices + Invoice_Items sheets) from a user's extracted
// invoice data. Delivered as a direct download (no R2 round-trip).
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private invoiceItemsRepository: Repository<InvoiceItem>,
  ) {}

  async generateExcel(userId: string, query: ExportQueryDto): Promise<Buffer> {
    const qb = this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.document', 'document')
      .where('document.user_id = :userId', { userId });

    if (query.from_date) {
      qb.andWhere('invoice.invoice_date >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      qb.andWhere('invoice.invoice_date <= :toDate', { toDate: query.to_date });
    }
    if (query.status) {
      qb.andWhere('document.status = :status', { status: query.status });
    }
    if (query.company) {
      qb.andWhere('invoice.supplier_name ILIKE :company', { company: `%${query.company}%` });
    }

    const invoices = await qb.orderBy('invoice.invoice_date', 'DESC').getMany();
    this.logger.log(`Exporting ${invoices.length} invoice(s) for user ${userId}`);

    // Invoice has no items relation; fetch line items for the matched invoices.
    const itemsByInvoice = new Map<string, InvoiceItem[]>();
    if (invoices.length > 0) {
      const items = await this.invoiceItemsRepository.find({
        where: { invoice_id: In(invoices.map((i) => i.id)) },
      });
      for (const item of items) {
        const arr = itemsByInvoice.get(item.invoice_id) ?? [];
        arr.push(item);
        itemsByInvoice.set(item.invoice_id, arr);
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Doclos';
    workbook.created = new Date();

    const invoicesSheet = workbook.addWorksheet('Invoices');
    invoicesSheet.columns = [
      { header: 'Invoice Number', key: 'invoice_number', width: 22 },
      { header: 'Supplier', key: 'supplier_name', width: 28 },
      { header: 'Invoice Date', key: 'invoice_date', width: 14 },
      { header: 'Due Date', key: 'due_date', width: 14 },
      { header: 'Amount Total', key: 'amount_total', width: 14 },
      { header: 'VAT Amount', key: 'vat_amount', width: 12 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Items Count', key: 'items_count', width: 12 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    for (const inv of invoices) {
      invoicesSheet.addRow({
        invoice_number: inv.invoice_number,
        supplier_name: inv.supplier_name,
        invoice_date: inv.invoice_date ? this.fmtDate(inv.invoice_date) : '',
        due_date: inv.due_date ? this.fmtDate(inv.due_date) : '',
        amount_total: inv.amount_total,
        vat_amount: inv.vat_amount,
        currency: inv.currency,
        items_count: itemsByInvoice.get(inv.id)?.length ?? 0,
        status: inv.document?.status,
      });
    }
    invoicesSheet.getRow(1).font = { bold: true };

    const itemsSheet = workbook.addWorksheet('Invoice_Items');
    itemsSheet.columns = [
      { header: 'Invoice Number', key: 'invoice_number', width: 22 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Unit Price', key: 'unit_price', width: 12 },
      { header: 'Line Total', key: 'line_total', width: 12 },
    ];
    for (const inv of invoices) {
      for (const item of itemsByInvoice.get(inv.id) ?? []) {
        itemsSheet.addRow({
          invoice_number: inv.invoice_number,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
        });
      }
    }
    itemsSheet.getRow(1).font = { bold: true };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private fmtDate(d: Date | string): string {
    const date = d instanceof Date ? d : new Date(d);
    return date.toISOString().slice(0, 10);
  }
}
