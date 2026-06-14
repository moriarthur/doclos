'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsApi, authApi } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

import { formatDate, formatAmount, getStatusLabel, getDocumentTypeLabel } from '@/lib/utils';
import {
  FileText,
  Search,
  Filter,
  Plus,
  ChevronRight,
  ChevronDown,
  Calendar,


  Sparkles,
  Loader2,
  Archive,
  Trash2,


} from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
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

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);

  // Check authentication before showing content
  useEffect(() => {
    const checkAuth = () => {
      if (!authApi.isAuthenticated()) {
        router.push('/login');
      } else {
        setIsCheckingAuth(false);
      }
    };

    const timer = setTimeout(checkAuth, 100);
    return () => clearTimeout(timer);
  }, [router]);

  const { data: documents, isLoading, error } = useQuery({
    queryKey: ['documents', statusFilter],
    queryFn: () => {
      // Default: show all except archived
      if (statusFilter) {
        return documentsApi.list({ status: statusFilter });
      }
      return documentsApi.list({ status: undefined });
    },
    enabled: !isCheckingAuth, // Only fetch after auth check
  });

  const filteredDocuments = documents?.data
    .filter((doc) => {
      // Exclude archived documents from default view
      if (!statusFilter && doc.status === 'archived') return false;
      return true;
    })
    .filter((doc) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        doc.company_name?.toLowerCase().includes(q) ||
        doc.invoice_number?.toLowerCase().includes(q)
      );
    }) || [];

  const archiveMutation = useMutation({
    mutationFn: (id: string) => documentsApi.updateStatus(id, 'archived'),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setDeleteDialog(null);
    },
  });

  const handleArchive = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    archiveMutation.mutate(id);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteDialog(id);
  };

  const confirmDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  // Show loading overlay while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex">
      <Navigation />

      {/* Main Content */}
      <main className="flex-1 md:ml-64 min-h-screen min-w-0">
        {/* Mobile header spacer */}
        <div className="h-16 md:hidden" />

        <div className="p-6 md:p-10 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-10 animate-fade-in">
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wide mb-2">
                Dashboard
              </p>
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-brand">
                Dokumente
              </h1>
              <p className="text-muted-foreground mt-2 max-w-md leading-relaxed">
                Verwalten und validieren Sie Ihre Rechnungen mit KI-gestützter Extraktion
              </p>
            </div>

            <Link href="/upload">
              <Button className="gap-2 shadow-sm">
                <Plus className="h-4 w-4" />
                Hochladen
              </Button>
            </Link>
          </div>

          {/* Search and Filters */}
          <Card className="mb-8 animate-scale-in">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Search */}
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Dokumente durchsuchen..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                </div>

                {/* Status Filter */}
                <div className="relative">
                  <Filter className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full pl-11 pr-10 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary appearance-none cursor-pointer transition-all"
                  >
                    <option value="">Alle Status</option>
                    <option value="processing">Verarbeitung</option>
                    <option value="parsed">Verarbeitet</option>
                    <option value="needs_validation">Prüfung erforderlich</option>
                    <option value="validated">Validiert</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documents List */}
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-4 bg-muted rounded w-1/3 mb-3"></div>
                    <div className="h-3 bg-muted rounded w-1/4"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className="p-16 text-center">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Fehler beim Laden der Dokumente</p>
              </CardContent>
            </Card>
          ) : filteredDocuments.length === 0 ? (
            <Card className="animate-scale-in">
              <CardContent className="p-16 text-center">
                <div className="h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-6">
                  <FileText className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="font-serif text-xl font-semibold mb-3">
                  {searchQuery || statusFilter ? 'Keine Ergebnisse' : 'Noch keine Dokumente'}
                </h3>
                <p className="text-muted-foreground mb-8 max-w-sm mx-auto leading-relaxed">
                  {searchQuery || statusFilter
                    ? 'Keine Dokumente gefunden, die Ihren Kriterien entsprechen.'
                    : 'Laden Sie Ihre erste Rechnung hoch, um zu beginnen.'}
                </p>
                {!searchQuery && !statusFilter && (
                  <Link href="/upload">
                    <Button className="gap-2">
                      <Sparkles className="h-4 w-4" />
                      Erste Rechnung hochladen
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredDocuments.map((doc, index) => (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="block animate-slide-up group"
                  style={{ animationDelay: `${index * 75}ms` }}
                >
                  <Card className="hover:shadow-lg transition-all duration-300 cursor-pointer">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          {/* Icon */}
                          <div className="flex-shrink-0">
                            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                              <FileText className="h-6 w-6 text-primary" />
                            </div>
                          </div>

                          {/* Document Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 mb-2">
                              <span className="font-serif font-medium text-foreground truncate">
                                {doc.company_name || 'Unbekannter Anbieter'}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                              {doc.invoice_date && (
                                <span className="flex items-center gap-1.5">
                                  <Calendar className="h-4 w-4" />
                                  {formatDate(doc.invoice_date)}
                                </span>
                              )}
                              {doc.amount && (
                                <span className="flex items-center gap-1.5 font-medium">
                                  {formatAmount(doc.amount, doc.currency).formatted}
                                  {!doc.currency && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                                      ?
                                    </span>
                                  )}
                                </span>
                              )}
                              {doc.type && doc.type !== 'unknown' && (
                                <span className="text-xs uppercase tracking-wide">
                                  {getDocumentTypeLabel(doc.type)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 ml-4">
                          <span className={`h-2 w-2 rounded-full shrink-0 mr-1 ${
                            doc.status === 'uploaded' ? 'bg-blue-500' :
                            doc.status === 'processing' ? 'bg-yellow-500' :
                            doc.status === 'parsed' ? 'bg-green-500' :
                            doc.status === 'needs_validation' ? 'bg-orange-500' :
                            doc.status === 'validated' ? 'bg-emerald-500' :
                            doc.status === 'error' ? 'bg-red-400' :
                            doc.status === 'archived' ? 'bg-gray-400' :
                            'bg-gray-400'
                          }`} role="img" aria-label={getStatusLabel(doc.status)} title={getStatusLabel(doc.status)} />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleArchive(doc.id, e)}
                            disabled={archiveMutation.isPending}
                            className="gap-1.5"
                            title="Archivieren"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleDelete(doc.id, e)}
                            disabled={deleteMutation.isPending}
                            className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                            title="Löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all flex-shrink-0" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
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
              onClick={() => deleteDialog && confirmDelete(deleteDialog)}
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
