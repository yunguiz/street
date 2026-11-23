import fs from 'fs';
import path from 'path';
import { loadBlingTokens, fetchFromBling } from './server-bling';
import { Product } from './src/types';

const IMAGES_STORE_FILE = path.resolve(process.cwd(), '.bling_product_images.json');

export interface BlingImageStore {
  updatedAt: string;
  bySku: Record<string, string[]>;
  byName: Record<string, string[]>;
  byId: Record<string, string[]>;
}

let cachedImageStore: BlingImageStore | null = null;

export function loadImageStore(): BlingImageStore {
  if (cachedImageStore) return cachedImageStore;
  try {
    if (fs.existsSync(IMAGES_STORE_FILE)) {
      const raw = fs.readFileSync(IMAGES_STORE_FILE, 'utf-8');
      cachedImageStore = JSON.parse(raw);
      return cachedImageStore!;
    }
  } catch (err) {
    console.warn('[Bling Images] Could not read image store file:', err);
  }

  cachedImageStore = {
    updatedAt: new Date().toISOString(),
    bySku: {},
    byName: {},
    byId: {}
  };
  return cachedImageStore;
}

export function saveImageStore(store: BlingImageStore): void {
  cachedImageStore = store;
  store.updatedAt = new Date().toISOString();
  try {
    fs.writeFileSync(IMAGES_STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Bling Images] Could not save image store file:', err);
  }
}

/**
 * Normalizes product name for robust matching (e.g. "TENIS TESLA HERTZ BLACK:39" -> "tenis tesla hertz black")
 */
export function normalizeProductName(name: string): string {
  let n = (name || '').toLowerCase().trim();
  if (n.includes(':')) n = n.split(':')[0].trim();
  if (n.includes(' // ')) n = n.split(' // ')[0].trim();
  n = n.replace(/\s+-\s+(pp|p|m|g|gg|xg|xgg|g1|g2|\d{2})$/i, '').trim();
  return n.replace(/\s+/g, ' ');
}

/**
 * Extracts all valid image URLs from any Bling API v3 or webhook product payload
 */
export function extractImagesFromBlingItem(item: any): string[] {
  if (!item) return [];
  const urls: string[] = [];

  const addUrl = (val: any) => {
    if (typeof val === 'string' && (val.trim().startsWith('http') || val.trim().startsWith('/') || val.trim().startsWith('data:image'))) {
      const clean = val.trim();
      if (!urls.includes(clean)) urls.push(clean);
    }
  };

  // 1. item.imagemURL (standard Bling v3 field)
  if (item.imagemURL) addUrl(item.imagemURL);
  if (item.imagem) addUrl(item.imagem);

  // 2. item.anexos (array of attachment objects)
  if (Array.isArray(item.anexos)) {
    item.anexos.forEach((a: any) => {
      if (typeof a === 'string') addUrl(a);
      else if (a && typeof a === 'object') {
        addUrl(a.url || a.link || a.caminho || a.thumbnail);
      }
    });
  }

  // 3. item.anexo (single attachment object)
  if (item.anexo) {
    if (typeof item.anexo === 'string') addUrl(item.anexo);
    else if (typeof item.anexo === 'object') {
      addUrl(item.anexo.url || item.anexo.link || item.anexo.caminho);
    }
  }

  // 4. item.midia (Bling API v3 media object)
  if (item.midia?.imagens?.externas && Array.isArray(item.midia.imagens.externas)) {
    item.midia.imagens.externas.forEach((img: any) => {
      addUrl(img.link || img.url);
    });
  }
  if (item.midia?.imagens?.internas && Array.isArray(item.midia.imagens.internas)) {
    item.midia.imagens.internas.forEach((img: any) => {
      addUrl(img.link || img.url);
    });
  }

  // 5. item.imagens (generic array)
  if (Array.isArray(item.imagens)) {
    item.imagens.forEach((img: any) => {
      if (typeof img === 'string') addUrl(img);
      else if (img && typeof img === 'object') addUrl(img.url || img.link);
    });
  }

  // 6. item.fotos (legacy format)
  if (Array.isArray(item.fotos)) {
    item.fotos.forEach((f: any) => {
      if (typeof f === 'string') addUrl(f);
      else if (f && typeof f === 'object') addUrl(f.url || f.link || f.foto);
    });
  }

  return urls;
}

/**
 * Saves image URLs for a specific product
 */
export function recordProductImage(
  identifier: { sku?: string; name?: string; id?: string | number },
  images: string[]
): void {
  if (!images || images.length === 0) return;
  const store = loadImageStore();

  const validImages = images.filter(u => typeof u === 'string' && (u.trim().startsWith('http') || u.trim().startsWith('/') || u.trim().startsWith('data:image')));
  if (validImages.length === 0) return;

  if (identifier.sku) {
    const s = identifier.sku.toUpperCase().trim();
    store.bySku[s] = validImages;
  }
  if (identifier.id) {
    const i = String(identifier.id).trim();
    store.byId[i] = validImages;
  }
  if (identifier.name) {
    const n = normalizeProductName(identifier.name);
    if (n) store.byName[n] = validImages;
  }

  saveImageStore(store);
}

/**
 * Gets real Bling images for a given product
 */
export function getBlingImagesForProduct(product: Partial<Product> | any): string[] | null {
  const store = loadImageStore();

  // 1. By SKU
  const sku = product.integration?.sku || product.sku;
  if (sku) {
    const s = String(sku).toUpperCase().trim();
    if (store.bySku[s] && store.bySku[s].length > 0) return store.bySku[s];
  }

  // 2. By variant SKUs
  if (Array.isArray(product.variantsList)) {
    for (const v of product.variantsList) {
      if (v.sku) {
        const vs = String(v.sku).toUpperCase().trim();
        if (store.bySku[vs] && store.bySku[vs].length > 0) return store.bySku[vs];
      }
    }
  }

  // 3. By Bling ID
  const blingId = product.integration?.blingId || product.blingId;
  if (blingId) {
    const bId = String(blingId).trim();
    if (store.byId[bId] && store.byId[bId].length > 0) return store.byId[bId];
  }

  // 4. By normalized product name
  if (product.name) {
    const n = normalizeProductName(product.name);
    if (store.byName[n] && store.byName[n].length > 0) return store.byName[n];

    // Substring / fuzzy match across stored names
    for (const [storedName, imgs] of Object.entries(store.byName)) {
      if (imgs.length > 0 && storedName.length >= 8 && (n.includes(storedName) || storedName.includes(n))) {
        return imgs;
      }
    }
  }

  return null;
}

/**
 * Injects real Bling images into products array, giving them top priority
 */
export function applyBlingImageOverrides<T extends { images?: string[]; [key: string]: any } = Product>(products: T[]): T[] {
  return products.map(product => {
    const realImages = getBlingImagesForProduct(product);
    if (realImages && realImages.length > 0) {
      const existing = Array.isArray(product.images) ? product.images : [];
      // Real Bling images come first, followed by existing non-duplicate images
      const combined = [
        ...realImages,
        ...existing.filter((img: string) => !realImages.includes(img))
      ];
      return {
        ...product,
        images: combined
      };
    }
    return product;
  });
}

/**
 * Synchronizes all images from Bling ERP API v3 and Nuvemshop
 */
export async function syncImagesFromBlingAndNuvemshop(options: {
  fetchFromNuvemshopFn?: (endpoint: string) => Promise<any>;
} = {}): Promise<{
  success: boolean;
  updatedCount: number;
  totalWithImages: number;
  sources: { bling: number; nuvemshop: number };
  message: string;
}> {
  const store = loadImageStore();
  let blingCount = 0;
  let nuvemCount = 0;

  // 1. Sync from Nuvemshop (often Nuvemshop already has the synced images from Bling!)
  if (options.fetchFromNuvemshopFn) {
    try {
      const nuvemProducts = await options.fetchFromNuvemshopFn('/products?per_page=200&page=1');
      if (Array.isArray(nuvemProducts)) {
        nuvemProducts.forEach((np: any) => {
          const imgUrls = (np.images || []).map((img: any) => img.src).filter(Boolean);
          if (imgUrls.length > 0) {
            const rawTitle = np.name?.pt || np.name || '';
            const normTitle = normalizeProductName(rawTitle);
            if (normTitle) {
              store.byName[normTitle] = imgUrls;
              nuvemCount++;
            }
            if (Array.isArray(np.variants)) {
              np.variants.forEach((v: any) => {
                if (v.sku) {
                  store.bySku[v.sku.toUpperCase().trim()] = imgUrls;
                }
              });
            }
          }
        });
        console.log(`[Bling Image Sync] Mapped images from ${nuvemCount} Nuvemshop products.`);
      }
    } catch (nuvemErr: any) {
      console.warn('[Bling Image Sync] Nuvemshop sync notice:', nuvemErr?.message || nuvemErr);
    }
  }

  // 2. Sync directly from Bling API v3 if tokens are available
  const tokens = loadBlingTokens();
  if (tokens?.access_token) {
    try {
      console.log('[Bling Image Sync] Querying Bling API v3 /produtos for updated images...');
      for (let p = 1; p <= 15; p++) {
        const pageData = await fetchFromBling(`/produtos?pagina=${p}&limite=100`);
        const items = pageData?.data || [];
        if (items.length === 0) break;

        for (const item of items) {
          const extracted = extractImagesFromBlingItem(item);
          if (extracted.length > 0) {
            if (item.codigo) store.bySku[item.codigo.toUpperCase().trim()] = extracted;
            if (item.id) store.byId[String(item.id)] = extracted;
            if (item.nome) {
              const norm = normalizeProductName(item.nome);
              if (norm) store.byName[norm] = extracted;
            }
            blingCount++;
          }
        }
        if (items.length < 100) break;
      }
      console.log(`[Bling Image Sync] Successfully extracted real images for ${blingCount} Bling products.`);
    } catch (blingErr: any) {
      console.warn('[Bling Image Sync] Notice during Bling API fetch:', blingErr?.message || blingErr);
    }
  } else {
    console.log('[Bling Image Sync] Bling OAuth token not connected yet; skipped direct API fetch.');
  }

  saveImageStore(store);

  const totalWithImages = Object.keys(store.bySku).length + Object.keys(store.byName).length;

  return {
    success: true,
    updatedCount: blingCount + nuvemCount,
    totalWithImages,
    sources: {
      bling: blingCount,
      nuvemshop: nuvemCount
    },
    message: `Sincronização concluída! ${blingCount} imagens do Bling e ${nuvemCount} imagens da Nuvemshop processadas.`
  };
}
