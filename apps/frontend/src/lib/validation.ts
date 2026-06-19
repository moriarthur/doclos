import { z } from 'zod';

// A translation function for a Validation namespace key.
type T = (key: string) => string;

// Login schema — messages resolved via i18n at form-init time.
export function createLoginSchema(t: T) {
  return z.object({
    email: z
      .string()
      .min(1, t('emailRequired'))
      .email(t('emailInvalid')),
    password: z
      .string()
      .min(1, t('passwordRequired'))
      .min(12, t('passwordMin')),
  });
}

export type LoginFormData = z.infer<ReturnType<typeof createLoginSchema>>;

// Registration schema
export function createRegisterSchema(t: T) {
  const passwordSchema = z.string().min(12, t('passwordMin'));

  return z
    .object({
      name: z
        .string()
        .min(1, t('nameRequired'))
        .min(2, t('nameMin'))
        .max(100, t('nameMax'))
        .trim(),
      email: z
        .string()
        .min(1, t('emailRequired'))
        .email(t('emailInvalid'))
        .trim()
        .toLowerCase(),
      password: passwordSchema,
      confirmPassword: z.string().min(1, t('confirmRequired')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('passwordMismatch'),
      path: ['confirmPassword'],
    });
}

export type RegisterFormData = z.infer<ReturnType<typeof createRegisterSchema>>;
