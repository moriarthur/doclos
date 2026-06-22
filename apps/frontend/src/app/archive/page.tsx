'use client';

import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { documentsApi } from '@/lib/api-client';
import { Navigation } from '@/components/Navigation';
import { ExportMenu } from '@/components/ExportMenu';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDate, formatAmount } from '@/lib/utils';
import {
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
  ListChecks,
  Check,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
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

export default function ArchivePage() {
  const queryClient = useQueryClient();
  const t = useTranslations('Archive');
  const tCommon = useTranslations('Common');
  const tStatus = useTranslations('Status');
  const tDocType = useTranslations('DocType');
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialog, setBulkDeleteDialog] = useState(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['documents', 'archived'],
    queryFn: ({ pageParam = 1 }) =>
      documentsApi.list({ status: 'archived', page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page * last.pagination.limit < last.pagination.total
        ? last.pagination.page + 1
        : undefined,
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => documentsApi.unarchive(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setDeleteDialog(null);
    },
  });

  const handleUnarchive = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    unarchiveMutation.mutate(id);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteDialog(id);
  };

  const confirmDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const allDocuments = data?.pages.flatMap((page) => page.data) ?? [];

  const filteredDocuments = allDocuments.filter((doc) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      doc.company_name?.toLowerCase().includes(q) ||
      doc.invoice_number?.toLowerCase().includes(q)
    );
  });

  // --- Selection mode (bulk restore / delete / export) ---
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

  const bulkUnarchiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => documentsApi.unarchive(id))),
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
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-brand mb-3">
                {t('title')}
              </h1>
              <p className="text-muted-foreground max-w-md leading-relaxed">
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
                status="archived"
                ids={selectionMode && selectedIds.size > 0 ? [...selectedIds] : undefined}
              />
            </div>
          </div>

          {/* Search */}
          <Card className="mb-8 animate-scale-in">
            <CardContent className="p-5">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                />
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
                    onClick={() => bulkUnarchiveMutation.mutate([...selectedIds])}
                    disabled={selectedIds.size === 0 || bulkUnarchiveMutation.isPending}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    {t('restore')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400"
                    onClick={() => setBulkDeleteDialog(true)}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('delete')}
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
          ) : filteredDocuments.length === 0 ? (
            <Card className="animate-scale-in">
              <CardContent className="p-16 text-center">
                <div className="h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-6">
                  <Archive className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="font-serif text-xl font-semibold mb-3">
                  {searchQuery ? t('emptyNoResults') : t('empty')}
                </h3>
                <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  {searchQuery ? t('emptyNoResultsDesc') : t('emptyDesc')}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
            <div className="space-y-3">
              {filteredDocuments.map((doc, index) => (
                <div
                  key={doc.id}
                  className="animate-slide-up group"
                  style={{ animationDelay: `${index * 75}ms` }}
                  onClick={(e) => {
                    if (selectionMode) {
                      e.preventDefault();
                      toggleSelect(doc.id);
                    }
                  }}
                >
                  <Card className="hover:shadow-lg transition-all duration-300">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        {selectionMode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSelect(doc.id);
                            }}
                            className={`flex-shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors mr-4 ${
                              selectedIds.has(doc.id)
                                ? 'bg-primary border-primary'
                                : 'border-border hover:border-primary'
                            }`}
                            aria-label={t('selectBtn')}
                          >
                            {selectedIds.has(doc.id) && <Check className="h-4 w-4 text-white" />}
                          </button>
                        )}
                        <Link
                          href={`/documents/${doc.id}`}
                          className="flex items-center gap-4 flex-1 min-w-0"
                          onClick={(e) => {
                            if (selectionMode) e.preventDefault();
                          }}
                        >
                          {/* Icon */}
                          <div className="flex-shrink-0">
                            <div
                              className={`h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center group-hover:bg-muted transition-colors ${
                                selectedIds.has(doc.id) ? 'ring-2 ring-primary/40' : ''
                              }`}
                            >
                              <Archive className="h-6 w-6 text-muted-foreground" />
                            </div>
                          </div>

                          {/* Document Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 mb-2 min-w-0">
                              <span className="font-serif font-medium text-foreground truncate">
                                {doc.company_name || tCommon('unknownSupplier')}
                              </span>
                              <Badge variant="archived" className="shrink-0">
                                {tStatus(doc.status)}
                              </Badge>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                              {doc.invoice_date && (
                                <span className="flex items-center gap-1.5">
                                  {formatDate(doc.invoice_date, locale)}
                                </span>
                              )}
                              {doc.amount && (
                                <span className="flex items-center gap-1.5 font-medium">
                                  {formatAmount(doc.amount, doc.currency, locale).formatted}
                                </span>
                              )}
                              {doc.type && doc.type !== 'unknown' && (
                                <span className="text-xs uppercase tracking-wide">
                                  {tDocType(doc.type)}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>

                        {/* Actions (hidden in selection mode) */}
                        <div className={`flex items-center gap-1 ml-4 shrink-0 ${selectionMode ? 'hidden' : ''}`}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleUnarchive(doc.id, e)}
                            disabled={unarchiveMutation.isPending}
                            title={t('restore')}
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleDelete(doc.id, e)}
                            disabled={deleteMutation.isPending}
                            title={t('delete')}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
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
