'use client';

import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { documentsApi } from '@/lib/api-client';
import { Navigation } from '@/components/Navigation';
import { ExportMenu } from '@/components/ExportMenu';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

import { formatDate, formatAmount } from '@/lib/utils';
import {
  FileText,
  Search,
  Filter,
  Plus,
  ChevronRight,
  ChevronDown,
  Calendar,
  Sparkles,
  Archive,
  Trash2,
  ListChecks,
  Check,
  X,
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

const statusOptions = [
  { value: 'processing', key: 'processing' },
  { value: 'parsed', key: 'parsed' },
  { value: 'needs_validation', key: 'needs_validation' },
  { value: 'validated', key: 'validated' },
] as const;

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const t = useTranslations('Dashboard');
  const tCommon = useTranslations('Common');
  const tStatus = useTranslations('Status');
  const tDocType = useTranslations('DocType');
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialog, setBulkDeleteDialog] = useState(false);

  // Debounce the search box — server-side search shouldn't fire per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: ['documents', statusFilter, debouncedSearch],
    queryFn: ({ pageParam = 1 }) =>
      debouncedSearch
        ? documentsApi.search({
            q: debouncedSearch,
            status: statusFilter || undefined,
            page: pageParam,
            limit: 20,
          })
        : documentsApi.list({
            status: statusFilter || undefined,
            page: pageParam,
            limit: 20,
          }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page * last.pagination.limit < last.pagination.total
        ? last.pagination.page + 1
        : undefined,
    // Poll while any visible document is still queued/processing so the
    // status dot (animated for uploaded/processing) reflects completion live.
    refetchInterval: (query) => {
      const docs = query.state.data?.pages.flatMap((p) => p.data) ?? [];
      return docs.some(
        (d) => d.status === 'uploaded' || d.status === 'processing',
      )
        ? 2000
        : false;
    },
  });

  const allDocuments = data?.pages.flatMap((page) => page.data) ?? [];

  const filteredDocuments = allDocuments.filter((doc) => {
    // Exclude archived documents from the default (non-search) view. Server-side
    // search already scopes by relevance and may legitimately surface archived
    // matches, so we don't hide them while searching.
    if (!debouncedSearch && !statusFilter && doc.status === 'archived') return false;
    return true;
  });

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

  // --- Selection mode (bulk export / archive / delete) ---
  // Selection lives in a Set, independent of the current filter/search view, so
  // the user can assemble a selection across different filters before exporting.
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleIds = filteredDocuments.map((d) => d.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleSelectAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => documentsApi.updateStatus(id, 'archived'))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      exitSelection();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => documentsApi.delete(id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setBulkDeleteDialog(false);
      exitSelection();
    },
  });

  return (
    <div className="flex">
      <Navigation />

      {/* Main Content */}
      <main className="flex-1 md:ml-64 min-h-screen min-w-0 overflow-x-hidden">
        {/* Mobile header spacer */}
        <div className="h-16 md:hidden" />

        <div className="p-6 md:p-10 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row flex-wrap sm:items-end sm:justify-between gap-6 mb-10 animate-fade-in">
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wide mb-2">
                {t('eyebrow')}
              </p>
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-brand">
                {t('title')}
              </h1>
              <p className="text-muted-foreground mt-2 max-w-md leading-relaxed">
                {t('subtitle')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={selectionMode ? 'primary' : 'secondary'}
                size="sm"
                className="gap-1.5"
                onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
              >
                <ListChecks className="h-4 w-4" />
                {selectionMode ? t('selectionDone') : t('selectBtn')}
              </Button>
              <ExportMenu
                variant="list"
                status={statusFilter}
                ids={selectionMode && selectedIds.size > 0 ? [...selectedIds] : undefined}
              />
              <Link href="/upload">
                <Button className="gap-2 shadow-sm">
                  <Plus className="h-4 w-4" />
                  {t('uploadBtn')}
                </Button>
              </Link>
            </div>
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
                    placeholder={t('searchPlaceholder')}
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
                    <option value="">{t('filterAll')}</option>
                    {statusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {tStatus(opt.key)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Selection bulk bar */}
          {selectionMode && (
            <Card className="mb-6 animate-slide-down border-primary/30">
              <CardContent className="p-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={toggleSelectAllVisible}
                  disabled={visibleIds.length === 0}
                  className="text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {allVisibleSelected ? t('deselectAll') : t('selectAll')}
                </button>
                <span className="text-sm text-muted-foreground">
                  {t('selectedCount', { count: selectedIds.size })}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5"
                    onClick={() => bulkArchiveMutation.mutate([...selectedIds])}
                    disabled={selectedIds.size === 0 || bulkArchiveMutation.isPending}
                  >
                    <Archive className="h-4 w-4" />
                    {t('archiveTitle')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400"
                    onClick={() => setBulkDeleteDialog(true)}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('deleteTitle')}
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={exitSelection}>
                    <X className="h-4 w-4" />
                    {tCommon('cancel')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

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
                <p className="text-muted-foreground">{t('loadError')}</p>
              </CardContent>
            </Card>
          ) : filteredDocuments.length === 0 ? (
            <Card className="animate-scale-in">
              <CardContent className="p-16 text-center">
                <div className="h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-6">
                  <FileText className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="font-serif text-xl font-semibold mb-3">
                  {debouncedSearch || statusFilter ? t('emptyNoResults') : t('emptyNoDocs')}
                </h3>
                <p className="text-muted-foreground mb-8 max-w-sm mx-auto leading-relaxed">
                  {debouncedSearch || statusFilter ? t('emptyNoResultsDesc') : t('emptyNoDocsDesc')}
                </p>
                {!debouncedSearch && !statusFilter && (
                  <Link href="/upload">
                    <Button className="gap-2">
                      <Sparkles className="h-4 w-4" />
                      {t('firstInvoiceBtn')}
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
            <div className="space-y-3">
              {filteredDocuments.map((doc, index) => (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="block animate-slide-up group"
                  style={{ animationDelay: `${index * 75}ms` }}
                  onClick={(e) => {
                    if (selectionMode) {
                      e.preventDefault();
                      toggleSelect(doc.id);
                    }
                  }}
                >
                  <Card className="hover:shadow-lg transition-all duration-300 cursor-pointer">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          {/* Selection checkbox */}
                          {selectionMode && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleSelect(doc.id);
                              }}
                              className={`flex-shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                selectedIds.has(doc.id)
                                  ? 'bg-primary border-primary'
                                  : 'border-border hover:border-primary'
                              }`}
                              aria-label={t('selectBtn')}
                            >
                              {selectedIds.has(doc.id) && <Check className="h-4 w-4 text-white" />}
                            </button>
                          )}
                          {/* Icon */}
                          <div className="flex-shrink-0">
                            <div
                              className={`h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors ${
                                selectedIds.has(doc.id) ? 'ring-2 ring-primary/40' : ''
                              }`}
                            >
                              <FileText className="h-6 w-6 text-primary" />
                            </div>
                          </div>

                          {/* Document Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 mb-2 min-w-0">
                              <span className="font-serif font-medium text-foreground truncate">
                                {doc.company_name || tCommon('unknownSupplier')}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                              {doc.invoice_date && (
                                <span className="flex items-center gap-1.5">
                                  <Calendar className="h-4 w-4" />
                                  {formatDate(doc.invoice_date, locale)}
                                </span>
                              )}
                              {doc.amount && (
                                <span className="flex items-center gap-1.5 font-medium">
                                  {formatAmount(doc.amount, doc.currency, locale).formatted}
                                  {!doc.currency && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                                      ?
                                    </span>
                                  )}
                                </span>
                              )}
                              {doc.type && doc.type !== 'unknown' && (
                                <span className="text-xs uppercase tracking-wide">
                                  {tDocType(doc.type)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions (hidden in selection mode) */}
                        <div className={`flex items-center gap-1 ml-4 shrink-0 ${selectionMode ? 'hidden' : ''}`}>
                          <span className={`h-2 w-2 rounded-full shrink-0 mr-1 ${
                            doc.status === 'uploaded' ? 'bg-blue-500' :
                            doc.status === 'processing' ? 'bg-yellow-500' :
                            doc.status === 'parsed' ? 'bg-green-500' :
                            doc.status === 'needs_validation' ? 'bg-orange-500' :
                            doc.status === 'validated' ? 'bg-emerald-500' :
                            doc.status === 'error' ? 'bg-red-400' :
                            doc.status === 'archived' ? 'bg-gray-400' :
                            'bg-gray-400'
                          } ${(doc.status === 'uploaded' || doc.status === 'processing') ? 'animate-slow-blink' : ''}`} role="img" aria-label={tStatus(doc.status)} title={tStatus(doc.status)} />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleArchive(doc.id, e)}
                            disabled={archiveMutation.isPending}
                            className="gap-1.5"
                            title={t('archiveTitle')}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleDelete(doc.id, e)}
                            disabled={deleteMutation.isPending}
                            className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                            title={t('deleteTitle')}
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

            {hasNextPage && (
              <div className="mt-6">
                <Button
                  variant="secondary"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full"
                >
                  {isFetchingNextPage ? tCommon('loading') : tCommon('loadMore')}
                </Button>
              </div>
            )}
            </>
          )}
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCommon('deleteDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tCommon('deleteDialogDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDialog && confirmDelete(deleteDialog)}
              className="bg-red-600 hover:bg-red-700"
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteDialog} onOpenChange={setBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bulkDeleteTitle', { count: selectedIds.size })}</AlertDialogTitle>
            <AlertDialogDescription>{tCommon('deleteDialogDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
              className="bg-red-600 hover:bg-red-700"
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
