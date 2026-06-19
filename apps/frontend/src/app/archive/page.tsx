'use client';

import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import { documentsApi } from '@/lib/api-client';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDate, formatAmount } from '@/lib/utils';
import {
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
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

  return (
    <div className="flex">
      <Navigation />

      {/* Main Content */}
      <main className="flex-1 md:ml-64 min-h-screen min-w-0">
        {/* Mobile header spacer */}
        <div className="h-16 md:hidden" />

        <div className="p-6 md:p-10 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-10 animate-fade-in">
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
                >
                  <Card className="hover:shadow-lg transition-all duration-300">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="flex items-center gap-4 flex-1 min-w-0"
                        >
                          {/* Icon */}
                          <div className="flex-shrink-0">
                            <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center group-hover:bg-muted transition-colors">
                              <Archive className="h-6 w-6 text-muted-foreground" />
                            </div>
                          </div>

                          {/* Document Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 mb-2">
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

                        {/* Actions */}
                        <div className="flex items-center gap-1 ml-4">
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
    </div>
  );
}
