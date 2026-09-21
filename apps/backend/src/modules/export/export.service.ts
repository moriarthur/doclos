import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import ExcelJS from 'exceljs';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { DocumentStatus, DocumentType, Document } from '../documents/entities/document.entity';
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
    @InjectRepository(Document)
    private documentsRepository: Repository<Document>,
  ) {}

  /** List export — dispatches to a per-type list builder (default: invoices). */
  async generateExcel(
    userId: string,
    query: ExportQueryDto,
    _format: ExportFormat,
    ids?: string[],
    lang?: string,
  ): Promise<Buffer> {
    const type = (query.type as DocumentType) ?? DocumentType.INVOICE;
    switch (type) {
      case DocumentType.CONTRACT:
        return this.generateContractList(userId, query, ids, lang);
      case DocumentType.PURCHASE_ORDER:
      case DocumentType.OFFER:
      case DocumentType.DELIVERY_NOTE:
        return this.generateCommercialList(userId, query, ids, lang, type);
      case DocumentType.INVOICE:
      default:
        return this.generateInvoiceList(userId, query, ids, lang);
    }
  }

  /** Invoice list export: invoices sheet + invoice_items sheet (real invoices only). */
  private async generateInvoiceList(
    userId: string,
    query: ExportQueryDto,
    ids?: string[],
    lang?: string,
  ): Promise<Buffer> {
    const t = getExportI18n(lang);

    const qb = this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.document', 'document')
      .where('document.user_id = :userId', { userId })
      // S5.3: the invoices table also holds PO/offer/delivery_note carrier rows —
      // export only real invoices from the invoice bucket.
      .andWhere('document.type = :type', { type: DocumentType.INVOICE });

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
        invoice_number: this.escapeCell(inv.invoice_number),
        supplier_name: this.escapeCell(inv.supplier_name),
        invoice_date: this.toExcelDate(inv.invoice_date),
        due_date: this.toExcelDate(inv.due_date),
        amount_total: inv.amount_total != null ? Number(inv.amount_total) : null,
        vat_amount: inv.vat_amount != null ? Number(inv.vat_amount) : null,
        currency: this.escapeCell(inv.currency),
        items_count: itemsByInvoice.get(inv.id)?.length ?? 0,
        status: this.escapeCell(this.translateStatus(inv.document?.status, t)),
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
          invoice_number: this.escapeCell(inv.invoice_number),
          description: this.escapeCell(item.description),
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

  /** Contract list export: one row per `document.type='contract'` (metadata-only). */
  private async generateContractList(
    userId: string,
    query: ExportQueryDto,
    ids?: string[],
    lang?: string,
  ): Promise<Buffer> {
    const t = getExportI18n(lang);
    const qb = this.documentsRepository
      .createQueryBuilder('document')
      .where('document.user_id = :userId', { userId })
      .andWhere('document.type = :type', { type: DocumentType.CONTRACT });
    if (ids && ids.length > 0) qb.andWhere('document.id IN (:...ids)', { ids });
    if (query.status) qb.andWhere('document.status = :status', { status: query.status });
    // Contracts carry no carrier row — filter company/date against metadata JSON.
    if (query.company) {
      qb.andWhere(
        "coalesce(document.metadata->>'seller_name', '') ILIKE :company OR coalesce(document.metadata->>'buyer_name', '') ILIKE :company",
        { company: `%${query.company}%` },
      );
    }
    if (query.from_date) qb.andWhere("document.metadata->>'effective_date' >= :fromDate", { fromDate: query.from_date });
    if (query.to_date) qb.andWhere("document.metadata->>'effective_date' <= :toDate", { toDate: query.to_date });
    const docs = await qb.orderBy('document.created_at', 'DESC').getMany();
    this.logger.log(`Exporting ${docs.length} contract(s) for user ${userId} (lang=${resolveExportLocale(lang)})`);

    const cols = [
      { header: t.strings.seller, key: 'seller_name', width: 30 },
      { header: t.strings.buyer, key: 'buyer_name', width: 30 },
      { header: t.strings.effectiveDate, key: 'effective_date', width: 14 },
      { header: t.strings.endDate, key: 'end_date', width: 14 },
      { header: t.strings.contractValue, key: 'contract_value', width: 15 },
      { header: t.strings.currency, key: 'currency', width: 10 },
      { header: t.strings.contractSubject, key: 'subject', width: 36 },
      { header: t.strings.contractTerm, key: 'term_description', width: 20 },
      { header: t.strings.status, key: 'status', width: 16 },
    ];
    const meta = (d: Document, k: string) => (d.metadata as Record<string, unknown> | null)?.[k];
    const rows = docs.map((d) => ({
      seller_name: this.escapeCell(this.asString(meta(d, 'seller_name'))),
      buyer_name: this.escapeCell(this.asString(meta(d, 'buyer_name'))),
      effective_date: this.toExcelDate(this.asString(meta(d, 'effective_date'))),
      end_date: this.toExcelDate(this.asString(meta(d, 'end_date'))),
      contract_value: meta(d, 'contract_value') != null ? Number(meta(d, 'contract_value')) : null,
      currency: this.escapeCell(this.asString(meta(d, 'currency'))),
      subject: this.escapeCell(this.asString(meta(d, 'subject'))),
      term_description: this.escapeCell(this.asString(meta(d, 'term_description'))),
      status: this.escapeCell(this.translateStatus(d.status, t)),
    }));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Doclos';
    workbook.created = new Date();
    this.buildListSheet(workbook, t, t.strings.sheetContracts, t.strings.titleContracts, cols, rows, {
      moneyKeys: new Set(['contract_value']),
      dateKeys: new Set(['effective_date', 'end_date']),
      rightKeys: new Set(['contract_value']),
      centerKeys: new Set(['currency']),
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** PO / offer / delivery_note list export: carrier columns + type-specific metadata extras. */
  private async generateCommercialList(
    userId: string,
    query: ExportQueryDto,
    ids: string[] | undefined,
    lang: string | undefined,
    type: DocumentType,
  ): Promise<Buffer> {
    const t = getExportI18n(lang);
    const qb = this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.document', 'document')
      .where('document.user_id = :userId', { userId })
      .andWhere('document.type = :type', { type });
    if (ids && ids.length > 0) qb.andWhere('invoice.document_id IN (:...ids)', { ids });
    if (query.from_date) qb.andWhere('invoice.invoice_date >= :fromDate', { fromDate: query.from_date });
    if (query.to_date) qb.andWhere('invoice.invoice_date <= :toDate', { toDate: query.to_date });
    if (query.status) qb.andWhere('document.status = :status', { status: query.status });
    if (query.company) qb.andWhere('invoice.supplier_name ILIKE :company', { company: `%${query.company}%` });
    const invoices = await qb.orderBy('invoice.invoice_date', 'DESC').getMany();
    this.logger.log(`Exporting ${invoices.length} ${type}(s) for user ${userId} (lang=${resolveExportLocale(lang)})`);

    const itemsByInvoice = new Map<string, number>();
    if (invoices.length > 0) {
      const items = await this.invoiceItemsRepository.find({
        where: { invoice_id: In(invoices.map((i) => i.id)) },
      });
      for (const it of items) itemsByInvoice.set(it.invoice_id, (itemsByInvoice.get(it.invoice_id) ?? 0) + 1);
    }

    const isPO = type === DocumentType.PURCHASE_ORDER;
    const isOffer = type === DocumentType.OFFER;
    const numberLabel = isPO ? t.strings.orderNumber : isOffer ? t.strings.offerNumber : t.strings.deliveryNoteNumber;
    const dateLabel = isPO ? t.strings.orderDate : isOffer ? t.strings.offerDate : t.strings.deliveryDate;
    const sheetName = isPO ? t.strings.sheetPurchaseOrders : isOffer ? t.strings.sheetOffers : t.strings.sheetDeliveryNotes;
    const title = isPO ? t.strings.titlePurchaseOrders : isOffer ? t.strings.titleOffers : t.strings.titleDeliveryNotes;

    const cols: Array<{ header: string; key: string; width: number }> = [
      { header: numberLabel, key: 'number', width: 22 },
      { header: dateLabel, key: 'date', width: 14 },
      { header: t.strings.supplier, key: 'supplier_name', width: 30 },
      { header: t.strings.amountTotal, key: 'amount_total', width: 15 },
      { header: t.strings.currency, key: 'currency', width: 10 },
      { header: t.strings.items, key: 'items_count', width: 9 },
      ...(isPO
        ? [
            { header: t.strings.expectedDelivery, key: 'expected_delivery_date', width: 16 },
            { header: t.strings.paymentTerms, key: 'payment_terms', width: 26 },
          ]
        : []),
      ...(isOffer
        ? [
            { header: t.strings.validityDate, key: 'validity_date', width: 14 },
            { header: t.strings.validityTerms, key: 'validity_terms', width: 22 },
          ]
        : []),
      ...(type === DocumentType.DELIVERY_NOTE
        ? [
            { header: t.strings.recipient, key: 'recipient_name', width: 28 },
            { header: t.strings.orderReference, key: 'order_reference', width: 22 },
          ]
        : []),
      { header: t.strings.status, key: 'status', width: 16 },
    ];

    const meta = (inv: Invoice, k: string) =>
      (inv.document?.metadata as Record<string, unknown> | null | undefined)?.[k];
    const rows = invoices.map((inv) => {
      const base: Record<string, ExcelJS.CellValue> = {
        number: this.escapeCell(inv.invoice_number),
        date: this.toExcelDate(inv.invoice_date),
        supplier_name: this.escapeCell(inv.supplier_name),
        amount_total: inv.amount_total != null ? Number(inv.amount_total) : null,
        currency: this.escapeCell(inv.currency),
        items_count: itemsByInvoice.get(inv.id) ?? 0,
        status: this.escapeCell(this.translateStatus(inv.document?.status, t)),
      };
      if (isPO) {
        base['expected_delivery_date'] = this.toExcelDate(this.asString(meta(inv, 'expected_delivery_date')));
        base['payment_terms'] = this.escapeCell(this.asString(meta(inv, 'payment_terms')));
      } else if (isOffer) {
        base['validity_date'] = this.toExcelDate(this.asString(meta(inv, 'validity_date')));
        base['validity_terms'] = this.escapeCell(this.asString(meta(inv, 'validity_terms')));
      } else {
        base['recipient_name'] = this.escapeCell(this.asString(meta(inv, 'recipient_name')));
        base['order_reference'] = this.escapeCell(this.asString(meta(inv, 'order_reference')));
      }
      return base;
    });

    const moneyKeys = new Set(['amount_total']);
    const rightKeys = new Set(['amount_total', 'items_count']);
    const centerKeys = new Set(['currency']);
    const dateKeys = new Set(
      isPO ? ['date', 'expected_delivery_date'] : isOffer ? ['date', 'validity_date'] : ['date'],
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Doclos';
    workbook.created = new Date();
    this.buildListSheet(workbook, t, sheetName, title, cols, rows, { moneyKeys, dateKeys, rightKeys, centerKeys });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Shared flat-list sheet builder: title bar + header row + zebra data rows + frozen header + autofilter. */
  private buildListSheet(
    workbook: ExcelJS.Workbook,
    t: ExportI18n,
    sheetName: string,
    title: string,
    cols: Array<{ header: string; key: string; width: number }>,
    rows: Array<Record<string, ExcelJS.CellValue>>,
    opts: {
      moneyKeys?: Set<string>;
      dateKeys?: Set<string>;
      rightKeys?: Set<string>;
      centerKeys?: Set<string>;
    } = {},
  ): ExcelJS.Worksheet {
    const ws = workbook.addWorksheet(sheetName);
    ws.columns = cols;
    const colCount = cols.length;

    ws.mergeCells(1, 1, 1, colCount);
    this.styleTitle(ws.getCell(1, 1), title);
    ws.getRow(1).height = 26;
    cols.forEach((c, i) => {
      const cell = ws.getCell(2, i + 1);
      cell.value = c.header;
      this.styleHeader(cell);
    });
    ws.getRow(2).height = 20;

    const moneyKeys = opts.moneyKeys ?? new Set<string>();
    const dateKeys = opts.dateKeys ?? new Set<string>();
    const rightKeys = opts.rightKeys ?? new Set<string>();
    const centerKeys = opts.centerKeys ?? new Set<string>();
    rows.forEach((rowData, idx) => {
      const row = ws.addRow(rowData);
      const zebra = idx % 2 === 1;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const key = cols[colNumber - 1].key;
        this.styleData(cell, {
          zebra,
          money: moneyKeys.has(key),
          date: dateKeys.has(key),
          moneyFmt: t.numFmt.money,
          dateFmt: t.numFmt.date,
          align: rightKeys.has(key) ? 'right' : centerKeys.has(key) ? 'center' : 'left',
        });
      });
    });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: colCount } };
    return ws;
  }

  /** Coerce a metadata value to a string (or null) for export cells. */
  private asString(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : String(v);
  }

  /** Detail export — dispatches on document type to a per-type detail report. */
  async generateDetailExcel(
    userId: string,
    documentId: string,
    _format: ExportFormat,
    lang?: string,
  ): Promise<Buffer> {
    const t = getExportI18n(lang);
    const locale = resolveExportLocale(lang);

    const document = await this.documentsRepository.findOne({
      where: { id: documentId, user_id: userId },
      relations: ['invoice'],
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    const invoice = document.invoice ?? null;
    const items = invoice
      ? await this.invoiceItemsRepository.find({
          where: { invoice_id: invoice.id },
          order: { created_at: 'ASC' },
        })
      : [];

    switch (document.type) {
      case DocumentType.CONTRACT:
        return this.generateContractDetail(document, t, locale);
      case DocumentType.DELIVERY_NOTE:
        if (!invoice) throw new NotFoundException('No data available for this document');
        return this.generateCommercialReport(document, invoice, items, t, locale, {
          numberLabel: t.strings.deliveryNoteNumber,
          dateLabel: t.strings.deliveryDate,
          sheetName: t.strings.deliveryNote,
          bareWord: t.strings.deliveryNote,
          showPrices: false,
          extras: this.deliveryNoteExtras(document, locale),
        });
      case DocumentType.PURCHASE_ORDER:
        if (!invoice) throw new NotFoundException('No data available for this document');
        return this.generateCommercialReport(document, invoice, items, t, locale, {
          numberLabel: t.strings.orderNumber,
          dateLabel: t.strings.orderDate,
          sheetName: t.strings.order,
          bareWord: t.strings.order,
          showPrices: true,
          extras: this.purchaseOrderExtras(document, locale),
        });
      case DocumentType.OFFER:
        if (!invoice) throw new NotFoundException('No data available for this document');
        return this.generateCommercialReport(document, invoice, items, t, locale, {
          numberLabel: t.strings.offerNumber,
          dateLabel: t.strings.offerDate,
          sheetName: t.strings.offer,
          bareWord: t.strings.offer,
          showPrices: true,
          extras: this.offerExtras(document, locale),
        });
      case DocumentType.UNKNOWN:
        return this.generateUnknownDetail(document, t);
      case DocumentType.INVOICE:
      default:
        if (!invoice) throw new NotFoundException('No invoice data available for this document');
        return this.generateCommercialReport(document, invoice, items, t, locale, {
          numberLabel: t.strings.invoiceNumber,
          dateLabel: t.strings.invoiceDate,
          sheetName: t.strings.sheetInvoice,
          bareWord: t.strings.invoice,
          showPrices: true,
          extras: invoice.due_date
            ? ([[t.strings.dueDate, this.formatLocaleDate(invoice.due_date, locale)] as [string, ExcelJS.CellValue]])
            : [],
        });
    }
  }

  /** Per-type extras: PO expected-delivery + payment terms. */
  private purchaseOrderExtras(document: Document, locale: ExportLocale): Array<[string, ExcelJS.CellValue]> {
    const m = (k: string) => (document.metadata as Record<string, unknown> | null)?.[k];
    const out: Array<[string, ExcelJS.CellValue]> = [];
    const ed = this.asString(m('expected_delivery_date'));
    if (ed) out.push([this.exportI18nFor(locale).strings.expectedDelivery, this.formatLocaleDate(ed, locale)]);
    const pt = this.asString(m('payment_terms'));
    if (pt) out.push([this.exportI18nFor(locale).strings.paymentTerms, this.escapeCell(pt)]);
    return out;
  }

  /** Per-type extras: offer validity date + terms. */
  private offerExtras(document: Document, locale: ExportLocale): Array<[string, ExcelJS.CellValue]> {
    const m = (k: string) => (document.metadata as Record<string, unknown> | null)?.[k];
    const s = this.exportI18nFor(locale).strings;
    const out: Array<[string, ExcelJS.CellValue]> = [];
    const vd = this.asString(m('validity_date'));
    if (vd) out.push([s.validityDate, this.formatLocaleDate(vd, locale)]);
    const vt = this.asString(m('validity_terms'));
    if (vt) out.push([s.validityTerms, this.escapeCell(vt)]);
    return out;
  }

  /** Per-type extras: delivery-note recipient + order reference. */
  private deliveryNoteExtras(document: Document, locale: ExportLocale): Array<[string, ExcelJS.CellValue]> {
    const m = (k: string) => (document.metadata as Record<string, unknown> | null)?.[k];
    const s = this.exportI18nFor(locale).strings;
    const out: Array<[string, ExcelJS.CellValue]> = [];
    const r = this.asString(m('recipient_name'));
    if (r) out.push([s.recipient, this.escapeCell(r)]);
    const ra = this.asString(m('recipient_address'));
    if (ra) out.push([s.recipientAddress, this.escapeCell(ra)]);
    const oref = this.asString(m('order_reference'));
    if (oref) out.push([s.orderReference, this.escapeCell(oref)]);
    return out;
  }

  /** Resolve the i18n bundle from a locale (extras helpers build labels in the doc's locale). */
  private exportI18nFor(locale: ExportLocale): ExportI18n {
    return getExportI18n(locale === 'en' ? 'en' : 'de');
  }

  /** Generic commercial detail report (invoice / PO / offer / delivery_note). */
  private async generateCommercialReport(
    document: Document,
    invoice: Invoice,
    items: InvoiceItem[],
    t: ExportI18n,
    locale: ExportLocale,
    opts: {
      numberLabel: string;
      dateLabel: string;
      sheetName: string;
      bareWord: string;
      showPrices: boolean;
      extras: Array<[string, ExcelJS.CellValue]>;
    },
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Doclos';
    workbook.created = new Date();

    const ws = workbook.addWorksheet(opts.sheetName);
    ws.columns = [{ width: 28 }, { width: 26 }, { width: 16 }, { width: 16 }, { width: 12 }];

    const cur = invoice.currency || '';
    const e = (v: ExcelJS.CellValue) => this.escapeCell(v);

    // Title bar
    ws.mergeCells('A1:E1');
    this.styleTitle(
      ws.getCell('A1'),
      invoice.invoice_number ? `${opts.bareWord} ${e(invoice.invoice_number)}` : opts.bareWord,
      16,
    );
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
    meta(3, opts.numberLabel, e(invoice.invoice_number) || '-', t.strings.status, e(this.translateStatus(document.status, t)) || '-');
    meta(4, opts.dateLabel, invoice.invoice_date ? this.formatLocaleDate(invoice.invoice_date, locale) : '-', t.strings.currency, e(cur) || '-');
    meta(5, t.strings.supplier, e(invoice.supplier_name) || '-');
    ws.mergeCells('A6:E6');
    const addr = ws.getCell('A6');
    addr.value = e(invoice.supplier_address || '');
    this.styleValue(addr, addr.value);

    // Per-type extras rows (each: label A, value B:E merged).
    let nextRow = 7;
    for (const [label, value] of opts.extras) {
      this.styleLabel(ws.getCell(`A${nextRow}`), label);
      ws.mergeCells(`B${nextRow}:E${nextRow}`);
      this.styleValue(ws.getCell(`B${nextRow}`), value);
      nextRow++;
    }

    // Items header
    const headerRow = nextRow + 1;
    const itemHeaders = opts.showPrices
      ? [t.strings.description, t.strings.quantity, t.strings.unitPrice, t.strings.lineTotal]
      : [t.strings.description, t.strings.quantity];
    itemHeaders.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
      this.styleHeader(cell);
    });
    ws.getRow(headerRow).height = 20;

    // Items rows
    let row = headerRow + 1;
    let itemsTotal = 0;
    items.forEach((item, idx) => {
      ws.getCell(`A${row}`).value = e(item.description || '');
      ws.getCell(`B${row}`).value = item.quantity != null ? Number(item.quantity) : '';
      if (opts.showPrices) {
        ws.getCell(`C${row}`).value = item.unit_price != null ? Number(item.unit_price) : '';
        ws.getCell(`D${row}`).value = item.line_total != null ? Number(item.line_total) : '';
      }
      const zebra = idx % 2 === 1;
      this.styleData(ws.getCell(`A${row}`), { zebra });
      this.styleData(ws.getCell(`B${row}`), { zebra, align: 'right' });
      if (opts.showPrices) {
        this.styleData(ws.getCell(`C${row}`), { zebra, money: true, moneyFmt: t.numFmt.money, align: 'right' });
        this.styleData(ws.getCell(`D${row}`), { zebra, money: true, moneyFmt: t.numFmt.money, align: 'right' });
      }
      if (item.line_total != null) itemsTotal += Number(item.line_total);
      row++;
    });
    if (items.length === 0) {
      ws.mergeCells(`A${row}:${opts.showPrices ? 'D' : 'B'}${row}`);
      ws.getCell(`A${row}`).value = t.strings.noLineItems;
      this.styleValue(ws.getCell(`A${row}`), ws.getCell(`A${row}`).value);
      row++;
    }

    // Totals (price-bearing types only — beige accent, bold)
    if (opts.showPrices) {
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
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Contract detail report — metadata only (no carrier/items/totals). */
  private async generateContractDetail(
    document: Document,
    t: ExportI18n,
    locale: ExportLocale,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Doclos';
    workbook.created = new Date();

    const ws = workbook.addWorksheet(t.strings.contract);
    ws.columns = [{ width: 28 }, { width: 60 }];

    const meta = (document.metadata as Record<string, unknown> | null) ?? {};
    const e = (v: ExcelJS.CellValue) => this.escapeCell(v);
    const title = meta.subject ? `${t.strings.contract} ${e(this.asString(meta.subject))}` : t.strings.contract;

    ws.mergeCells('A1:B1');
    this.styleTitle(ws.getCell('A1'), title, 16);
    ws.getRow(1).height = 32;

    const rows: Array<{ label: string; value: ExcelJS.CellValue; money?: boolean }> = [
      { label: t.strings.seller, value: e(this.asString(meta.seller_name)) || '-' },
      { label: t.strings.buyer, value: e(this.asString(meta.buyer_name)) || '-' },
      { label: t.strings.effectiveDate, value: this.formatLocaleDate(this.asString(meta.effective_date), locale) },
      { label: t.strings.endDate, value: this.formatLocaleDate(this.asString(meta.end_date), locale) },
      {
        label: t.strings.contractValue,
        value: meta.contract_value != null ? Number(meta.contract_value) : '-',
        money: true,
      },
      { label: t.strings.currency, value: e(this.asString(meta.currency)) || '-' },
      { label: t.strings.contractSubject, value: e(this.asString(meta.subject)) || '-' },
      { label: t.strings.contractTerm, value: e(this.asString(meta.term_description)) || '-' },
      { label: t.strings.status, value: e(this.translateStatus(document.status, t)) || '-' },
    ];
    rows.forEach((r, i) => {
      const row = 3 + i;
      this.styleLabel(ws.getCell(`A${row}`), r.label);
      const v = ws.getCell(`B${row}`);
      this.styleValue(v, r.value);
      if (r.money) v.numFmt = t.numFmt.money;
    });

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Unknown-document detail report — minimal (no structured data was extracted). */
  private async generateUnknownDetail(document: Document, t: ExportI18n): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Doclos';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Document');
    ws.columns = [{ width: 28 }, { width: 60 }];
    ws.mergeCells('A1:B1');
    this.styleTitle(ws.getCell('A1'), this.escapeCell(document.original_filename) || 'Document', 16);
    ws.getRow(1).height = 32;
    this.styleLabel(ws.getCell('A3'), t.strings.status);
    this.styleValue(ws.getCell('B3'), this.escapeCell(this.translateStatus(document.status, t)) || '-');
    ws.mergeCells('A4:B4');
    this.styleValue(ws.getCell('A4'), t.strings.noStructuredData);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // --- i18n / formatting helpers ---

  private translateStatus(status: string | null | undefined, t: ExportI18n): string {
    if (!status) return '';
    return t.status[status as DocumentStatus] ?? status;
  }

  /**
   * Formula-injection guard for exported cells: Excel/CSV treat a cell whose
   * content starts with = + - @ as a formula. Strip a leading run of those
   * (plus whitespace) from string values; leave numbers/nulls untouched.
   */
  private escapeCell(v: ExcelJS.CellValue): ExcelJS.CellValue {
    if (typeof v === 'string') return v.replace(/^[=+\-@\s]+/, '');
    return v;
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
