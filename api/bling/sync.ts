import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  syncAllBlingProdutosToFirestore,
  syncBlingProdutosPageToFirestore,
  verifySyncSecret,
} from '../../lib/blingSyncProdutos';
import { interceptBlingTokenBeforeSync } from '../../lib/blingToken';

function extractSecretFromReq(req: VercelRequest): string {
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
  const headerCron = req.headers['x-cron-secret'];
  const headerAdmin = req.headers['x-admin-secret'];
  const authHeader = req.headers.authorization || '';

  if (querySecret) return querySecret;
  if (typeof headerCron === 'string' && headerCron) return headerCron;
  if (typeof headerAdmin === 'string' && headerAdmin) return headerAdmin;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

/**
 * Vercel Serverless Function: GET/POST /api/bling/sync
 * - Sem ?pagina= (ou com ?all=true): executa auto-loop seguro de páginas via db.batch()
 *   respeitando orçamento de tempo da Vercel (retornando proximaPagina se necessário).
 * - Com ?pagina=N: processa a página N (100 produtos ativos + estoque + imagens .link) via db.batch().
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  }

  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (cronSecret) {
    const providedSecret = extractSecretFromReq(req);
    if (!verifySyncSecret(providedSecret)) {
      return res.status(401).json({
        error: 'Não autorizado. Informe CRON_SECRET válido via header ou ?secret=.',
      });
    }
  }

  if (req.query.verify === 'true') {
    return res.status(200).json({ authorized: true });
  }

  try {
    // Middleware de interrupção pré-sincronização: valida expiração e renova via refresh_token antes de qualquer chamada ao Bling
    await interceptBlingTokenBeforeSync();

    const hasExplicitPage = typeof req.query.pagina === 'string' && req.query.pagina.trim() !== '';
    const autoAll = req.query.all === 'true' || !hasExplicitPage || req.query.chain === '1';

    if (autoAll) {
      const startPageRaw = typeof req.query.pagina === 'string' ? req.query.pagina : '1';
      const startPage = Math.max(1, parseInt(startPageRaw, 10) || 1);
      const hop = Math.max(0, parseInt(String(req.query.hop || '0'), 10) || 0);
      const maxMsRaw = typeof req.query.maxMs === 'string' ? parseInt(req.query.maxMs, 10) : 0;
      const shouldEnrich = req.query.enrich === 'true';

      const result = await syncAllBlingProdutosToFirestore({
        startPage,
        maxExecutionMs: maxMsRaw > 0 ? Math.min(55000, maxMsRaw) : 8200,
        enrichHighResImages: shouldEnrich,
      });

      // Se o catálogo ultrapassar 8.2s numa única chamada serverless, encadeia automaticamente a próxima página
      let continuationDispatched = false;
      if (
        result.paradoPorTempoLimite &&
        !result.finalizado &&
        result.proximaPagina &&
        hop < 15 &&
        req.headers.host
      ) {
        const protocol = String(req.headers['x-forwarded-proto'] || 'https');
        const nextUrl = `${protocol}://${req.headers.host}/api/bling/sync?pagina=${result.proximaPagina}&chain=1&hop=${hop + 1}`;
        const headers: Record<string, string> = {};
        if (cronSecret) {
          headers.Authorization = `Bearer ${cronSecret}`;
        }
        try {
          const controller = new AbortController();
          const abortTimer = setTimeout(() => controller.abort(), 1200);
          await fetch(nextUrl, { method: 'GET', headers, signal: controller.signal }).catch(() => null);
          clearTimeout(abortTimer);
          continuationDispatched = true;
        } catch {
          // Não bloqueia resposta do cron
        }
      }

      return res.status(200).json({
        ok: true,
        executedAt: new Date().toISOString(),
        continuationDispatched,
        ...result,
      });
    }

    const pagina = Math.max(1, parseInt(String(req.query.pagina), 10) || 1);
    const result = await syncBlingProdutosPageToFirestore(pagina);
    return res.status(200).json({
      ok: true,
      executedAt: new Date().toISOString(),
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Vercel /api/bling/sync Error]:', message);

    const isPendingAuth =
      message.includes('integrations/bling não encontrado') ||
      message.includes('sem refresh_token');

    return res.status(isPendingAuth ? 200 : 500).json({
      ok: false,
      success: false,
      pendingAuth: isPendingAuth,
      error: message,
      executedAt: new Date().toISOString(),
    });
  }
}
