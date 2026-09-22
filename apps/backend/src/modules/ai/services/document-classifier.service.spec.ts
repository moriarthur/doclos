import { DocumentClassifierService, ClassificationResult } from './document-classifier.service';
import { DocumentType } from '../../documents/entities/document.entity';

// H-4 (audit wave 3): keyword classification answers first; the LLM is only
// consulted for text the rules find ambiguous (and is never paid for documents
// the keywords already settle).

const aiAvailable = () => true;

function makeService(ai: {
  isAvailable?: () => boolean;
  sendJsonMessage?: jest.Mock;
  estimateCost?: () => number;
  classifyTimeoutMs?: number;
}) {
  return new DocumentClassifierService({
    isAvailable: ai.isAvailable ?? aiAvailable,
    sendJsonMessage: ai.sendJsonMessage ?? jest.fn(),
    estimateCost: ai.estimateCost ?? (() => 0),
    classifyTimeoutMs: ai.classifyTimeoutMs ?? 30_000,
  } as never);
}

const llmResult = (type: DocumentType): { data: ClassificationResult; usage: never } =>
  ({
    data: { type, confidence: 0.9, reasoning: 'llm' },
    usage: { inputTokens: 1, outputTokens: 1 } as never,
  }) as never;

describe('DocumentClassifierService — rule-based first (H-4)', () => {
  it('classifies a German invoice by keywords without an LLM call', async () => {
    const sendJsonMessage = jest.fn();
    const service = makeService({ sendJsonMessage });

    const result = await service.classifyDocument('Rechnung Nr. 2026-041 Gesamtbetrag 149,00 EUR');

    expect(result.type).toBe(DocumentType.INVOICE);
    expect(sendJsonMessage).not.toHaveBeenCalled();
  });

  it('classifies an English invoice by keywords without an LLM call', async () => {
    const sendJsonMessage = jest.fn();
    const service = makeService({ sendJsonMessage });

    const result = await service.classifyDocument('INVOICE #36651\nBalance Due: $1,353.08');

    expect(result.type).toBe(DocumentType.INVOICE);
    expect(sendJsonMessage).not.toHaveBeenCalled();
  });

  it('classifies purchase order, contract, offer and delivery note by keywords', async () => {
    const sendJsonMessage = jest.fn();
    const service = makeService({ sendJsonMessage });
    const cases: Array<[string, DocumentType]> = [
      ['Purchase Order PO-4711 Menge 3 Preis 99,00', DocumentType.PURCHASE_ORDER],
      ['Vertrag zwischen Muster GmbH und Kunde AG', DocumentType.CONTRACT],
      ['Angebot mit Price Übersicht, gültig 14 Tage', DocumentType.OFFER],
      ['Lieferschein 0815, Ausgang 12.05.2012', DocumentType.DELIVERY_NOTE],
    ];
    for (const [text, expected] of cases) {
      expect((await service.classifyDocument(text)).type).toBe(expected);
    }
    expect(sendJsonMessage).not.toHaveBeenCalled();
  });

  it('falls back to the LLM for ambiguous text and returns its verdict', async () => {
    const sendJsonMessage = jest.fn().mockResolvedValue(llmResult(DocumentType.CONTRACT));
    const service = makeService({ sendJsonMessage });

    const result = await service.classifyDocument('unschiedbare between parties terms text');

    expect(result.type).toBe(DocumentType.CONTRACT);
    expect(result.reasoning).toBe('llm');
    expect(sendJsonMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to rule-based UNKNOWN when the LLM call fails', async () => {
    const sendJsonMessage = jest.fn().mockRejectedValue(new Error('GLM down'));
    const service = makeService({ sendJsonMessage });

    const result = await service.classifyDocument('no recognizable keywords here');

    expect(result.type).toBe(DocumentType.UNKNOWN);
    expect(sendJsonMessage).toHaveBeenCalledTimes(1);
  });

  it('returns rule-based UNKNOWN without an LLM call when AI is unavailable', async () => {
    const sendJsonMessage = jest.fn();
    const service = makeService({ isAvailable: () => false, sendJsonMessage });

    const result = await service.classifyDocument('no recognizable keywords here');

    expect(result.type).toBe(DocumentType.UNKNOWN);
    expect(sendJsonMessage).not.toHaveBeenCalled();
  });
});
