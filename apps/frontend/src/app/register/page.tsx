'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { authApi, type RegisterData } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createRegisterSchema, type RegisterFormData } from '@/lib/validation';
import { Eye, EyeOff } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations('Register');
  const tCommon = useTranslations('Common');
  const tLogin = useTranslations('Login');
  const tValidation = useTranslations('Validation');
  const [apiError, setApiError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Prevent native form submission (and credential leakage into the URL) before
  // client hydration attaches the React onSubmit handler.
  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(createRegisterSchema(tValidation)),
    mode: 'onBlur',
  });

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');

  const registerMutation = useMutation({
    mutationFn: (data: RegisterData) => authApi.register(data),
    onSuccess: () => {
      router.push('/login?registered=true');
    },
    onError: (err: any) => {
      setApiError(authApi.getErrorMessage(err));
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setApiError('');
    // Only send fields the API expects (exclude confirmPassword)
    const { confirmPassword, ...apiData } = data;
    registerMutation.mutate(apiData);
  };

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl font-bold mb-3 text-primary">
            Doclos
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            {tCommon('brandTagline')}
          </p>
        </div>

        {/* Register Card */}
        <Card>
          <CardContent className="p-8">
            <h2 className="font-serif text-2xl font-semibold mb-8">
              {t('createAccount')}
            </h2>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-2.5 text-foreground" htmlFor="name">
                  {t('name')}
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder={t('namePlaceholder')}
                  {...register('name')}
                  error={errors.name?.message}
                  autoComplete="name"
                  className="py-3"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium mb-2.5 text-foreground" htmlFor="email">
                  {t('email')}
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  {...register('email')}
                  error={errors.email?.message}
                  autoComplete="email"
                  className="py-3"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium mb-2.5 text-foreground" htmlFor="password">
                  {t('password')}
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('passwordPlaceholder')}
                    {...register('password')}
                    error={errors.password?.message}
                    autoComplete="new-password"
                    className="py-3 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-5 -translate-y-1/2 text-border hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? tLogin('hidePassword') : tLogin('showPassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password && password.length >= 1 && password.length < 12 && !errors.password && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('passwordRemaining', { n: 12 - password.length })}
                  </p>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium mb-2.5 text-foreground" htmlFor="confirmPassword">
                  {t('confirmPassword')}
                </label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder={t('confirmPlaceholder')}
                    {...register('confirmPassword')}
                    error={errors.confirmPassword?.message}
                    autoComplete="new-password"
                    className="py-3 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-5 -translate-y-1/2 text-border hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? tLogin('hidePassword') : tLogin('showPassword')}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* Real-time match indicator */}
                {confirmPassword && !errors.confirmPassword && (
                  <p className="mt-1.5 text-xs">
                    {password === confirmPassword ? (
                      <span className="text-green-600 dark:text-green-400">{t('match')}</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">{t('mismatch')}</span>
                    )}
                  </p>
                )}
              </div>

              {/* API Error */}
              {apiError && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
                  <p className="text-sm text-red-700 dark:text-red-400">{apiError}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full py-3"
                isLoading={isSubmitting || registerMutation.isPending}
                disabled={!mounted || (!!errors.confirmPassword && password !== confirmPassword)}
              >
                {isSubmitting || registerMutation.isPending ? t('submitting') : t('submit')}
              </Button>
            </form>

            <div className="mt-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t('haveAccount')}{' '}
                <Link href="/login" className="text-primary hover:underline font-medium">
                  {t('signIn')}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-10">
          {tCommon('footer')}
        </p>
      </div>
    </div>
  );
}
