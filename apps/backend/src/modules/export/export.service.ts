import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import ExcelJS from 'exceljs';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { DocumentStatus } from '../documents/entities/document.entity';
import { ExportQueryDto } from './dto/export-query.dto';
import { ExportI18n, ExportLocale, getExportI18n, resolveExportLocale } from './export.i18n';

// Part 6: Excel Export System
// Builds polished .xlsx workbooks from a user's extracted invoice data and
// delivers them as a direct download (no R2 round-trip). Two shapes:
//   - generateExcel:        a flat list of all invoices (+ Invoice_Items sheet)
//   - generateDetailExcel:  a one-document report (Document Details page)
// Styling mirrors the app's warm palette (tailwind.config.ts). `excel` is the
// only implemented format today; csv/json are reserved. All labels, sheet names,
// status values and number/date formats localize to the requested UI locale
// (`?lang=`, 'de' fallback) via getExportI18n().

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
    lang?: string,
  ): Promise<Buffer> {
    const t = getExportI18n(lang);

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
    this.logger.log(`Exporting ${invoices.length} invoice(s) for user ${userId} (lang=${resolveExportLocale(lang)})`);

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
    const invoicesSheet = workbook.addWorksheet(t.strings.sheetInvoices);
    const cols = [
      { header: t.strings.invoiceNumber, key: 'invoice_number', width: 22 },
      { header: t.strings.supplier, key: 'supplier_name', width: 30 },
      { header: t.strings.invoiceDate, key: 'invoice_date', width: 14 },
      { header: t.strings.dueDate, key: 'due_date', width: 14 },
      { header: t.strings.amountTotal, key: 'amount_total', width: 15 },
      { header: t.strings.vatAmount, key: 'vat_amount', width: 13 },
      { header: t.strings.currency, key: 'currency', width: 10 },
      { header: t.strings.items, key: 'items_count', width: 9 },
      { header: t.strings.status, key: 'status', width: 16 },
    ];
    invoicesSheet.columns = cols;
    const colCount = cols.length;

    // Title bar
    invoicesSheet.mergeCells(1, 1, 1, colCount);
    this.styleTitle(invoicesSheet.getCell(1, 1), t.strings.titleInvoices);
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
    const dateKeys = new Set(['invoice_date', 'due_date']);
    const rightKeys = new Set(['amount_total', 'vat_amount', 'items_count']);
    invoices.forEach((inv, idx) => {
      const row = invoicesSheet.addRow({
        invoice_number: inv.invoice_number,
        supplier_name: inv.supplier_name,
        invoice_date: this.toExcelDate(inv.invoice_date),
        due_date: this.toExcelDate(inv.due_date),
        amount_total: inv.amount_total != null ? Number(inv.amount_total) : null,
        vat_amount: inv.vat_amount != null ? Number(inv.vat_amount) : null,
        currency: inv.currency,
        items_count: itemsByInvoice.get(inv.id)?.length ?? 0,
        status: this.translateStatus(inv.document?.status, t),
      });
      const zebra = idx % 2 === 1;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const key = cols[colNumber - 1].key;
        this.styleData(cell, {
          zebra,
          money: moneyKeys.has(key),
          date: dateKeys.has(key),
          moneyFmt: t.numFmt.money,
          dateFmt: t.numFmt.date,
          align: rightKeys.has(key) ? 'right' : key === 'currency' ? 'center' : 'left',
        });
      });
    });

    invoicesSheet.views = [{ state: 'frozen', ySplit: 2 }];
    invoicesSheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: colCount } };

    // --- Sheet 2: Invoice_Items ---
    const itemsSheet = workbook.addWorksheet(t.strings.sheetInvoiceItems);
    const itemCols = [
      { header: t.strings.invoiceNumber, key: 'invoice_number', width: 22 },
      { header: t.strings.description, key: 'description', width: 42 },
      { header: t.strings.quantity, key: 'quantity', width: 10 },
      { header: t.strings.unitPrice, key: 'unit_price', width: 13 },
      { header: t.strings.lineTotal, key: 'line_total', width: 13 },
    ];
    itemsSheet.columns = itemCols;

    itemsSheet.mergeCells(1, 1, 1, itemCols.length);
    this.styleTitle(itemsSheet.getCell(1, 1), t.strings.titleInvoiceItems);
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
          quantity: item.quantity != null ? Number(item.quantity) : null,
          unit_price: item.unit_price != null ? Number(item.unit_price) : null,
          line_total: item.line_total != null ? Number(item.line_total) : null,
        });
        const zebra = itemIdx % 2 === 1;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const key = itemCols[colNumber - 1].key;
          this.styleData(cell, {
            zebra,
            money: itemMoney.has(key),
            moneyFmt: t.numFmt.money,
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
  async generateDetailExcel(
    userId: string,
    documentId: string,
    _format: ExportFormat,
    lang?: string,
  ): Promise<Buffer> {
    const t = getExportI18n(lang);
    const locale = resolveExportLocale(lang);

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

    const ws = workbook.addWorksheet(t.strings.sheetInvoice);
    ws.columns = [{ width: 28 }, { width: 26 }, { width: 16 }, { width: 16 }, { width: 12 }];

    const cur = invoice.currency || '';

    // Title bar
    ws.mergeCells('A1:E1');
    this.styleTitle(ws.getCell('A1'), invoice.invoice_number ? `${t.strings.invoice} ${invoice.invoice_number}` : t.strings.invoice, 16);
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
    meta(3, t.strings.invoiceNumber, invoice.invoice_number || '-', t.strings.status, this.translateStatus(invoice.document?.status, t) || '-');
    meta(4, t.strings.supplier, invoice.supplier_name || '-', t.strings.currency, cur || '-');
    meta(
      5,
      t.strings.invoiceDate,
      invoice.invoice_date ? this.formatLocaleDate(invoice.invoice_date, locale) : '-',
      t.strings.dueDate,
      invoice.due_date ? this.formatLocaleDate(invoice.due_date, locale) : '-',
    );
    ws.mergeCells('A6:E6');
    const addr = ws.getCell('A6');
    addr.value = invoice.supplier_address || '';
    this.styleValue(addr, addr.value);

    // Items header
    const headerRow = 8;
    [t.strings.description, t.strings.quantity, t.strings.unitPrice, t.strings.lineTotal].forEach((h, i) => {
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
      ws.getCell(`B${row}`).value = item.quantity != null ? Number(item.quantity) : '';
      ws.getCell(`C${row}`).value = item.unit_price != null ? Number(item.unit_price) : '';
      ws.getCell(`D${row}`).value = item.line_total != null ? Number(item.line_total) : '';
      const zebra = idx % 2 === 1;
      this.styleData(ws.getCell(`A${row}`), { zebra });
      this.styleData(ws.getCell(`B${row}`), { zebra, align: 'right' });
      this.styleData(ws.getCell(`C${row}`), { zebra, money: true, moneyFmt: t.numFmt.money, align: 'right' });
      this.styleData(ws.getCell(`D${row}`), { zebra, money: true, moneyFmt: t.numFmt.money, align: 'right' });
      if (item.line_total != null) itemsTotal += Number(item.line_total);
      row++;
    });
    if (items.length === 0) {
      ws.mergeCells(`A${row}:D${row}`);
      ws.getCell(`A${row}`).value = t.strings.noLineItems;
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
      v.numFmt = t.numFmt.money;
      v.alignment = { horizontal: 'right', vertical: 'middle' };
      v.font = { bold, color: { argb: COLOR.brand } };
      v.fill = solidFill(COLOR.accentLight);
      v.border = this.allBorders();
      ws.getCell(`E${row}`).fill = solidFill(COLOR.accentLight);
      ws.getCell(`E${row}`).border = this.allBorders();
      row++;
    };
    totalRow(t.strings.totalsItemsTotal, itemsTotal);
    if (invoice.vat_amount != null) totalRow(t.strings.totalsVat, Number(invoice.vat_amount));
    totalRow(t.strings.totalsAmountTotal, invoice.amount_total != null ? Number(invoice.amount_total) : 0, true);
    if (cur) {
      ws.getCell(`E${row - 1}`).value = cur;
      ws.getCell(`E${row - 1}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`E${row - 1}`).font = { bold: true, color: { argb: COLOR.brand } };
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // --- i18n / formatting helpers ---

  private translateStatus(status: string | null | undefined, t: ExportI18n): string {
    if (!status) return '';
    return t.status[status as DocumentStatus] ?? status;
  }

  /**
   * Parse a DB date (Date | ISO string | 'YYYY-MM-DD') into its calendar
   * components — timezone-neutral, so the day is never shifted by the host TZ.
   */
  private parsePlainDate(v: Date | string | null | undefined): { y: number; m: number; d: number } | null {
    if (!v) return null;
    if (v instanceof Date) {
      return Number.isNaN(v.getTime()) ? null : { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }

  /**
   * Excel date serial for a DB date, computed as an INTEGER via Date.UTC so
   * ExcelJS stores a whole day (no time fraction) and never shifts the day due
   * to the host timezone (a known ExcelJS quirk when a JS Date is assigned
   * directly). Returns null for empty/invalid input (empty cell).
   */
  private toExcelDate(v: Date | string | null | undefined): number | null {
    const d = this.parsePlainDate(v);
    if (!d) return null;
    const ms = Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(1899, 11, 30);
    return Math.floor(ms / 86_400_000);
  }

  /** Locale-formatted date string for the detail report's single meta cells. */
  private formatLocaleDate(v: Date | string | null | undefined, locale: ExportLocale): string {
    const d = this.parsePlainDate(v);
    if (!d) return '-';
    const yyyy = d.y;
    const mm = String(d.m).padStart(2, '0');
    const dd = String(d.d).padStart(2, '0');
    return locale === 'en' ? `${yyyy}-${mm}-${dd}` : `${dd}.${mm}.${yyyy}`;
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
    opts: {
      zebra?: boolean;
      money?: boolean;
      date?: boolean;
      moneyFmt?: string;
      dateFmt?: string;
      align?: 'left' | 'right' | 'center';
    } = {},
  ) {
    const align = opts.align ?? 'left';
    cell.border = this.allBorders();
    if (opts.zebra) cell.fill = solidFill(COLOR.cream);
    cell.alignment = { vertical: 'middle', horizontal: align, indent: align === 'left' ? 1 : 0 };
    if (opts.money && opts.moneyFmt) cell.numFmt = opts.moneyFmt;
    else if (opts.date && opts.dateFmt) cell.numFmt = opts.dateFmt;
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
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
