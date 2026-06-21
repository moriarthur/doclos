import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import ExcelJS from 'exceljs';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { ExportQueryDto } from './dto/export-query.dto';

// Part 6: Excel Export System
// Builds polished .xlsx workbooks from a user's extracted invoice data and
// delivers them as a direct download (no R2 round-trip). Two shapes:
//   - generateExcel:        a flat list of all invoices (+ Invoice_Items sheet)
//   - generateDetailExcel:  a one-document report (Document Details page)
// Styling mirrors the app's warm palette (tailwind.config.ts). `excel` is the
// only implemented format today; csv/json are reserved.

const SUPPORTED_FORMATS = ['excel'] as const;
export type ExportFormat = (typeof SUPPORTED_FORMATS)[number];

// Brand palette (ARGB for ExcelJS — 'FF' alpha prefix + hex).
const COLOR = {
  brand: 'FF884F40',      // warm brown — title bars
  primary: 'FFD9775F',    // terracotta — column headers
  accentLight: 'FFD4BFA0', // beige/gold — totals
  cream: 'FFFAF9F7',      // zebra rows
  white: 'FFFFFFFF',
  border: 'FFE5E2DA',
} as const;

const MONEY_FMT = '#,##0.00';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private invoiceItemsRepository: Repository<InvoiceItem>,
  ) {}

  /** List export — all of the user's invoices matching the filters (dashboard). */
  async generateExcel(
    userId: string,
    query: ExportQueryDto,
    _format: ExportFormat,
    ids?: string[],
  ): Promise<Buffer> {
    const qb = this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.document', 'document')
      .where('document.user_id = :userId', { userId });

    // Selection export: limit to the chosen documents when ids are supplied.
    if (ids && ids.length > 0) qb.andWhere('invoice.document_id IN (:...ids)', { ids });
    if (query.from_date) qb.andWhere('invoice.invoice_date >= :fromDate', { fromDate: query.from_date });
    if (query.to_date) qb.andWhere('invoice.invoice_date <= :toDate', { toDate: query.to_date });
    if (query.status) qb.andWhere('document.status = :status', { status: query.status });
    if (query.company) qb.andWhere('invoice.supplier_name ILIKE :company', { company: `%${query.company}%` });

    const invoices = await qb.orderBy('invoice.invoice_date', 'DESC').getMany();
    this.logger.log(`Exporting ${invoices.length} invoice(s) for user ${userId}`);

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

    // --- Sheet 1: Invoices ---
    const invoicesSheet = workbook.addWorksheet('Invoices');
    const cols = [
      { header: 'Invoice Number', key: 'invoice_number', width: 22 },
      { header: 'Supplier', key: 'supplier_name', width: 30 },
      { header: 'Invoice Date', key: 'invoice_date', width: 14 },
      { header: 'Due Date', key: 'due_date', width: 14 },
      { header: 'Amount Total', key: 'amount_total', width: 15 },
      { header: 'VAT Amount', key: 'vat_amount', width: 13 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Items', key: 'items_count', width: 9 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    invoicesSheet.columns = cols;
    const colCount = cols.length;

    // Title bar
    invoicesSheet.mergeCells(1, 1, 1, colCount);
    this.styleTitle(invoicesSheet.getCell(1, 1), 'Doclos — Invoices');
    invoicesSheet.getRow(1).height = 26;

    // Header row
    cols.forEach((c, i) => {
      const cell = invoicesSheet.getCell(2, i + 1);
      cell.value = c.header;
      this.styleHeader(cell);
    });
    invoicesSheet.getRow(2).height = 20;

    // Data rows
    const moneyKeys = new Set(['amount_total', 'vat_amount']);
    const rightKeys = new Set(['amount_total', 'vat_amount', 'items_count']);
    invoices.forEach((inv, idx) => {
      const row = invoicesSheet.addRow({
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
      const zebra = idx % 2 === 1;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const key = cols[colNumber - 1].key;
        this.styleData(cell, {
          zebra,
          money: moneyKeys.has(key),
          align: rightKeys.has(key) ? 'right' : key === 'currency' ? 'center' : 'left',
        });
      });
    });

    invoicesSheet.views = [{ state: 'frozen', ySplit: 2 }];
    invoicesSheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: colCount } };

    // --- Sheet 2: Invoice_Items ---
    const itemsSheet = workbook.addWorksheet('Invoice_Items');
    const itemCols = [
      { header: 'Invoice Number', key: 'invoice_number', width: 22 },
      { header: 'Description', key: 'description', width: 42 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Unit Price', key: 'unit_price', width: 13 },
      { header: 'Line Total', key: 'line_total', width: 13 },
    ];
    itemsSheet.columns = itemCols;

    itemsSheet.mergeCells(1, 1, 1, itemCols.length);
    this.styleTitle(itemsSheet.getCell(1, 1), 'Doclos — Invoice Items');
    itemsSheet.getRow(1).height = 26;
    itemCols.forEach((c, i) => {
      const cell = itemsSheet.getCell(2, i + 1);
      cell.value = c.header;
      this.styleHeader(cell);
    });
    itemsSheet.getRow(2).height = 20;

    const itemMoney = new Set(['unit_price', 'line_total']);
    const itemRight = new Set(['quantity', 'unit_price', 'line_total']);
    let itemIdx = 0;
    for (const inv of invoices) {
      for (const item of itemsByInvoice.get(inv.id) ?? []) {
        const row = itemsSheet.addRow({
          invoice_number: inv.invoice_number,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
        });
        const zebra = itemIdx % 2 === 1;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const key = itemCols[colNumber - 1].key;
          this.styleData(cell, {
            zebra,
            money: itemMoney.has(key),
            align: itemRight.has(key) ? 'right' : 'left',
          });
        });
        itemIdx++;
      }
    }
    itemsSheet.views = [{ state: 'frozen', ySplit: 2 }];

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Detail export — a single document's invoice report (Document Details page). */
  async generateDetailExcel(userId: string, documentId: string, _format: ExportFormat): Promise<Buffer> {
    const invoice = await this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.document', 'document')
      .where('invoice.document_id = :documentId', { documentId })
      .andWhere('document.user_id = :userId', { userId })
      .getOne();

    if (!invoice) {
      throw new NotFoundException('No invoice data available for this document');
    }

    const items = await this.invoiceItemsRepository.find({
      where: { invoice_id: invoice.id },
      order: { created_at: 'ASC' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Doclos';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Invoice');
    ws.columns = [{ width: 28 }, { width: 26 }, { width: 16 }, { width: 16 }, { width: 12 }];

    const cur = invoice.currency || '';

    // Title bar
    ws.mergeCells('A1:E1');
    this.styleTitle(ws.getCell('A1'), invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : 'Invoice', 16);
    ws.getRow(1).height = 32;

    // Meta block — label/value pairs in two columns, beige labels.
    const meta = (row: number, label: string, value: ExcelJS.CellValue, label2?: string, value2?: ExcelJS.CellValue) => {
      this.styleLabel(ws.getCell(`A${row}`), label);
      this.styleValue(ws.getCell(`B${row}`), value);
      if (label2 !== undefined) {
        ws.mergeCells(`C${row}:D${row}`);
        this.styleLabel(ws.getCell(`C${row}`), label2);
        this.styleValue(ws.getCell(`E${row}`), value2 as ExcelJS.CellValue);
      } else {
        ws.mergeCells(`C${row}:E${row}`);
        ws.getCell(`C${row}`).border = this.allBorders();
      }
    };
    meta(3, 'Invoice Number', invoice.invoice_number || '-', 'Status', invoice.document?.status || '-');
    meta(4, 'Supplier', invoice.supplier_name || '-', 'Currency', cur || '-');
    meta(
      5,
      'Invoice Date',
      invoice.invoice_date ? this.fmtDate(invoice.invoice_date) : '-',
      'Due Date',
      invoice.due_date ? this.fmtDate(invoice.due_date) : '-',
    );
    ws.mergeCells('A6:E6');
    const addr = ws.getCell('A6');
    addr.value = invoice.supplier_address || '';
    this.styleValue(addr, addr.value);

    // Items header
    const headerRow = 8;
    ['Description', 'Quantity', 'Unit Price', 'Line Total'].forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
      this.styleHeader(cell);
    });
    ws.getRow(headerRow).height = 20;

    // Items rows
    let row = headerRow + 1;
    let itemsTotal = 0;
    items.forEach((item, idx) => {
      ws.getCell(`A${row}`).value = item.description || '';
      ws.getCell(`B${row}`).value = item.quantity ?? '';
      ws.getCell(`C${row}`).value = item.unit_price ?? '';
      ws.getCell(`D${row}`).value = item.line_total ?? '';
      const zebra = idx % 2 === 1;
      this.styleData(ws.getCell(`A${row}`), { zebra });
      this.styleData(ws.getCell(`B${row}`), { zebra, align: 'right' });
      this.styleData(ws.getCell(`C${row}`), { zebra, money: true, align: 'right' });
      this.styleData(ws.getCell(`D${row}`), { zebra, money: true, align: 'right' });
      if (item.line_total != null) itemsTotal += Number(item.line_total);
      row++;
    });
    if (items.length === 0) {
      ws.mergeCells(`A${row}:D${row}`);
      ws.getCell(`A${row}`).value = 'No line items';
      this.styleValue(ws.getCell(`A${row}`), ws.getCell(`A${row}`).value);
      row++;
    }

    // Totals (beige accent, bold)
    const totalRow = (label: string, value: number | null, bold = false) => {
      ws.mergeCells(`A${row}:C${row}`);
      const l = ws.getCell(`A${row}`);
      l.value = label;
      l.alignment = { horizontal: 'right', vertical: 'middle' };
      l.font = { bold, color: { argb: COLOR.brand } };
      l.fill = solidFill(COLOR.accentLight);
      l.border = this.allBorders();
      const v = ws.getCell(`D${row}`);
      v.value = value ?? 0;
      v.numFmt = MONEY_FMT;
      v.alignment = { horizontal: 'right', vertical: 'middle' };
      v.font = { bold, color: { argb: COLOR.brand } };
      v.fill = solidFill(COLOR.accentLight);
      v.border = this.allBorders();
      ws.getCell(`E${row}`).fill = solidFill(COLOR.accentLight);
      ws.getCell(`E${row}`).border = this.allBorders();
      row++;
    };
    totalRow('Items Total', itemsTotal);
    if (invoice.vat_amount != null) totalRow('VAT', Number(invoice.vat_amount));
    totalRow('Amount Total', invoice.amount_total != null ? Number(invoice.amount_total) : 0, true);
    if (cur) {
      ws.getCell(`E${row - 1}`).value = cur;
      ws.getCell(`E${row - 1}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`E${row - 1}`).font = { bold: true, color: { argb: COLOR.brand } };
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // --- Styling helpers ---

  private styleTitle(cell: ExcelJS.Cell, value: ExcelJS.CellValue, size = 14) {
    cell.value = value;
    cell.font = { bold: true, color: { argb: COLOR.white }, size };
    cell.fill = solidFill(COLOR.brand);
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }

  private styleHeader(cell: ExcelJS.Cell) {
    cell.font = { bold: true, color: { argb: COLOR.white }, size: 11 };
    cell.fill = solidFill(COLOR.primary);
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = this.allBorders();
  }

  private styleData(
    cell: ExcelJS.Cell,
    opts: { zebra?: boolean; money?: boolean; align?: 'left' | 'right' | 'center' } = {},
  ) {
    const align = opts.align ?? 'left';
    cell.border = this.allBorders();
    if (opts.zebra) cell.fill = solidFill(COLOR.cream);
    cell.alignment = { vertical: 'middle', horizontal: align, indent: align === 'left' ? 1 : 0 };
    if (opts.money) cell.numFmt = MONEY_FMT;
  }

  private styleLabel(cell: ExcelJS.Cell, value: ExcelJS.CellValue) {
    cell.value = value;
    cell.font = { bold: true, color: { argb: COLOR.brand } };
    cell.fill = solidFill(COLOR.accentLight);
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = this.allBorders();
  }

  private styleValue(cell: ExcelJS.Cell, value: ExcelJS.CellValue) {
    cell.value = value;
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    cell.border = this.allBorders();
  }

  private allBorders() {
    const t = { style: 'thin' as const, color: { argb: COLOR.border } };
    return { top: t, left: t, bottom: t, right: t };
  }

  private fmtDate(d: Date | string): string {
    const date = d instanceof Date ? d : new Date(d);
    return date.toISOString().slice(0, 10);
  }
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
