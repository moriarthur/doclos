'use client';

import { useState, useEffect, Suspense } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormData } from '@/lib/validation';
import { Loader2, Eye, EyeOff } from 'lucide-react';

// Force dynamic rendering for this page since it uses useSearchParams
export const dynamic = 'force-dynamic';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apiError, setApiError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
  });

  const email = watch('email');
  const password = watch('password');

  // Check authentication and redirect if needed
  useEffect(() => {
    const checkAuth = () => {
      if (authApi.isAuthenticated()) {
        router.push('/');
      } else {
        setIsLoading(false);
      }
    };

    const timer = setTimeout(checkAuth, 100);
    return () => clearTimeout(timer);
  }, [router]);

  // Check if user just registered
  useEffect(() => {
    if (searchParams.get('registered') === 'true') {
      setSuccessMessage('Registrierung erfolgreich! Bitte melden Sie sich an.');
    }
  }, [searchParams]);

  const loginMutation = useMutation({
    mutationFn: (data: LoginFormData) => authApi.login(data),
    onSuccess: () => {
      router.push('/');
    },
    onError: (err: any) => {
      setApiError(authApi.getErrorMessage(err));
    },
  });

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen gradient-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const onSubmit = async (data: LoginFormData) => {
    setApiError('');
    setSuccessMessage('');
    loginMutation.mutate(data);
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
            AI-powered document automation
          </p>
        </div>

        {/* Login Card */}
        <Card>
          <CardContent className="p-8">
            <h2 className="font-serif text-2xl font-semibold mb-8">
              Willkommen zurück
            </h2>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Email */}
              <div>
                <label className="block text-sm font-medium mb-2.5 text-foreground" htmlFor="email">
                  E-Mail
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@beispiel.de"
                  {...register('email')}
                  error={errors.email?.message}
                  autoComplete="email"
                  className="py-3"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium mb-2.5 text-foreground" htmlFor="password">
                  Passwort
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="•••••••••"
                    {...register('password')}
                    error={errors.password?.message}
                    autoComplete="current-password"
                    className="py-3 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-5 -translate-y-1/2 text-border hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password && password.length >= 1 && password.length < 12 && !errors.password && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Mindestens 12 Zeichen erforderlich
                  </p>
                )}
              </div>

              {/* Success Message */}
              {successMessage && !apiError && (
                <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900">
                  <p className="text-sm text-green-700 dark:text-green-400">{successMessage}</p>
                </div>
              )}

              {/* API Error */}
              {apiError && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
                  <p className="text-sm text-red-700 dark:text-red-400">{apiError}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full py-3"
                isLoading={isSubmitting || loginMutation.isPending}
              >
                {isSubmitting || loginMutation.isPending ? 'Anmeldung...' : 'Anmelden'}
              </Button>
            </form>

            <div className="mt-8 text-center">
              <p className="text-sm text-muted-foreground">
                Noch kein Konto?{' '}
                <Link href="/register" className="text-primary hover:underline font-medium">
                  Registrieren
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-10">
          © 2026 Doclos. AI Document Automation für den Mittelstand.
        </p>
      </div>
    </div>
  );
}

// Wrap in Suspense to handle useSearchParams
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen gradient-bg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
