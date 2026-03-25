import { z } from 'zod';

// Password requirements: at least 12 characters
const passwordSchema = z
  .string()
  .min(12, 'Passwort muss mindestens 12 Zeichen lang sein');

// Login schema
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'E-Mail ist erforderlich')
    .email('Ungültige E-Mail-Adresse'),
  password: z
    .string()
    .min(1, 'Passwort ist erforderlich')
    .min(12, 'Passwort muss mindestens 12 Zeichen lang sein'),
});

export type LoginFormData = z.infer<typeof loginSchema>;

// Registration schema
export const registerSchema = z.object({
  name: z
    .string()
    .min(1, 'Name ist erforderlich')
    .min(2, 'Name muss mindestens 2 Zeichen lang sein')
    .max(100, 'Name darf maximal 100 Zeichen lang sein')
    .trim(),
  email: z
    .string()
    .min(1, 'E-Mail ist erforderlich')
    .email('Ungültige E-Mail-Adresse')
    .trim()
    .toLowerCase(),
  password: passwordSchema,
  confirmPassword: z
    .string()
    .min(1, 'Passwortbestätigung ist erforderlich'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwörter stimmen nicht überein',
  path: ['confirmPassword'],
});

export type RegisterFormData = z.infer<typeof registerSchema>;
