import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

/** Request config augmented by the 401-refresh interceptor's bookkeeping. */
type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// Same-origin by default: the browser calls /api/v1 on the frontend origin
// and next.config.js rewrites it to BACKEND_ORIGIN (server-side), so a
// deployed frontend never references localhost. Set NEXT_PUBLIC_API_URL only
// for cross-origin deployments (separate API domain); the backend must then
// allow that frontend origin via FRONTEND_URL.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

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
    'No invoices to export': 'Keine Daten für den Export',
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
    'No invoices to export': 'No data to export',
    'Not found': 'Not found',
    _fallback: 'An unexpected error occurred',
  },
} as const;

// Helper to extract error message from response
const getErrorMessage = (error: unknown): string => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  const map = errorMaps[getLocale()];
  if (!data) return map._fallback;

  const message = (data as { message?: unknown })?.message;

  // Handle array of messages (validation errors)
  if (Array.isArray(message)) {
    return message
      .map((msg) => (map as Record<string, string>)[String(msg)] || String(msg))
      .join(', ');
  }

  // Handle single message string
  if (typeof message === 'string') {
    return (map as Record<string, string>)[message] || message;
  }

  // Fallback
  return map._fallback;
};

// PD-A1 (public-demo audit): the browser holds NO token material anymore —
// access/refresh live in HttpOnly cookies set by the backend through the
// same-origin proxy. The only JS-readable cookie is csrf_token (double-submit,
// not a credential) and the logged_in marker for pure-UX checks.

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const setMarkerCookie = (name: string, value: string, days = 7) => {
  if (typeof window === 'undefined') return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
};

const deleteMarkerCookie = (name: string) => {
  if (typeof window === 'undefined') return;
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
};

const LOGGED_IN_MARKER = 'logged_in';

/**
 * PD-A3: make sure a csrf_token cookie exists before a state-changing call.
 * Idempotent — skips the round-trip when the cookie is already there.
 */
export const ensureCsrfToken = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (readCookie('csrf_token')) return;
  await apiClient.get('/auth/csrf');
};

// Create axios instance
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// PD-A3: echo the csrf_token cookie in the double-submit header on every
// state-changing request. Cross-site pages can send cookies but cannot read
// them, so they cannot produce this header.
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const method = (config.method || 'get').toLowerCase();
    if (!['get', 'head', 'options'].includes(method)) {
      const csrf = readCookie('csrf_token');
      if (csrf) {
        config.headers['X-CSRF-Token'] = csrf;
      }
    }
  }
  return config;
});

// Handle token refresh on 401
let isRefreshing = false;
let refreshPromise: Promise<unknown> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      const isAuthEndpoint = originalRequest?.url?.includes('/auth/login') ||
                             originalRequest?.url?.includes('/auth/register') ||
                             originalRequest?.url?.includes('/auth/refresh');

      if (isAuthEndpoint) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      // PD-A1: cookie-only rotation — the HttpOnly refresh cookie rides along
      // with the POST automatically; the response re-sets fresh cookies.
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = apiClient.post('/auth/refresh')
          .catch(() => {
            // Refresh failed — the session is dead (the backend already
            // revoked the chain and cleared the cookies).
            deleteMarkerCookie(LOGGED_IN_MARKER);
            window.location.href = '/login';
            return Promise.reject(error);
          })
          .finally(() => {
            isRefreshing = false;
            refreshPromise = null;
          });
      }

      // Wait for the refresh to complete, then retry the original request —
      // no header rewrite needed: the new access cookie is sent automatically.
      try {
        await refreshPromise;
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

// PD-A1: tokens never appear in API responses — bodies carry identifiers or
// a message only.
export interface AuthResponse {
  user_id?: string;
  message?: string;
}

export interface Document {
  id: string;
  type: string;
  status: string;
  company_name?: string;
  invoice_number?: string;
  // P2-10 (audit): pg numeric(12,2) arrives as a string over the wire
  amount?: number | string;
  currency?: string;
  invoice_date?: string;
  created_at: string;
}

// --- Document detail (GET /documents/:id) — S5.2 per-type UI ----------------
export type DocumentType =
  | 'invoice'
  | 'contract'
  | 'offer'
  | 'delivery_note'
  | 'purchase_order'
  | 'unknown';

/** Extraction diagnostic for a single field (value + model confidence). */
export interface FieldWithConfidence {
  value: string;
  confidence?: number;
}

export interface InvoiceItemDto {
  description: string | null;
  quantity: number | null;
  // U-4: quantity unit (Stück, Stk., Std., ...) — null when not stated.
  unit: string | null;
  unit_price: number | null;
  // Matches the backend entity column (was wrongly typed total_price before).
  line_total: number | null;
}

/** Shared invoice-carrier shape (invoice / purchase_order / offer / delivery_note). */
export interface InvoiceDetailDto {
  invoice_number?: FieldWithConfidence;
  amount_total?: FieldWithConfidence;
  currency?: string;
  invoice_date?: string;
  due_date?: string;
  supplier_name?: FieldWithConfidence;
  supplier_address?: FieldWithConfidence;
  items: InvoiceItemDto[];
}

export interface ExtractionIssue {
  severity: 'missing' | 'review';
  message: { de: string; en: string };
}

// Per-type metadata (S5.1 storage). All fields nullable — extraction may miss any.
export interface PurchaseOrderMetadata {
  customer_name?: string | null;
  expected_delivery_date?: string | null;
  delivery_terms?: string | null;
  payment_terms?: string | null;
}
export interface OfferMetadata {
  customer_name?: string | null;
  validity_date?: string | null;
  validity_terms?: string | null;
}
export interface DeliveryNoteMetadata {
  delivery_note_number?: string | null;
  delivery_date?: string | null;
  recipient_name?: string | null;
  recipient_address?: string | null;
  order_reference?: string | null;
}
export interface ContractMetadata {
  seller_name?: string | null;
  buyer_name?: string | null;
  effective_date?: string | null;
  end_date?: string | null;
  contract_value?: number | null;
  currency?: string | null;
  subject?: string | null;
  term_description?: string | null;
}

export interface DocumentDetail {
  id: string;
  type: DocumentType;
  status: string;
  file_url: string;
  mime_type: string;
  original_filename: string;
  extraction_confidence: number | null;
  extraction_issues: ExtractionIssue[] | null;
  metadata: Record<string, unknown> | null;
  invoice?: InvoiceDetailDto;
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
    // PD-A3: login is state-changing — make sure the csrf cookie exists first.
    await ensureCsrfToken();
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    // PD-A1: session cookies are HttpOnly and set by the backend through the
    // proxy. Only the UX marker lives in JS-land.
    setMarkerCookie(LOGGED_IN_MARKER, '1');
    return response.data;
  },

  // PD-A4: registration never opens a session and never reveals whether the
  // email was taken — the uniform success message routes the user to login.
  register: async (data: RegisterData): Promise<AuthResponse> => {
    await ensureCsrfToken();
    const response = await apiClient.post<AuthResponse>('/auth/register', data);
    return response.data;
  },

  // PD-A2: server-side logout — revokes the refresh session; the backend
  // clears the HttpOnly cookies. Best-effort: local cleanup runs regardless.
  logout: async (): Promise<void> => {
    try {
      await ensureCsrfToken();
      await apiClient.post('/auth/logout');
    } catch {
      // Network errors must not strand the user in a logged-in-looking UI.
    } finally {
      if (typeof window !== 'undefined') {
        deleteMarkerCookie(LOGGED_IN_MARKER);
      }
    }
  },

  isAuthenticated: (): boolean => {
    if (typeof window === 'undefined') return false;
    // Purely a UX check — page protection is the middleware's job (it sees
    // the HttpOnly cookie server-side).
    return readCookie(LOGGED_IN_MARKER) === '1';
  },

  getErrorMessage, // Export helper for use in components
};

export const documentsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    exclude_status?: string;
    company?: string;
    from_date?: string;
    to_date?: string;
  }): Promise<DocumentsResponse> => {
    const response = await apiClient.get<DocumentsResponse>('/documents', { params });
    return response.data;
  },

  // Server-side full-text search. Same response shape as `list`, so the
  // dashboard cards render identically. Returns all matches (server-paginated),
  // including documents beyond the first page the client-side filter missed.
  search: async (params: {
    q: string;
    page?: number;
    limit?: number;
    status?: string;
    type?: string;
    from_date?: string;
    to_date?: string;
  }): Promise<DocumentsResponse> => {
    const response = await apiClient.get<DocumentsResponse>('/search', { params });
    return response.data;
  },

  // P1-6 (audit): fetch the raw file through apiClient so the 401-refresh
  // interceptor applies (DocumentViewer previously used raw fetch with the
  // non-cookie request, which failed once the 15-min access token expired)
  getFile: async (id: string): Promise<Blob> => {
    const response = await apiClient.get<Blob>(`/documents/${id}/file`, {
      responseType: 'blob',
    });
    return response.data;
  },

  upload: async (
    file: File,
    type?: string,
    onProgress?: (percent: number) => void,
  ): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    if (type) formData.append('type', type);

    const response = await apiClient.post<UploadResponse>('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      // U-5 (audit): real byte-level upload progress instead of a simulated bar
      onUploadProgress: (e) => {
        if (!onProgress) return;
        const total = e.total ?? file.size;
        if (total > 0) onProgress(Math.round((e.loaded / total) * 100));
      },
    });
    return response.data;
  },

  getDetail: async (id: string): Promise<DocumentDetail> => {
    const response = await apiClient.get<DocumentDetail>(`/documents/${id}`);
    return response.data;
  },

  validate: async (
    id: string,
    fields: Record<string, unknown>,
    items?: Array<Record<string, unknown>>,
  ) => {
    // P2-1 (audit): wire contract — empty input means "clear this field"
    // (explicit null); amount_total travels as a number
    const payload: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(fields)) {
      const value = typeof raw === 'string' ? raw.trim() : raw;
      if (value === '') payload[key] = null;
      else if (key === 'amount_total') payload[key] = value === null ? null : Number(value);
      else payload[key] = value;
    }
    // U-4: when the items table was edited the full list replaces all stored
    // rows (backend replace-all semantics); undefined = items untouched.
    const body: Record<string, unknown> = { fields: payload };
    if (items) body.items = items;
    const response = await apiClient.patch(`/documents/${id}/validate`, body);
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
    // P2-2 (audit): dedicated endpoint — the old magic 'unarchive' PATCH body
    // is rejected by the status DTO now
    const response = await apiClient.post(`/documents/${id}/unarchive`);
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

export const exportApi = {
  // List export — all of the user's invoices matching filters (dashboard).
  // Returns a Blob (the .xlsx) for an in-browser download trigger.
  list: async (params: {
    format: string;
    status?: string;
    company?: string;
    from_date?: string;
    to_date?: string;
    ids?: string[];
  }): Promise<Blob> => {
    const response = await apiClient.get(`/export/${encodeURIComponent(params.format)}`, {
      params: {
        status: params.status || undefined,
        company: params.company || undefined,
        from_date: params.from_date || undefined,
        to_date: params.to_date || undefined,
        ids: params.ids && params.ids.length > 0 ? params.ids.join(',') : undefined,
        lang: getLocale(),
      },
      responseType: 'blob',
    });
    return response.data;
  },

  // Detail export — a single document's invoice report (Document Details).
  detail: async (documentId: string, format: string): Promise<Blob> => {
    const response = await apiClient.get(
      `/export/document/${documentId}/${encodeURIComponent(format)}`,
      { params: { lang: getLocale() }, responseType: 'blob' },
    );
    return response.data;
  },
};

// PD-D1 (public-demo audit): per-user synthetic sample — runs the real
// pipeline under the caller's own tenant. 1/day/user server-side.
export const demoApi = {
  createSample: async (): Promise<{ document_id: string; status: string }> => {
    const response = await apiClient.post<{ document_id: string; status: string }>(
      '/demo/sample',
    );
    return response.data;
  },

  // Deletes ONLY the current user's synthetic sample documents.
  resetSample: async (): Promise<{ deleted: number }> => {
    const response = await apiClient.delete<{ deleted: number }>('/demo/sample');
    return response.data;
  },
};
