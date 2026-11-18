import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirebaseAdminConfigured } from './firebaseAdmin';

export const BLING_AUTHORIZE_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize';
export const BLING_TOKEN_ENDPOINT = 'https://www.bling.com.br/Api/v3/oauth/token';
export const BLING_TOKEN_FALLBACK_ENDPOINT = 'https://api.bling.com.br/v3/oauth/token';
export const BLING_OFFICIAL_API_BASE = 'https://www.bling.com.br/Api/v3';
export const BLING_API_BASE = 'https://api.bling.com.br/v3';
const BLING_FIRESTORE_DOC = 'integrations/bling';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000; // Renova se faltar menos de 10 minutos para vencer

export interface BlingFirestoreTokenDoc {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Timestamp UTC em milissegundos
  expires_at_iso?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  obtained_at?: number;
  updated_at?: string;
  refreshing_until?: number;
}

interface BlingTokenApiResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string | { message?: string; description?: string };
  error_description?: string;
}

let activeRefreshPromise: Promise<string> | null = null;

export function hasFirebaseAdminEnv(): boolean {
  return isFirebaseAdminConfigured();
}

function getBlingBasicAuthHeader(): string {
  const clientId = (process.env.BLING_CLIENT_ID || '').trim();
  const clientSecret = (process.env.BLING_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('Variáveis BLING_CLIENT_ID e BLING_CLIENT_SECRET não configuradas em process.env.');
  }

  const credentialsBase64 = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  return `Basic ${credentialsBase64}`;
}

function extractJwtExpiresAtMs(token?: string): number {
  if (!token || !token.includes('.')) return 0;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = Buffer.from(payloadB64, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr) as { exp?: unknown };
    if (typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) && parsed.exp > 0) {
      return parsed.exp * 1000;
    }
  } catch {
    // Bling pode emitir token opaco em vez de JWT — ignora silenciosamente
  }
  return 0;
}

function resolveExpiresAtMs(rawExpiresAt: unknown, accessToken?: string): number {
  if (typeof rawExpiresAt === 'number' && Number.isFinite(rawExpiresAt) && rawExpiresAt > 0) {
    return rawExpiresAt;
  }
  if (rawExpiresAt && typeof (rawExpiresAt as Timestamp).toMillis === 'function') {
    return (rawExpiresAt as Timestamp).toMillis();
  }
  if (typeof rawExpiresAt === 'string') {
    const parsed = Date.parse(rawExpiresAt);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return extractJwtExpiresAtMs(accessToken);
}

export function isBlingTokenExpiringOrExpired(
  accessToken: string | undefined,
  expiresAtMs: number,
  thresholdMs: number = REFRESH_THRESHOLD_MS
): boolean {
  if (!accessToken || !accessToken.trim()) return true;
  const jwtExp = extractJwtExpiresAtMs(accessToken);
  const effectiveExpiresAt =
    expiresAtMs > 0 && jwtExp > 0
      ? Math.min(expiresAtMs, jwtExp)
      : (expiresAtMs || jwtExp);

  if (effectiveExpiresAt <= 0) return true;
  return effectiveExpiresAt - Date.now() <= thresholdMs;
}

async function postBlingTokenForm(body: URLSearchParams): Promise<{ status: number; rawText: string; ok: boolean }> {
  const headers = {
    Authorization: getBlingBasicAuthHeader(),
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': 'StreetStore/1.0',
  };

  let response = await fetch(BLING_TOKEN_ENDPOINT, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  if (response.status === 403) {
    response = await fetch(BLING_TOKEN_FALLBACK_ENDPOINT, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
  }

  const rawText = await response.text();
  return { status: response.status, rawText, ok: response.ok };
}

export async function saveBlingTokensToFirestore(payload: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}): Promise<BlingFirestoreTokenDoc> {
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error('Resposta do Bling não retornou access_token e refresh_token válidos.');
  }

  const now = Date.now();
  const expiresInSec = Number(payload.expires_in) || 21600; // 6 horas padrão Bling v3
  const expiresAtMs = now + (payload.expires_in ? expiresInSec * 1000 : SIX_HOURS_MS);

  const docData: BlingFirestoreTokenDoc = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: expiresAtMs,
    expires_at_iso: new Date(expiresAtMs).toISOString(),
    expires_in: expiresInSec,
    token_type: payload.token_type || 'Bearer',
    scope: payload.scope || '',
    obtained_at: now,
    updated_at: new Date(now).toISOString(),
    refreshing_until: 0,
  };

  // Sobrescreve ambos (access_token e refresh_token) + expires_at em integrations/bling
  const db = getAdminFirestore();
  await db.doc(BLING_FIRESTORE_DOC).set(docData, { merge: false });

  return docData;
}

export async function getBlingTokenStatusFromFirestore(): Promise<Partial<BlingFirestoreTokenDoc> | null> {
  if (!hasFirebaseAdminEnv()) return null;
  try {
    const snap = await getAdminFirestore().doc(BLING_FIRESTORE_DOC).get();
    if (!snap.exists) return null;
    return snap.data() as Partial<BlingFirestoreTokenDoc>;
  } catch {
    return null;
  }
}

export async function hasFirestoreBlingToken(): Promise<boolean> {
  const data = await getBlingTokenStatusFromFirestore();
  return Boolean(data && (data.access_token || data.refresh_token));
}

/**
 * Troca o authorization_code recebido em /api/bling/callback pelos primeiros tokens
 * e grava no documento integrations/bling do Firestore.
 */
export async function exchangeBlingCodeForTokens(
  code: string,
  redirectUri?: string
): Promise<BlingFirestoreTokenDoc> {
  const cleanCode = code.trim();
  if (!cleanCode) {
    throw new Error('Parâmetro code é obrigatório para troca no Bling.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: cleanCode,
  });

  const resolvedRedirect = (process.env.BLING_REDIRECT_URI || redirectUri || '').trim();
  if (resolvedRedirect) {
    body.set('redirect_uri', resolvedRedirect);
  }

  const { status, rawText, ok } = await postBlingTokenForm(body);

  let json: BlingTokenApiResponse;
  try {
    json = JSON.parse(rawText) as BlingTokenApiResponse;
  } catch {
    throw new Error(`Bling retornou resposta não-JSON [${status}]: ${rawText}`);
  }

  if (!ok || json.error || !json.access_token || !json.refresh_token) {
    const errDetail =
      (typeof json.error === 'object' ? json.error?.message || json.error?.description : json.error) ||
      json.error_description ||
      rawText;
    throw new Error(`Erro Bling OAuth [${status}]: ${errDetail}`);
  }

  return saveBlingTokensToFirestore(json);
}

/**
 * Renova o par de tokens via grant_type=refresh_token com trava distribuída no Firestore
 * para impedir race-condition entre instâncias serverless paralelas, e sobrescreve
 * o novo access_token, o novo refresh_token e o expires_at em integrations/bling.
 */
export async function refreshBlingTokenInFirestore(
  currentRefreshToken: string,
  options?: { force?: boolean; failedAccessToken?: string }
): Promise<string> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    const db = getAdminFirestore();
    const docRef = db.doc(BLING_FIRESTORE_DOC);

    // 1. Trava distribuída rápida via transação no Firestore para evitar dois containers renovando o mesmo refresh_token único
    let tokenToUse = currentRefreshToken.trim();
    const lockUntil = Date.now() + 15000;
    const failedToken = (options?.failedAccessToken || '').trim();

    try {
      const txResult = await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) {
          return { action: 'proceed' as const, refreshToken: tokenToUse, accessToken: '' };
        }
        const data = snap.data() as Partial<BlingFirestoreTokenDoc>;
        const latestAccess = (data.access_token || '').trim();
        const latestExpires = resolveExpiresAtMs(data.expires_at, latestAccess);
        const latestRefresh = (data.refresh_token || '').trim();

        const isDifferentValidToken = !options?.force || (Boolean(failedToken) && latestAccess !== failedToken);

        // Outra instância acabou de renovar e o token agora é válido (> 10 min)
        if (latestAccess && isDifferentValidToken && !isBlingTokenExpiringOrExpired(latestAccess, latestExpires)) {
          return { action: 'use_existing' as const, accessToken: latestAccess, refreshToken: latestRefresh };
        }

        // Outra instância está renovando neste instante
        if (typeof data.refreshing_until === 'number' && data.refreshing_until > Date.now()) {
          return { action: 'wait_peer' as const, accessToken: latestAccess, refreshToken: latestRefresh };
        }

        tx.set(docRef, { refreshing_until: lockUntil }, { merge: true });
        return {
          action: 'proceed' as const,
          accessToken: latestAccess,
          refreshToken: latestRefresh || tokenToUse,
        };
      });

      if (txResult.action === 'use_existing' && txResult.accessToken) {
        return txResult.accessToken;
      }

      if (txResult.action === 'wait_peer') {
        await new Promise((r) => setTimeout(r, 1200));
        const afterWait = await docRef.get();
        const afterData = afterWait.data() as Partial<BlingFirestoreTokenDoc> | undefined;
        const afterAccess = (afterData?.access_token || '').trim();
        const afterExpires = resolveExpiresAtMs(afterData?.expires_at, afterAccess);
        if (afterAccess && !isBlingTokenExpiringOrExpired(afterAccess, afterExpires) && afterAccess !== failedToken) {
          return afterAccess;
        }
        if (afterData?.refresh_token) {
          tokenToUse = afterData.refresh_token.trim();
        }
      } else if (txResult.refreshToken) {
        tokenToUse = txResult.refreshToken;
      }
    } catch {
      // Continua com tokenToUse caso transação sofra contenção
    }

    if (!tokenToUse) {
      throw new Error('refresh_token ausente em integrations/bling.');
    }

    console.log('[Bling Interceptor] Token expirado ou próximo do vencimento — renovando via refresh_token...');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenToUse,
    });

    const { status, rawText, ok } = await postBlingTokenForm(body);

    let json: BlingTokenApiResponse;
    try {
      json = JSON.parse(rawText) as BlingTokenApiResponse;
    } catch {
      await docRef.set({ refreshing_until: 0 }, { merge: true }).catch(() => {});
      throw new Error(`Erro ao renovar token Bling [${status}]: ${rawText}`);
    }

    if (!ok || json.error || !json.access_token || !json.refresh_token) {
      await docRef.set({ refreshing_until: 0 }, { merge: true }).catch(() => {});

      // Se falhou porque outro processo acabou de rotacionar o refresh_token no Firestore, recupera o novo token!
      const fallbackSnap = await docRef.get().catch(() => null);
      const fallbackData = fallbackSnap?.data() as Partial<BlingFirestoreTokenDoc> | undefined;
      const fallbackRefresh = (fallbackData?.refresh_token || '').trim();
      const fallbackAccess = (fallbackData?.access_token || '').trim();
      const fallbackExpires = resolveExpiresAtMs(fallbackData?.expires_at, fallbackAccess);

      if (
        fallbackAccess &&
        fallbackRefresh &&
        fallbackRefresh !== tokenToUse &&
        fallbackExpires > Date.now() &&
        fallbackAccess !== failedToken
      ) {
        return fallbackAccess;
      }

      const errDetail =
        (typeof json.error === 'object' ? json.error?.message || json.error?.description : json.error) ||
        json.error_description ||
        rawText;
      throw new Error(`Falha ao renovar refresh_token Bling [${status}]: ${errDetail}`);
    }

    const saved = await saveBlingTokensToFirestore(json);
    console.log(`[Bling Interceptor] Token renovado com sucesso (expira em ${saved.expires_at_iso}).`);
    return saved.access_token;
  })().finally(() => {
    activeRefreshPromise = null;
  });

  return activeRefreshPromise;
}

/**
 * Middleware/Função Interceptora (getValidBlingToken):
 * Lê integrations/bling no Firestore, verifica validade (expiração) do access_token
 * e usa refresh_token para renovar de forma transparente antes de qualquer requisição/sincronização.
 */
export async function getValidBlingToken(): Promise<string> {
  const db = getAdminFirestore();
  const snap = await db.doc(BLING_FIRESTORE_DOC).get();

  if (!snap.exists) {
    throw new Error(
      'Documento integrations/bling não encontrado no Firestore. Autorize primeiro via /api/bling/callback?code=...'
    );
  }

  const data = snap.data() as Partial<BlingFirestoreTokenDoc> | undefined;
  const accessToken = (data?.access_token || '').trim();
  const refreshToken = (data?.refresh_token || '').trim();
  const expiresAtMs = resolveExpiresAtMs(data?.expires_at, accessToken);

  if (!refreshToken) {
    throw new Error('Documento integrations/bling sem refresh_token. Refaça a autorização inicial do Bling.');
  }

  if (isBlingTokenExpiringOrExpired(accessToken, expiresAtMs)) {
    return refreshBlingTokenInFirestore(refreshToken);
  }

  return accessToken;
}

export const interceptBlingTokenBeforeSync = getValidBlingToken;

/**
 * Interceptor HTTP completo para todas as requisições à API v3 do Bling:
 * 1. Antes da chamada, valida expiração e renova via refresh_token se expirado ou < 10 min.
 * 2. Trata 429 (Rate Limit) com backoff progressivo.
 * 3. Em 401 inesperado, força renovação via refresh_token e reexecuta transparentemente.
 */
export async function blingApiRequest<T = unknown>(
  endpoint: string,
  init: RequestInit = {},
  rateLimitAttempt: number = 0
): Promise<T> {
  const token = await getValidBlingToken();
  const url = endpoint.startsWith('http') ? endpoint : `${BLING_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'StreetStore/1.0',
      ...(init.headers || {}),
    },
  });

  if (response.status === 429 && rateLimitAttempt < 3) {
    const waitMs = 600 * (rateLimitAttempt + 1);
    await new Promise((r) => setTimeout(r, waitMs));
    return blingApiRequest<T>(endpoint, init, rateLimitAttempt + 1);
  }

  if (response.status === 401) {
    const snap = await getAdminFirestore().doc(BLING_FIRESTORE_DOC).get();
    const currentRefresh = (snap.data()?.refresh_token as string | undefined) || '';
    if (currentRefresh) {
      const freshToken = await refreshBlingTokenInFirestore(currentRefresh, {
        force: true,
        failedAccessToken: token,
      });
      const retryRes = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${freshToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'StreetStore/1.0',
          ...(init.headers || {}),
        },
      });
      if (!retryRes.ok) {
        throw new Error(`Bling API [${retryRes.status}]: ${(await retryRes.text()).slice(0, 300)}`);
      }
      return retryRes.json() as Promise<T>;
    }
  }

  if (!response.ok) {
    throw new Error(`Bling API [${response.status}]: ${(await response.text()).slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

