// Synthetic demo invoice as a handcrafted, uncompressed single-page PDF.
//
// Why handcrafted: the demo seed must stay dependency-free (no PDF library,
// no binary fixture in git) and byte-stable across runs. The document text
// is embedded (text-based PDF), so the pipeline classifies/extracts it via
// the fast pdf-parse path — no OCR involved.
//
// Content policy: strictly fictional data ("Beispielbau GmbH", "Musterkunde
// AG", the Bundesbank sample IBAN) — no real persons, addresses or account
// data (no PII). Amounts are internally consistent so the demo shows a
// clean validation result.

interface InvoiceLine {
  text: string;
  bold?: boolean;
  size: number;
  /** Distance from this line's baseline to the NEXT line's baseline. */
  leading: number;
}

const LINES: InvoiceLine[] = [
  { text: 'Beispielbau GmbH', bold: true, size: 16, leading: 22 },
  { text: 'Musterstraße 12', size: 10, leading: 14 },
  { text: '80331 München', size: 10, leading: 14 },
  { text: 'Deutschland', size: 10, leading: 14 },
  { text: 'USt-IdNr.: DE123456789', size: 10, leading: 20 },
  { text: 'RECHNUNG', bold: true, size: 14, leading: 24 },
  { text: 'Rechnungsnummer: RE-2026-0001', size: 10, leading: 14 },
  { text: 'Rechnungsdatum: 15.01.2026', size: 10, leading: 14 },
  { text: 'Fällig am: 29.01.2026', size: 10, leading: 20 },
  { text: 'Rechnungssteller:', bold: true, size: 10, leading: 14 },
  { text: 'Beispielbau GmbH', size: 10, leading: 14 },
  { text: 'Musterstraße 12, 80331 München', size: 10, leading: 20 },
  { text: 'Kunde:', bold: true, size: 10, leading: 14 },
  { text: 'Musterkunde AG', size: 10, leading: 14 },
  { text: 'Testallee 5', size: 10, leading: 14 },
  { text: '10115 Berlin', size: 10, leading: 14 },
  { text: 'Deutschland', size: 10, leading: 20 },
  { text: 'Leistungen:', bold: true, size: 10, leading: 14 },
  {
    text: 'Position 1: Beratung Software-Integration: 8,00 Std. x 120,00 EUR = 960,00 EUR',
    size: 10,
    leading: 14,
  },
  {
    text: 'Position 2: Entwicklung Rechnungsexport: 12,00 Std. x 105,00 EUR = 1.260,00 EUR',
    size: 10,
    leading: 14,
  },
  {
    text: 'Position 3: Projektleitung Januar 2026: 4,00 Std. x 110,00 EUR = 440,00 EUR',
    size: 10,
    leading: 20,
  },
  { text: 'Zwischensumme (netto): 2.660,00 EUR', size: 10, leading: 14 },
  { text: 'Umsatzsteuer 19%: 505,40 EUR', size: 10, leading: 14 },
  { text: 'Gesamtbetrag (brutto): 3.165,40 EUR', bold: true, size: 10, leading: 20 },
  {
    text: 'Zahlungsbedingungen: Zahlbar innerhalb von 14 Tagen ohne Abzug:',
    size: 10,
    leading: 14,
  },
  { text: 'Kontoinhaber: Beispielbau GmbH', size: 10, leading: 14 },
  { text: 'IBAN: DE02120300000000202051 (Beispiel-IBAN der Deutschen Bundesbank, fiktiv)', size: 10, leading: 14 },
  { text: 'Verwendungszweck: RE-2026-0001', size: 10, leading: 20 },
  {
    text: 'Hinweis: Diese Rechnung wurde synthetisch zu Demo- und Testzwecken erzeugt.',
    size: 8,
    leading: 11,
  },
  { text: 'Sämtliche Daten sind frei erfunden und enthalten keine personenbezogenen Daten.', size: 8, leading: 11 },
];

/** Escape PDF string syntax and force WinAnsi/latin1-safe characters. */
function pdfEscape(text: string): string {
  const safe = text
    .replace(/€/g, 'EUR')
    .replace(/[–—]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    // eslint-disable-next-line no-control-regex -- the rule's target IS non-latin1 removal
    .replace(/[^\x00-\xFF]/g, '?');
  return safe.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildContentStream(): Buffer {
  const parts: string[] = ['BT', '72 790 Td'];
  LINES.forEach((line, i) => {
    const font = line.bold ? 'F2' : 'F1';
    parts.push(`/${font} ${line.size} Tf ${line.leading} TL`);
    parts.push(`(${pdfEscape(line.text)}) Tj`);
    // T* moves down by the leading set above; skip after the final line.
    if (i < LINES.length - 1) parts.push('T*');
  });
  parts.push('ET');
  return Buffer.from(parts.join('\n') + '\n', 'latin1');
}

/**
 * Build a minimal but spec-valid PDF (catalog → pages → page → content →
 * two WinAnsi fonts) with a correct xref table.
 */
export function buildSampleInvoicePdf(): Buffer {
  const content = buildContentStream();

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (buf: Buffer) => {
    chunks.push(buf);
    position += buf.length;
  };

  push(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'));

  objects.forEach((body, i) => {
    offsets.push(position);
    push(Buffer.from(`${i + 1} 0 obj\n${body}`, 'latin1'));
    if (i === 3) push(content); // stream object: content between header and endstream
    push(Buffer.from(i === 3 ? '\nendstream\nendobj\n' : '\nendobj\n', 'latin1'));
  });

  const xrefOffset = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  push(
    Buffer.from(
      xref +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'latin1',
    ),
  );

  return Buffer.concat(chunks);
}
