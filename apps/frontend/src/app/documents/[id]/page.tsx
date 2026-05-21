'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsApi, jobsApi, authApi } from '@/lib/api-client';
import { Navigation } from '@/components/Navigation';
import { DocumentViewer } from '@/components/DocumentViewer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { CancelableLoader } from '@/components/ui/CancelableLoader';
import { formatDate, formatAmount, getStatusLabel } from '@/lib/utils';
import {
  ArrowLeft,
  FileText,
  Calendar,

  RefreshCw,
  Building2,
  Settings,
  Package,
  Pencil,
  X,
  Save,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/AlertDialog';

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const docId = params.id as string;
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [deleteDialog, setDeleteDialog] = useState(false);

  const { data: document, isLoading, error, refetch } = useQuery({
    queryKey: ['document', docId],
    queryFn: () => documentsApi.getDetail(docId),
    enabled: !!docId,
    refetchInterval: (query) => {
      // TanStack Query v5: callback receives Query object, not data
      return query.state.data?.status === 'processing' ? 2000 : false;
    },
  });

  const { data: jobProgress } = useQuery({
    queryKey: ['job', docId],
    queryFn: () => jobsApi.getDocumentJob(docId),
    enabled: !!docId && (document?.status === 'processing' || document?.status === 'error'),
    refetchInterval: document?.status === 'processing' ? 1000 : false,
  });

  const cancelByDocumentMutation = useMutation({
    mutationFn: () => jobsApi.cancelByDocument(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', docId] });
      queryClient.invalidateQueries({ queryKey: ['job', docId] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const handleCancelProcessing = () => {
    cancelByDocumentMutation.mutate();
  };

  const validateMutation = useMutation({
    mutationFn: (fields: Record<string, string>) =>
      documentsApi.validate(docId, fields),
    onSuccess: () => {
      setEditedFields({});
      setEditingSection(null);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      refetch();
    },
    onError: (err) => {
      console.error('Validation failed:', authApi.getErrorMessage(err));
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: () => documentsApi.reprocess(docId),
    onSuccess: () => {
      // Refetch to get latest status immediately
      refetch();
    },
    onError: (err) => {
      console.error('Reprocess failed:', authApi.getErrorMessage(err));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => documentsApi.updateStatus(docId, 'archived'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', docId] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      router.push('/archive');
    },
    onError: (err) => {
      console.error('Archive failed:', authApi.getErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => documentsApi.delete(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      router.push('/');
    },
    onError: (err) => {
      console.error('Delete failed:', authApi.getErrorMessage(err));
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: () => documentsApi.unarchive(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', docId] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => {
      console.error('Unarchive failed:', authApi.getErrorMessage(err));
    },
  });

  const handleFieldChange = (field: string, value: string) => {
    setEditedFields((prev) => ({ ...prev, [field]: value }));
  };

  const getFieldValue = (field: string, originalValue: string | number | { value?: string | number } | undefined | null) => {
    const baseValue = typeof originalValue === 'object' && originalValue?.value
      ? String(originalValue.value)
      : originalValue != null ? String(originalValue) : '';
    return editedFields[field] ?? baseValue;
  };

  const startEditing = (section: string) => {
    setEditingSection(section);
  };

  const cancelEditing = () => {
    setEditingSection(null);
    setEditedFields({});
  };

  const saveSection = () => {
    if (hasErrors()) return;
    if (Object.keys(editedFields).length > 0) {
      validateMutation.mutate(editedFields);
    } else {
      setEditingSection(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex">
        <Navigation />
        <main className="flex-1 md:ml-64 min-h-screen flex items-center justify-center">
          <CancelableLoader size="md" />
        </main>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="flex">
        <Navigation />
        <main className="flex-1 md:ml-64 min-h-screen p-10">
          <Card>
            <CardContent className="p-16 text-center">
              <FileText className="h-16 w-16 mx-auto mb-6 text-muted-foreground" />
              <p className="text-muted-foreground mb-6">
                Dokument nicht gefunden oder Fehler beim Laden
              </p>
              <Link href="/">
                <Button variant="secondary">Zurück zur Übersicht</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const invoiceData = document.invoice;

  // Validation
  const getFieldError = (field: string): string | null => {
    if (editingSection !== 'invoice' && editingSection !== 'supplier') return null;
    const value = editedFields[field];
    if (value === undefined) return null; // unchanged field

    switch (field) {
      case 'invoice_number': {
        if (!value.trim()) return 'Rechnungsnummer darf nicht leer sein';
        break;
      }
      case 'amount_total': {
        if (!value.trim()) return 'Betrag darf nicht leer sein';
        const num = Number(value);
        if (isNaN(num) || num === 0) return 'Muss eine Zahl ungleich 0 sein';
        break;
      }
      case 'invoice_date':
      case 'due_date': {
        if (!value.trim()) return 'Datum erforderlich (JJJJ-MM-TT)';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Format: JJJJ-MM-TT';
        const [y, m, d] = value.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
          return 'Ungültiges Datum';
        }
        if (field === 'due_date') {
          const invDate = editedFields.invoice_date ?? getFieldValue('invoice_date', invoiceData?.invoice_date);
          if (invDate && value < invDate) return 'Darf nicht vor Rechnungsdatum liegen';
        }
        break;
      }
      case 'supplier_name': {
        if (!value.trim()) return 'Firmenname darf nicht leer sein';
        break;
      }
    }
    return null;
  };

  const hasErrors = (): boolean => {
    return Object.keys(editedFields).some((field) => getFieldError(field) !== null);
  };

  return (
    <div className="flex">
      <Navigation />

      {/* Main Content */}
      <main className="flex-1 md:ml-64 min-h-screen">
        {/* Mobile header spacer */}
        <div className="h-16 md:hidden" />

        <div className="p-6 md:p-10">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8 animate-fade-in">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Zurück
              </Button>
            </Link>

            <div className="flex-1">
              <p className="text-sm text-muted-foreground uppercase tracking-wide mb-2">
                Dokument Details
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-serif text-3xl font-bold text-brand">
                  {getFieldValue('supplier_name', invoiceData?.supplier_name) || 'Dokument'}
                </h1>
                <Badge variant={document.status as any} className="shrink-0">
                  {getStatusLabel(document.status)}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => reprocessMutation.mutate()}
                disabled={reprocessMutation.isPending}
                title="Neu verarbeiten"
              >
                <RefreshCw className={`h-4 w-4 ${reprocessMutation.isPending ? 'animate-spin' : ''} transition-opacity`} />
              </Button>
              {document.status !== 'archived' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => archiveMutation.mutate()}
                  disabled={archiveMutation.isPending}
                  title="Archivieren"
                >
                  <Archive className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => unarchiveMutation.mutate()}
                  disabled={unarchiveMutation.isPending}
                  title="Wiederherstellen"
                >
                  <ArchiveRestore className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteDialog(true)}
                disabled={deleteMutation.isPending}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                title="Löschen"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Error Alert */}
          {document.status === 'error' && !reprocessMutation.isPending && !reprocessMutation.isSuccess && (
            <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10 animate-slide-up mb-6">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-red-900 dark:text-red-100 mb-2">
                      Verarbeitung fehlgeschlagen
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                      Das Dokument konnte nicht automatisch verarbeitet werden. Dies kann an falschem
                      Dateiformat oder schlechter Bildqualität liegen.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => reprocessMutation.mutate()}
                      isLoading={reprocessMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Neu verarbeiten
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* PDF Viewer */}
            <Card className="animate-scale-in">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-primary" />
                  Dokument
                </CardTitle>
              </CardHeader>
              <CardContent>
                {document.file_url ? (
                  <DocumentViewer
                    url={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/documents/${docId}/file`}
                    mimeType={document.mime_type || 'application/pdf'}
                    error={document.status === 'error'}
                    reprocessing={document.status === 'processing' || reprocessMutation.isPending}
                    isReprocess={reprocessMutation.isPending || reprocessMutation.isSuccess}
                    onCancelReprocess={document.status === 'processing' || reprocessMutation.isPending ? handleCancelProcessing : undefined}
                  />
                ) : (
                  <div className="aspect-[3/4] bg-muted rounded-xl flex items-center justify-center">
                    <CancelableLoader size="md" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Extracted Data */}
            <div className="space-y-6" style={{ animationDelay: '100ms' }}>
              {/* Invoice Details */}
              <Card className="animate-slide-up">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Settings className="h-5 w-5 text-primary" />
                      Rechnungsdetails
                    </CardTitle>
                    {['needs_validation', 'parsed', 'validated'].includes(document.status) && (
                      editingSection === 'invoice' ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEditing}
                            disabled={validateMutation.isPending}
                            title="Abbrechen"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={saveSection}
                            disabled={validateMutation.isPending || hasErrors()}
                            title="Speichern"
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditing('invoice')}
                          title="Bearbeiten"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Invoice Number */}
                    <div className="py-3 border-b border-border gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground shrink-0">Rechnungsnummer</span>
                        {editingSection === 'invoice' ? (
                          <Input
                            value={getFieldValue('invoice_number', invoiceData?.invoice_number)}
                            onChange={(e) => handleFieldChange('invoice_number', e.target.value)}
                            className={`max-w-[200px] h-8 text-sm ${getFieldError('invoice_number') ? 'border-red-400 focus:ring-red-200' : ''}`}
                            placeholder="Rechnungsnummer"
                          />
                        ) : (
                          <span className="font-medium text-foreground truncate">
                            {getFieldValue('invoice_number', invoiceData?.invoice_number) || '-'}
                          </span>
                        )}
                      </div>
                      {getFieldError('invoice_number') && (
                        <p className="text-xs text-red-500 mt-1 text-right">{getFieldError('invoice_number')}</p>
                      )}
                    </div>

                    {/* Invoice Date */}
                    <div className="py-3 border-b border-border gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground flex items-center gap-2 shrink-0">
                          <Calendar className="h-4 w-4" />
                          Rechnungsdatum
                        </span>
                        {editingSection === 'invoice' ? (
                          <Input
                            type="text"
                            value={getFieldValue('invoice_date', invoiceData?.invoice_date)}
                            onChange={(e) => handleFieldChange('invoice_date', e.target.value)}
                            className={`max-w-[160px] h-8 text-sm ${getFieldError('invoice_date') ? 'border-red-400 focus:ring-red-200' : ''}`}
                            placeholder="JJJJ-MM-TT"
                          />
                        ) : (
                          <span className="font-medium text-foreground">
                            {getFieldValue('invoice_date', invoiceData?.invoice_date) ? formatDate(getFieldValue('invoice_date', invoiceData?.invoice_date)) : '-'}
                          </span>
                        )}
                      </div>
                      {getFieldError('invoice_date') && (
                        <p className="text-xs text-red-500 mt-1 text-right">{getFieldError('invoice_date')}</p>
                      )}
                    </div>

                    {/* Due Date */}
                    <div className="py-3 border-b border-border gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground flex items-center gap-2 shrink-0">
                          <Calendar className="h-4 w-4" />
                          Fälligkeitsdatum
                        </span>
                        {editingSection === 'invoice' ? (
                          <Input
                            type="text"
                            value={getFieldValue('due_date', invoiceData?.due_date)}
                            onChange={(e) => handleFieldChange('due_date', e.target.value)}
                            className={`max-w-[160px] h-8 text-sm ${getFieldError('due_date') ? 'border-red-400 focus:ring-red-200' : ''}`}
                            placeholder="JJJJ-MM-TT"
                          />
                        ) : (
                          <span className="font-medium text-foreground">
                            {getFieldValue('due_date', invoiceData?.due_date) ? formatDate(getFieldValue('due_date', invoiceData?.due_date)) : '-'}
                          </span>
                        )}
                      </div>
                      {getFieldError('due_date') && (
                        <p className="text-xs text-red-500 mt-1 text-right">{getFieldError('due_date')}</p>
                      )}
                    </div>

                    {/* Amount */}
                    <div className="py-3 gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground shrink-0">
                          Betrag
                        </span>
                        {editingSection === 'invoice' ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={getFieldValue('amount_total', invoiceData?.amount_total)}
                              onChange={(e) => handleFieldChange('amount_total', e.target.value)}
                              className={`max-w-[120px] h-8 text-sm ${getFieldError('amount_total') ? 'border-red-400 focus:ring-red-200' : ''}`}
                              placeholder="0.00"
                            />
                          <select
                            className="h-8 text-sm px-2 rounded-md border border-input bg-background"
                            value={editedFields.currency || invoiceData.currency || ''}
                            onChange={(e) => handleFieldChange('currency', e.target.value)}
                          >
                            <option value="">—</option>
                            <option value="EUR">€ EUR</option>
                            <option value="USD">$ USD</option>
                            <option value="GBP">£ GBP</option>
                            <option value="CHF">CHF</option>
                          </select>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {getFieldValue('amount_total', invoiceData?.amount_total)
                              ? formatAmount(
                                  Number(getFieldValue('amount_total', invoiceData?.amount_total)),
                                  editedFields.currency || invoiceData.currency,
                                ).formatted
                              : '-'}
                          </span>
                          {getFieldValue('amount_total', invoiceData?.amount_total) && !(editedFields.currency || invoiceData.currency) && (
                            <select
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap cursor-pointer appearance-none hover:bg-amber-200 transition-colors"
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  const newFields = { ...editedFields, currency: e.target.value };
                                  setEditedFields(newFields);
                                  validateMutation.mutate(newFields);
                                }
                              }}
                            >
                              <option value="" disabled>Währung wählen</option>
                              <option value="EUR">€ EUR</option>
                              <option value="USD">$ USD</option>
                              <option value="GBP">£ GBP</option>
                              <option value="CHF">CHF</option>
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                    {getFieldError('amount_total') && (
                      <p className="text-xs text-red-500 mt-1.5 text-right">{getFieldError('amount_total')}</p>
                    )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Line Items */}
              {invoiceData?.items && invoiceData.items.length > 0 && (
                <Card className="animate-slide-up" style={{ animationDelay: '125ms' }}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Package className="h-5 w-5 text-primary" />
                      Positionen ({invoiceData.items.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Beschreibung</th>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">Menge</th>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">Einheit</th>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">Einzelpreis</th>
                            <th className="text-right py-2 px-3 font-medium text-muted-foreground">Gesamt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoiceData.items.map((item: any, index: number) => (
                            <tr key={index} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-3 px-3 text-foreground">{item.description || '-'}</td>
                              <td className="py-3 px-3 text-right text-foreground">{item.quantity ?? 1}</td>
                              <td className="py-3 px-3 text-right text-muted-foreground">{item.unit || 'Stk'}</td>
                              <td className="py-3 px-3 text-right text-foreground">
                                {item.unit_price
                                  ? formatAmount(item.unit_price, editedFields.currency || invoiceData.currency).formatted
                                  : '-'}
                              </td>
                              <td className="py-3 px-3 text-right font-medium text-foreground">
                                {item.total_price
                                  ? formatAmount(item.total_price, editedFields.currency || invoiceData.currency).formatted
                                  : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-border">
                            <td colSpan={4} className="py-3 px-3 text-right font-medium text-foreground">
                              Gesamtsumme
                            </td>
                            <td className="py-3 px-3 text-right font-serif font-semibold text-lg text-foreground">
                              {getFieldValue('amount_total', invoiceData?.amount_total)
                                ? formatAmount(
                                    Number(getFieldValue('amount_total', invoiceData?.amount_total)),
                                    editedFields.currency || invoiceData.currency,
                                  ).formatted
                                : '-'}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Supplier Info */}
              {(invoiceData?.supplier_name || editingSection === 'supplier') && (
                <Card className="animate-slide-up" style={{ animationDelay: '150ms' }}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Building2 className="h-5 w-5 text-primary" />
                        Anbieter
                      </CardTitle>
                      {['needs_validation', 'parsed', 'validated'].includes(document.status) && (
                        editingSection === 'supplier' ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelEditing}
                              disabled={validateMutation.isPending}
                              title="Abbrechen"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={saveSection}
                              disabled={validateMutation.isPending || hasErrors()}
                              title="Speichern"
                            >
                              <Save className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEditing('supplier')}
                            title="Bearbeiten"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {editingSection === 'supplier' ? (
                      <>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Firmenname</label>
                          <Input
                            value={getFieldValue('supplier_name', invoiceData?.supplier_name)}
                            onChange={(e) => handleFieldChange('supplier_name', e.target.value)}
                            className={getFieldError('supplier_name') ? 'border-red-400 focus:ring-red-200' : ''}
                            placeholder="Firmenname"
                          />
                          {getFieldError('supplier_name') && (
                            <p className="text-xs text-red-500 mt-1">{getFieldError('supplier_name')}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Adresse</label>
                          <Input
                            value={getFieldValue('supplier_address', invoiceData?.supplier_address || '')}
                            onChange={(e) => handleFieldChange('supplier_address', e.target.value)}
                            placeholder="Straße, PLZ, Ort"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="font-serif font-medium text-lg text-foreground">
                          {getFieldValue('supplier_name', invoiceData?.supplier_name) || '-'}
                        </p>
                        {getFieldValue('supplier_address', invoiceData?.supplier_address) && (
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {getFieldValue('supplier_address', invoiceData?.supplier_address)}
                          </p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Processing Timeline */}
              <Card className="animate-slide-up" style={{ animationDelay: '200ms' }}>
                <CardHeader>
                  <CardTitle className="text-lg">Verarbeitungsstatus</CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const stage = jobProgress?.progress?.stage;
                    const isProcessing = document.status === 'processing';
                    const isError = document.status === 'error';
                    const ocrDone = ['parsed', 'needs_validation', 'validated'].includes(document.status)
                      || (isProcessing && ['classifying', 'extracting'].includes(stage));
                    const aiDone = ['parsed', 'needs_validation', 'validated'].includes(document.status)
                      && !isProcessing;

                    // Determine which stage failed
                    const failedOcr = isError && (!stage || stage === 'downloading' || stage === 'ocr');
                    const failedAi = isError && (stage === 'classifying' || stage === 'extracting');

                    // For error state, stages before the failed one are done
                    const ocrDoneOnError = isError && failedAi;
                    const aiDoneOnError = false;

                    const steps = [
                      { label: 'Hochgeladen', done: true, failed: false, active: false },
                      {
                        label: stage === 'ocr' && isProcessing && jobProgress?.progress
                          ? `OCR-Verarbeitung (${jobProgress.progress.current}/${jobProgress.progress.total})`
                          : 'OCR-Verarbeitung',
                        done: ocrDone || ocrDoneOnError,
                        failed: failedOcr,
                        active: isProcessing && (!stage || stage === 'downloading' || stage === 'ocr'),
                      },
                      {
                        label: stage === 'classifying' && isProcessing ? 'AI-Klassifizierung...' : 'AI-Extraktion',
                        done: aiDone || aiDoneOnError,
                        failed: failedAi,
                        active: isProcessing && (stage === 'classifying' || stage === 'extracting'),
                      },
                      { label: 'Validiert', done: document.status === 'validated', failed: false, active: false },
                    ];
                    return (
                      <div className="space-y-4">
                        {steps.map((step, i) => (
                          <div key={i} className="flex items-center gap-4">
                            {step.done ? (
                              <svg className="h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : step.failed ? (
                              <div className="h-2.5 w-2.5 rounded-full flex-shrink-0 bg-red-400 dark:bg-red-500" />
                            ) : step.active ? (
                              <div className="h-2 w-2 rounded-full flex-shrink-0 bg-primary animate-slow-blink" />
                            ) : (
                              <div className="h-2 w-2 rounded-full flex-shrink-0 bg-muted" />
                            )}
                            <span className={`text-sm ${
                              step.done || step.active ? 'text-foreground'
                              : step.failed ? 'text-red-500 dark:text-red-400'
                              : 'text-muted-foreground'
                            }`}>
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dokument löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dies wird das Dokument dauerhaft löschen. Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-red-600 hover:bg-red-700"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
