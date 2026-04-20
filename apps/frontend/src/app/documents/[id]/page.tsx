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
import { formatDate, getStatusLabel } from '@/lib/utils';
import {
  ArrowLeft,
  FileText,
  Calendar,
  Euro,
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
  const [isEditing, setIsEditing] = useState(false);
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
    enabled: !!docId && document?.status === 'processing',
    refetchInterval: 1000, // Poll every second for job progress
  });

  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => jobsApi.cancelJob(jobId),
    onSuccess: () => {
      // Refetch document to get updated status
      refetch();
    },
  });

  const handleCancelProcessing = () => {
    if (jobProgress?.id) {
      cancelJobMutation.mutate(jobProgress.id);
    }
  };

  const validateMutation = useMutation({
    mutationFn: (fields: Record<string, string>) =>
      documentsApi.validate(docId, fields),
    onSuccess: () => {
      setIsEditing(false);
      setEditedFields({});
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

  const getFieldValue = (field: string, originalValue: string | { value?: string } | undefined) => {
    // Handle backend response structure: { value, confidence } or direct string
    const baseValue = typeof originalValue === 'object' && originalValue?.value
      ? originalValue.value
      : originalValue;
    return editedFields[field] ?? baseValue ?? '';
  };

  const handleSave = () => {
    if (Object.keys(editedFields).length > 0) {
      validateMutation.mutate(editedFields);
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

            <div className="flex items-center gap-2">
              {document.status === 'needs_validation' && (
                <>
                  {isEditing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsEditing(false);
                          setEditedFields({});
                        }}
                        disabled={validateMutation.isPending}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Abbrechen
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSave}
                        isLoading={validateMutation.isPending}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        Speichern
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsEditing(true)}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Bearbeiten
                    </Button>
                  )}
                </>
              )}
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
          {document.status === 'error' && (
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
                    reprocessing={document.status === 'processing' || reprocessMutation.isPending || (reprocessMutation.isSuccess && document.status === 'error')}
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
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Settings className="h-5 w-5 text-primary" />
                    Rechnungsdetails
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Invoice Number */}
                    <div className="flex items-center justify-between py-3 border-b border-border gap-3">
                      <span className="text-sm text-muted-foreground shrink-0">Rechnungsnummer</span>
                      {isEditing ? (
                        <Input
                          value={getFieldValue('invoice_number', invoiceData?.invoice_number)}
                          onChange={(e) => handleFieldChange('invoice_number', e.target.value)}
                          className="max-w-[200px] h-8 text-sm"
                          placeholder="Rechnungsnummer"
                        />
                      ) : (
                        <span className="font-medium text-foreground truncate">
                          {getFieldValue('invoice_number', invoiceData?.invoice_number) || '-'}
                        </span>
                      )}
                    </div>

                    {/* Invoice Date */}
                    <div className="flex items-center justify-between py-3 border-b border-border gap-3">
                      <span className="text-sm text-muted-foreground flex items-center gap-2 shrink-0">
                        <Calendar className="h-4 w-4" />
                        Rechnungsdatum
                      </span>
                      {isEditing ? (
                        <Input
                          type="date"
                          value={getFieldValue('invoice_date', invoiceData?.invoice_date)}
                          onChange={(e) => handleFieldChange('invoice_date', e.target.value)}
                          className="max-w-[160px] h-8 text-sm"
                        />
                      ) : (
                        <span className="font-medium text-foreground">
                          {getFieldValue('invoice_date', invoiceData?.invoice_date) ? formatDate(getFieldValue('invoice_date', invoiceData?.invoice_date)) : '-'}
                        </span>
                      )}
                    </div>

                    {/* Due Date */}
                    <div className="flex items-center justify-between py-3 border-b border-border gap-3">
                      <span className="text-sm text-muted-foreground flex items-center gap-2 shrink-0">
                        <Calendar className="h-4 w-4" />
                        Fälligkeitsdatum
                      </span>
                      {isEditing ? (
                        <Input
                          type="date"
                          value={getFieldValue('due_date', invoiceData?.due_date)}
                          onChange={(e) => handleFieldChange('due_date', e.target.value)}
                          className="max-w-[160px] h-8 text-sm"
                        />
                      ) : (
                        <span className="font-medium text-foreground">
                          {getFieldValue('due_date', invoiceData?.due_date) ? formatDate(getFieldValue('due_date', invoiceData?.due_date)) : '-'}
                        </span>
                      )}
                    </div>

                    {/* Amount */}
                    <div className="flex items-center justify-between py-3 gap-3">
                      <span className="text-sm text-muted-foreground flex items-center gap-2 shrink-0">
                        <Euro className="h-4 w-4" />
                        Betrag
                      </span>
                      {isEditing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={getFieldValue('amount_total', invoiceData?.amount_total?.toString())}
                          onChange={(e) => handleFieldChange('amount_total', e.target.value)}
                          className="max-w-[120px] h-8 text-sm"
                          placeholder="0.00"
                        />
                      ) : (
                        <span className="font-serif font-semibold text-xl text-foreground">
                          {getFieldValue('amount_total', invoiceData?.amount_total)
                            ? new Intl.NumberFormat('de-DE', {
                                style: 'currency',
                                currency: invoiceData.currency || 'EUR',
                              }).format(Number(getFieldValue('amount_total', invoiceData?.amount_total)))
                            : '-'}
                        </span>
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
                                  ? new Intl.NumberFormat('de-DE', {
                                      style: 'currency',
                                      currency: invoiceData.currency || 'EUR',
                                    }).format(item.unit_price)
                                  : '-'}
                              </td>
                              <td className="py-3 px-3 text-right font-medium text-foreground">
                                {item.total_price
                                  ? new Intl.NumberFormat('de-DE', {
                                      style: 'currency',
                                      currency: invoiceData.currency || 'EUR',
                                    }).format(item.total_price)
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
                                ? new Intl.NumberFormat('de-DE', {
                                    style: 'currency',
                                    currency: invoiceData.currency || 'EUR',
                                  }).format(Number(getFieldValue('amount_total', invoiceData?.amount_total)))
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
              {(invoiceData?.supplier_name || isEditing) && (
                <Card className="animate-slide-up" style={{ animationDelay: '150ms' }}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Building2 className="h-5 w-5 text-primary" />
                      Anbieter
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isEditing ? (
                      <>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Firmenname</label>
                          <Input
                            value={getFieldValue('supplier_name', invoiceData?.supplier_name)}
                            onChange={(e) => handleFieldChange('supplier_name', e.target.value)}
                            placeholder="Firmenname"
                          />
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
                  <div className="space-y-4">
                    {[
                      { label: 'Hochgeladen', done: true, inProgress: false },
                      {
                        label: jobProgress?.progress?.stage === 'ocr'
                          ? `OCR-Verarbeitung (${jobProgress.progress.current}/${jobProgress.progress.total})`
                          : 'OCR-Verarbeitung',
                        done: ['processing', 'parsed', 'needs_validation', 'validated'].includes(document.status),
                        inProgress: document.status === 'processing' && jobProgress?.progress?.stage === 'ocr',
                      },
                      { label: 'AI-Extraktion', done: ['parsed', 'needs_validation', 'validated'].includes(document.status), inProgress: document.status === 'processing' && jobProgress?.progress?.stage === 'classifying' },
                      { label: 'Validiert', done: document.status === 'validated', inProgress: false },
                    ].map((step, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          step.done ? 'bg-primary' : step.inProgress ? 'bg-primary animate-slow-blink' : 'bg-muted'
                        }`}></div>
                        <span className={`text-sm ${step.done || step.inProgress ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
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
