import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { Document } from '../documents/entities/document.entity';
import { SearchQueryDto } from './search.dto';

// Full-text search across documents + related invoice/customer fields.
//
// PostgreSQL FTS (plainto_tsquery, 'simple' config) over a concatenated tsvector
// of all searchable text fields, ranked by ts_rank, plus an ILIKE fallback on
// identifier fields — invoice numbers / filenames contain punctuation (e.g.
// "RE-2024-001") that FTS tokenizes unpredictably, so a substring match rescues
// those lookups. 'simple' config avoids German-dictionary stemming quirks and is
// robust for umlauts and numbers.
//
// No GIN index for v1 (the tsvector is computed per query) — fine at MVP volume
// (50–500 docs/month). At scale, add a generated tsvector column + GIN index.
@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Document)
    private documentsRepository: Repository<Document>,
  ) {}

  // Null-safe concatenation of every searchable text field. Reused for both the
  // `@@` match predicate and the ts_rank ordering select.
  private static readonly FTS_VECTOR = [
    "coalesce(document.original_filename,'')",
    "coalesce(customer.name,'')",
    "coalesce(customer.address,'')",
    "coalesce(customer.city,'')",
    "coalesce(invoice.invoice_number,'')",
    "coalesce(invoice.supplier_name,'')",
    "coalesce(invoice.supplier_address,'')",
  ].join(" || ' ' || ");

  async searchDocuments(userId: string, query: SearchQueryDto) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const skip = (page - 1) * limit;
    const q = query.q.trim();

    const qb = this.documentsRepository
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.customer', 'customer')
      .leftJoinAndSelect('document.invoice', 'invoice')
      .where('document.user_id = :userId', { userId });

    if (q) {
      const like = `%${q}%`;
      qb.andWhere(
        new Brackets((sub) => {
          // Full-text match across the denormalized field vector.
          sub.where(
            `to_tsvector('simple', ${SearchService.FTS_VECTOR}) @@ plainto_tsquery('simple', :q)`,
            { q },
          );
          // Substring fallback for identifiers FTS may mis-tokenize.
          sub.orWhere('invoice.invoice_number ILIKE :like', { like });
          sub.orWhere('document.original_filename ILIKE :like', { like });
          sub.orWhere('customer.name ILIKE :like', { like });
        }),
      );
      // Rank by relevance; most-relevant first.
      qb.addSelect(
        `ts_rank(to_tsvector('simple', ${SearchService.FTS_VECTOR}), plainto_tsquery('simple', :q))`,
        'search_rank',
      ).orderBy('search_rank', 'DESC');
    } else {
      // Defensive: DTO enforces MinLength(1), but a whitespace-only q trims to ''.
      qb.orderBy('document.created_at', 'DESC');
    }

    if (query.status) {
      qb.andWhere('document.status = :status', { status: query.status });
    }
    if (query.type) {
      qb.andWhere('document.type = :type', { type: query.type });
    }
    if (query.from_date) {
      qb.andWhere('document.created_at >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      qb.andWhere('document.created_at <= :toDate', { toDate: query.to_date });
    }

    const [documents, total] = await qb.skip(skip).take(limit).getManyAndCount();

    // Same response shape as DocumentsService.listDocuments — the frontend
    // renders identical document cards for search and list results.
    return {
      data: documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        company_name: doc.invoice?.supplier_name || doc.customer?.name,
        invoice_number: doc.invoice?.invoice_number,
        amount: doc.invoice?.amount_total,
        currency: doc.invoice?.currency,
        invoice_date: doc.invoice?.invoice_date,
        created_at: doc.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
      },
    };
  }
}
