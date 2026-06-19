import axios, { AxiosError } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

// Helper to read the active locale from the cookie (single-path i18n).
function getLocale(): 'de' | 'en' {
  if (typeof document === 'undefined') return 'de';
  return /(?:^|; )locale=en/.test(document.cookie) ? 'en' : 'de';
}

// Backend error messages mapped per locale.
const errorMaps = {
  de: {
    'User already exists': 'Diese E-Mail ist bereits registriert',
    'Invalid credentials': 'Ungültige Anmeldedaten',
    'Unauthorized': 'Nicht autorisiert',
    'Forbidden': 'Zugriff verweigert',
    'User not found': 'Benutzer nicht gefunden',
    'Invalid token': 'Ungültiges Token',
    'Token expired': 'Token abgelaufen',
    'email must be an email': 'Ungültige E-Mail-Adresse',
    'password must be longer than or equal to 12 characters': 'Passwort muss mindestens 12 Zeichen lang sein',
    'name must be longer than or equal to 2 characters': 'Name muss mindestens 2 Zeichen lang sein',
    'name should not be empty': 'Name darf nicht leer sein',
    'Document not found': 'Dokument nicht gefunden',
    'File type not supported': 'Dateityp nicht unterstützt',
    'File too large': 'Datei zu groß',
    'Internal server error': 'Interner Serverfehler',
    'Bad request': 'Ungültige Anfrage',
    'Not found': 'Nicht gefunden',
    _fallback: 'Ein unerwarteter Fehler ist aufgetreten',
  },
  en: {
    'User already exists': 'This email is already registered',
    'Invalid credentials': 'Invalid credentials',
    'Unauthorized': 'Unauthorized',
    'Forbidden': 'Forbidden',
    'User not found': 'User not found',
    'Invalid token': 'Invalid token',
    'Token expired': 'Token expired',
    'email must be an email': 'Invalid email address',
    'password must be longer than or equal to 12 characters': 'Password must be at least 12 characters long',
    'name must be longer than or equal to 2 characters': 'Name must be at least 2 characters long',
    'name should not be empty': 'Name must not be empty',
    'Document not found': 'Document not found',
    'File type not supported': 'File type not supported',
    'File too large': 'File too large',
    'Internal server error': 'Internal server error',
    'Bad request': 'Bad request',
    'Not found': 'Not found',
    _fallback: 'An unexpected error occurred',
  },
} as const;

// Helper to extract error message from response
const getErrorMessage = (error: any): string => {
  const data = error.response?.data;
  const map = errorMaps[getLocale()];
  if (!data) return map._fallback;

  // Handle array of messages (validation errors)
  if (Array.isArray(data.message)) {
    return data.message
      .map((msg: string) => (map as Record<string, string>)[msg] || msg)
      .join(', ');
  }

  // Handle single message string
  if (typeof data.message === 'string') {
    return (map as Record<string, string>)[data.message] || data.message;
  }

  // Fallback
  return map._fallback;
};

// Helper to set cookies on client side
const setCookie = (name: string, value: string, days = 7) => {
  if (typeof window === 'undefined') return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  // Set cookie with SameSite=Lax for better compatibility
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
};

const deleteCookie = (name: string) => {
  if (typeof window === 'undefined') return;
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
};

// Create axios instance
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle token refresh on 401
let isRefreshing = false;
let refreshPromise: Promise<any> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError & { config?: any }) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      const isAuthEndpoint = originalRequest?.url?.includes('/auth/login') ||
                             originalRequest?.url?.includes('/auth/register') ||
                             originalRequest?.url?.includes('/auth/refresh');

      if (isAuthEndpoint) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      // Try to refresh the token
      if (!isRefreshing) {
        isRefreshing = true;
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          refreshPromise = apiClient.post('/auth/refresh', { refresh_token: refreshToken })
            .then((res) => {
              const { access_token, refresh_token } = res.data;
              localStorage.setItem('access_token', access_token);
              localStorage.setItem('refresh_token', refresh_token);
              setCookie('access_token', access_token);
              setCookie('refresh_token', refresh_token);
              return res;
            })
            .catch(() => {
              // Refresh failed — clear tokens
              localStorage.removeItem('access_token');
              localStorage.removeItem('refresh_token');
              deleteCookie('access_token');
              deleteCookie('refresh_token');
              window.location.href = '/login';
              return Promise.reject(error);
            })
            .finally(() => {
              isRefreshing = false;
              refreshPromise = null;
            });
        } else {
          localStorage.removeItem('access_token');
          deleteCookie('access_token');
          window.location.href = '/login';
          return Promise.reject(error);
        }
      }

      // Wait for the refresh to complete, then retry the original request
      try {
        await refreshPromise;
        const token = localStorage.getItem('access_token');
        if (token) {
          originalRequest.headers.Authorization = `Bearer ${token}`;
        }
        return apiClient(originalRequest);
      } catch {
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

// API Types
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user_id?: string;
}

export interface Document {
  id: string;
  type: string;
  status: string;
  company_name?: string;
  invoice_number?: string;
  amount?: number;
  currency?: string;
  invoice_date?: string;
  created_at: string;
}

export interface DocumentsResponse {
  data: Document[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface UploadResponse {
  document_id: string;
  status: string;
}

// API Functions
export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    // Store tokens in both localStorage and cookies
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', response.data.access_token);
      localStorage.setItem('refresh_token', response.data.refresh_token);
      setCookie('access_token', response.data.access_token);
      setCookie('refresh_token', response.data.refresh_token);
    }
    return response.data;
  },

  register: async (data: RegisterData): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/register', data);
    return response.data;
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      deleteCookie('access_token');
      deleteCookie('refresh_token');
    }
  },

  isAuthenticated: (): boolean => {
    if (typeof window === 'undefined') return false;
    const hasLocalStorage = !!localStorage.getItem('access_token');
    // Also check cookies
    const hasCookie = document.cookie.includes('access_token=');
    return hasLocalStorage || hasCookie;
  },

  getErrorMessage, // Export helper for use in components
};

export const documentsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    company?: string;
    from_date?: string;
    to_date?: string;
  }): Promise<DocumentsResponse> => {
    const response = await apiClient.get<DocumentsResponse>('/documents', { params });
    return response.data;
  },

  upload: async (file: File, type?: string): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    if (type) formData.append('type', type);

    const response = await apiClient.post<UploadResponse>('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  getDetail: async (id: string) => {
    const response = await apiClient.get(`/documents/${id}`);
    return response.data;
  },

  validate: async (id: string, fields: Record<string, unknown>) => {
    const response = await apiClient.patch(`/documents/${id}/validate`, { fields });
    return response.data;
  },

  reprocess: async (id: string) => {
    const response = await apiClient.post(`/documents/${id}/reprocess`);
    return response.data;
  },

  updateStatus: async (id: string, status: string) => {
    const response = await apiClient.patch(`/documents/${id}`, { status });
    return response.data;
  },

  unarchive: async (id: string) => {
    // Special call to unarchive - backend will restore previous status
    const response = await apiClient.patch(`/documents/${id}`, { status: 'unarchive' });
    return response.data;
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/documents/${id}`);
    return response.data;
  },
};

export const jobsApi = {
  getStatus: async (id: string) => {
    const response = await apiClient.get(`/jobs/${id}`);
    return response.data;
  },

  getDocumentJob: async (documentId: string) => {
    const response = await apiClient.get(`/jobs?document_id=${documentId}`);
    return response.data;
  },

  cancelJob: async (jobId: string) => {
    const response = await apiClient.delete(`/jobs/${jobId}`);
    return response.data;
  },

  cancelByDocument: async (documentId: string) => {
    const response = await apiClient.delete(`/jobs?document_id=${documentId}`);
    return response.data;
  },
};
