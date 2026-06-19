'use client';

import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { documentsApi, authApi } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  UploadCloud,
  FileText,
  X,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'];

// Smart filename truncation - shows beginning, middle with ellipsis, and extension
function truncateFileName(filename: string, maxLength: number = 25): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  // Extract extension
  const lastDotIndex = filename.lastIndexOf('.');
  const extension = lastDotIndex > 0 ? filename.substring(lastDotIndex) : '';
  const nameWithoutExt = lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;

  // Calculate available space for name (reserve space for "..." and extension)
  const ellipsis = '...';
  const availableSpace = maxLength - ellipsis.length - extension.length;

  if (availableSpace < 5) {
    // Not enough space, truncate end with extension
    return filename.substring(0, maxLength - extension.length) + ellipsis + extension;
  }

  // Show beginning, ellipsis, and extension
  return nameWithoutExt.substring(0, availableSpace) + ellipsis + extension;
}

export default function UploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('Upload');
  const tDashboard = useTranslations('Dashboard');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({});
  const [uploadedDocIds, setUploadedDocIds] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [currentUploadIndex, setCurrentUploadIndex] = useState<number | null>(null);

  const uploadMutation = useMutation({
    mutationFn: ({ file }: { file: File; index: number }) =>
      documentsApi.upload(file),
    onSuccess: (data, variables) => {
      setUploadProgress((prev) => ({ ...prev, [variables.index]: 100 }));
      setUploadedDocIds((prev) => [...prev, data.document_id]);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err, variables) => {
      const errorMsg = authApi.getErrorMessage(err);
      setFileErrors((prev) => ({ ...prev, [variables.index]: errorMsg }));
      setUploadProgress((prev) => ({ ...prev, [variables.index]: 0 }));
      setCurrentUploadIndex(null);
    },
  });

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return t('fileTooLarge');
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return t('unsupportedType');
    }
    return null;
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const validFiles: File[] = [];
    const newErrors: Record<string, string> = {};

    droppedFiles.forEach((file) => {
      const error = validateFile(file);
      if (error) {
        newErrors[file.name] = error;
      } else {
        validFiles.push(file);
      }
    });

    setFileErrors((prev) => ({ ...prev, ...newErrors }));
    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles]);
    }
  }, [t]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files!);
      const validFiles: File[] = [];
      const newErrors: Record<string, string> = {};

      selectedFiles.forEach((file) => {
        const error = validateFile(file);
        if (error) {
          newErrors[file.name] = error;
        } else {
          validFiles.push(file);
        }
      });

      setFileErrors((prev) => ({ ...prev, ...newErrors }));
      if (validFiles.length > 0) {
        setFiles((prev) => [...prev, ...validFiles]);
      }
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      const file = newFiles[index];
      newFiles.splice(index, 1);

      // Clean up progress and errors
      setUploadProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[index];
        return newProgress;
      });
      setFileErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[file.name];
        return newErrors;
      });

      // Reindex progress after removal
      setUploadProgress((prev) => {
        const reindexed: Record<number, number> = {};
        Object.entries(prev).forEach(([key, value]) => {
          const idx = parseInt(key);
          if (idx > index) {
            reindexed[idx - 1] = value;
          } else {
            reindexed[idx] = value;
          }
        });
        return reindexed;
      });

      return newFiles;
    });
  };

  const uploadFile = (file: File, index: number) => {
    setCurrentUploadIndex(index);
    setUploadProgress((prev) => ({ ...prev, [index]: 0 }));
    setFileErrors((prev) => {
      const fileToRemove = Object.keys(prev).find(k => prev[k] === fileErrors[file.name]);
      if (fileToRemove) {
        const newErrors = { ...prev };
        delete newErrors[fileToRemove];
        return newErrors;
      }
      return prev;
    });

    // Simulate progress
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 10;
      setUploadProgress((prev) => {
        const newProgress = { ...prev, [index]: Math.min(progress, 90) };
        return newProgress;
      });
    }, 200);

    uploadMutation.mutate({ file, index }, {
      onSettled: () => {
        clearInterval(progressInterval);
      },
    });
  };

  return (
    <div className="flex">
      <Navigation />

      {/* Main Content */}
      <main className="flex-1 md:ml-64 min-h-screen min-w-0">
        {/* Mobile header spacer */}
        <div className="h-16 md:hidden" />

        <div className="p-6 md:p-10 max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-10 animate-fade-in">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
              <Link href="/" className="hover:text-foreground transition-colors">{tDashboard('title')}</Link>
              <span>/</span>
              <span className="text-foreground">{t('breadcrumbUpload')}</span>
            </div>
            <h1 className="font-serif text-4xl md:text-5xl font-bold mb-3 text-brand">
              {t('title')}
            </h1>
            <p className="text-muted-foreground max-w-md leading-relaxed">
              {t('subtitle')}
            </p>
          </div>

          {/* Upload Area */}
          <Card className="mb-8 animate-scale-in w-full overflow-hidden">
            <CardContent className="p-4 md:p-8">
              {!uploadedDocIds.length ? (
                <>
                  <div
                    className={`relative border-2 border-dashed rounded-2xl p-6 md:p-10 lg:p-16 text-center transition-all duration-300 w-full ${
                      dragActive
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-muted/30'
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      id="file-upload"
                      className="hidden"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.tiff"
                      onChange={handleFileInput}
                    />
                    <label
                      htmlFor="file-upload"
                      className="cursor-pointer flex flex-col items-center w-full min-w-0"
                    >
                      <div className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-primary/10 flex items-center justify-center mb-4 md:mb-6 shrink-0">
                        <UploadCloud className="h-8 w-8 md:h-10 md:w-10 text-primary" />
                      </div>
                      <p className="font-serif text-lg md:text-xl font-medium mb-2 md:mb-3 text-foreground px-2">
                        {dragActive ? t('dropActive') : t('dropHint')}
                      </p>
                      <p className="text-sm md:text-base text-muted-foreground mb-4 md:mb-6 px-2">
                        {t('orClick')}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        onClick={(e) => {
                          e.preventDefault();
                          fileInputRef.current?.click();
                        }}
                      >
                        {t('browse')}
                      </Button>
                    </label>

                    <p className="text-xs text-muted-foreground mt-4 md:mt-8 px-2">
                      {t('acceptedFormats')}
                    </p>
                  </div>

                  {/* File List */}
                  {files.length > 0 && (
                    <div className="mt-8 space-y-3 max-w-full">
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide shrink-0">
                          {t('selectedFiles', { count: files.length })}
                        </p>
                        <Button
                          size="sm"
                          onClick={() => {
                            files.forEach((file, index) => {
                              if (!uploadProgress[index] && uploadProgress[index] !== 100) {
                                uploadFile(file, index);
                              }
                            });
                          }}
                          disabled={currentUploadIndex !== null || files.length === 0}
                        >
                          {t('uploadAll')}
                        </Button>
                      </div>
                      {files.map((file, index) => {
                        const progress = uploadProgress[index] || 0;
                        const hasError = Object.values(fileErrors).some(err => err.includes(file.name));
                        const isLoading = currentUploadIndex === index && progress < 100;

                        return (
                          <div
                            key={index}
                            className={`p-4 rounded-xl border transition-colors overflow-hidden w-full box-border ${
                              hasError
                                ? 'border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-900/10'
                                : 'bg-muted/30 border-border'
                            }`}
                          >
                            <div className="flex items-center gap-3 mb-3 min-w-0">
                              <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" title={file.name}>
                                  {truncateFileName(file.name)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {(file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                              {isLoading && (
                                <div className="flex items-center gap-2 text-primary">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span className="text-sm">{progress}%</span>
                                </div>
                              )}
                              {progress === 100 && (
                                <Check className="h-5 w-5 text-green-600" />
                              )}
                              {!isLoading && progress === 0 && (
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => uploadFile(file, index)}
                                    disabled={currentUploadIndex !== null}
                                  >
                                    {t('uploadOne')}
                                  </Button>
                                  <button
                                    onClick={() => removeFile(index)}
                                    className="p-2 rounded-lg hover:bg-muted transition-colors"
                                    disabled={currentUploadIndex !== null}
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Progress Bar */}
                            {isLoading && (
                              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-primary h-full transition-all duration-200"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-16 animate-scale-in">
                  <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-6">
                    <Check className="h-10 w-10 text-green-600" />
                  </div>
                  <h3 className="font-serif text-2xl font-semibold mb-3 text-foreground">
                    {uploadedDocIds.length === 1
                      ? t('successOne')
                      : t('successMany', { count: uploadedDocIds.length })}
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    {uploadedDocIds.length === 1 ? t('processingOne') : t('processingMany')}
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    {uploadedDocIds.length === 1 && (
                      <Button variant="secondary" onClick={() => router.push(`/documents/${uploadedDocIds[0]}`)}>
                        {t('viewDoc')}
                      </Button>
                    )}
                    <Button onClick={() => router.push('/')}>
                      {t('toOverview')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* File Errors */}
          {Object.keys(fileErrors).length > 0 && !uploadedDocIds.length && (
            <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10 animate-slide-up">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-red-900 dark:text-red-100 mb-2">
                      {t('fileErrors')}
                    </p>
                    {Object.entries(fileErrors).map(([key, error]) => (
                      <p key={key} className="text-sm text-red-700 dark:text-red-300">
                        {error}
                      </p>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upload Error */}
          {uploadMutation.error && !uploadedDocIds.length && (
            <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10 animate-slide-up">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-900 dark:text-red-100">
                      {t('uploadFailed')}
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                      {authApi.getErrorMessage(uploadMutation.error)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
