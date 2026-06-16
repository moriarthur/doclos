import { Injectable, Logger } from '@nestjs/common';
import { AiService } from './ai.service';
import { DOCUMENT_CLASSIFICATION_SYSTEM, DOCUMENT_CLASSIFICATION_PROMPT } from '../prompts/classification.prompts';
import { DocumentType } from '../../documents/entities/document.entity';

// Part 3: AI Pipeline - Document classification service
// Determines document type using LLM

export interface ClassificationResult {
  type: DocumentType;
  confidence: number;
  reasoning: string;
}

@Injectable()
export class DocumentClassifierService {
  private readonly logger = new Logger(DocumentClassifierService.name);

  constructor(private aiService: AiService) {}

  /**
   * Classify a document based on its text content
   * @param text - OCR-extracted text from the document
   * @returns Classification result with type and confidence
   */
  async classifyDocument(text: string): Promise<ClassificationResult> {
    if (!this.aiService.isAvailable()) {
      this.logger.warn('AI service not available - using rule-based classification');
      return this.ruleBasedClassification(text);
    }

    try {
      this.logger.log('Classifying document with LLM');

      const prompt = DOCUMENT_CLASSIFICATION_PROMPT(text);
      const { data, usage } = await this.aiService.sendJsonMessage<ClassificationResult>(
        prompt,
        DOCUMENT_CLASSIFICATION_SYSTEM,
      );

      const cost = this.aiService.estimateCost(usage.inputTokens, usage.outputTokens);
      this.logger.log(
        `Document classified as ${data.type} with confidence ${data.confidence} (cost: $${cost.toFixed(4)})`,
      );

      return data;
    } catch (error) {
      this.logger.error(`LLM classification failed: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.warn('Falling back to rule-based classification');
      return this.ruleBasedClassification(text);
    }
  }

  /**
   * Rule-based document classification (fallback)
   * Uses keyword matching when LLM is unavailable
   * @param text - OCR-extracted text
   * @returns Classification result
   */
  private ruleBasedClassification(text: string): ClassificationResult {
    const lowerText = text.toLowerCase();

    // Check for invoice indicators
    if (
      lowerText.includes('rechnung') ||
      lowerText.includes('invoice') ||
      (lowerText.includes('re-nr') && lowerText.includes('eur'))
    ) {
      return {
        type: DocumentType.INVOICE,
        confidence: 0.7,
        reasoning: 'Detected invoice keywords (Rechnung, invoice)',
      };
    }

    // Check for purchase order indicators
    if (
      lowerText.includes('purchase order') ||
      lowerText.includes('bestellung') ||
      lowerText.includes('bestellnummer') ||
      lowerText.includes('order confirmation') ||
      (lowerText.includes('auftrag') &&
        (lowerText.includes('lieferung') ||
          lowerText.includes('menge') ||
          lowerText.includes('preis')))
    ) {
      return {
        type: DocumentType.PURCHASE_ORDER,
        confidence: 0.7,
        reasoning: 'Detected purchase order keywords (Purchase Order, Bestellung)',
      };
    }

    // Check for contract indicators
    if (
      lowerText.includes('vertrag') ||
      (lowerText.includes('contract') && lowerText.includes('agreement'))
    ) {
      return {
        type: DocumentType.CONTRACT,
        confidence: 0.7,
        reasoning: 'Detected contract keywords (Vertrag, contract)',
      };
    }

    // Check for offer indicators
    if (
      lowerText.includes('angebot') ||
      (lowerText.includes('quote') || lowerText.includes('offer')) &&
      lowerText.includes('price')
    ) {
      return {
        type: DocumentType.OFFER,
        confidence: 0.7,
        reasoning: 'Detected offer keywords (Angebot, quote)',
      };
    }

    // Check for delivery note indicators
    if (
      lowerText.includes('lieferschein') ||
      lowerText.includes('delivery note') ||
      lowerText.includes('warenausgang')
    ) {
      return {
        type: DocumentType.DELIVERY_NOTE,
        confidence: 0.7,
        reasoning: 'Detected delivery note keywords',
      };
    }

    // Default to unknown
    return {
      type: DocumentType.UNKNOWN,
      confidence: 0.3,
      reasoning: 'Could not determine document type from keywords',
    };
  }
}
