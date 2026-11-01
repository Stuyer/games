// cover-cache.js - Локальное кэширование обложек в IndexedDB и localStorage
const DB_NAME = 'site_games_cover_cache_v1';
const STORE_NAME = 'covers';
const DB_VERSION = 1;
const SIGNED_URLS_STORAGE_KEY = 'site_signed_urls_cache_v1';
// Запас по времени: если до истечения срока действия ссылки осталось менее 24 часов, запрашиваем новую
const SIGNED_URL_SAFETY_MARGIN_MS = 24 * 60 * 60 * 1000;

// Быстрый in-memory кэш blob-URL для мгновенного синхронного рендера (0мс задержки)
const memoryUrlCache = new Map();
const inFlightRequests = new Map();

let dbPromise = null;

function getDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'path' });
          }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function getCoverBlobFromDB(path) {
  if (!path) return null;
  const db = await getDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(path);
      req.onsuccess = () => resolve(req.result?.blob || null);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

export async function saveCoverBlobToDB(path, blob) {
  if (!path || !blob) return;
  const db = await getDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      path,
      blob,
      size: blob.size,
      savedAt: Date.now()
    });
  } catch (_) {
    // Игнорируем квоты или ошибки хранилища
  }
}

export async function removeCoverBlobFromDB(path) {
  if (!path) return;
  const memUrl = memoryUrlCache.get(path);
  if (memUrl && memUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(memUrl); } catch (_) {}
  }
  memoryUrlCache.delete(path);

  // Удаляем из localStorage signed URL
  const cache = getCachedSignedUrlsFromStorage();
  if (cache[path]) {
    delete cache[path];
    saveCachedSignedUrlsToStorage(cache);
  }

  const db = await getDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(path);
  } catch (_) {}
}

export function getCoverUrlSync(path) {
  if (!path) return null;
  return memoryUrlCache.get(path) || null;
}

export async function loadCoverImage(path, networkUrl) {
  if (!path) return networkUrl || '';
  if (memoryUrlCache.has(path)) {
    return memoryUrlCache.get(path);
  }

  // Предотвращаем дублирование одновременных сетевых запросов к одной картинке
  if (inFlightRequests.has(path)) {
    return inFlightRequests.get(path);
  }

  const loadPromise = (async () => {
    try {
      // 1. Проверяем локальную базу IndexedDB
      const cachedBlob = await getCoverBlobFromDB(path);
      if (cachedBlob) {
        const objectUrl = URL.createObjectURL(cachedBlob);
        memoryUrlCache.set(path, objectUrl);
        return objectUrl;
      }

      // 2. Если в кэше нет — скачиваем один раз из сети
      if (!networkUrl) return '';
      const response = await fetch(networkUrl);
      if (!response.ok) {
        return networkUrl;
      }
      const blob = await response.blob();
      await saveCoverBlobToDB(path, blob);
      const objectUrl = URL.createObjectURL(blob);
      memoryUrlCache.set(path, objectUrl);
      return objectUrl;
    } catch (err) {
      console.warn('Cover load/cache error for path:', path, err);
      return networkUrl || '';
    } finally {
      inFlightRequests.delete(path);
    }
  })();

  inFlightRequests.set(path, loadPromise);
  return loadPromise;
}

export function getCachedSignedUrlsFromStorage() {
  try {
    const raw = localStorage.getItem(SIGNED_URLS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export function saveCachedSignedUrlsToStorage(cache) {
  try {
    localStorage.setItem(SIGNED_URLS_STORAGE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

export async function getOrFetchSignedUrls(supabase, bucketName, paths, expiresIn = 604800) {
  if (!paths || !paths.length || !supabase) return new Map();

  // Если бакет переведен в Public, отдаем постоянные публичные URL через CDN Cloudflare без задержек и токенов
  const isPublic = Boolean(
    window.SUPABASE_CONFIG?.isStoragePublic ||
    (bucketName === 'game-covers' && window.SUPABASE_CONFIG?.isGameCoversPublic)
  );

  if (isPublic) {
    const resultMap = new Map();
    for (const path of paths) {
      if (!path) continue;
      const { data } = supabase.storage.from(bucketName).getPublicUrl(path);
      if (data?.publicUrl) resultMap.set(path, data.publicUrl);
    }
    return resultMap;
  }

  const cache = getCachedSignedUrlsFromStorage();
  const now = Date.now();
  const resultMap = new Map();
  const pathsToFetch = [];

  for (const path of paths) {
    if (!path) continue;
    const entry = cache[path];
    if (entry && entry.url && entry.exp && entry.exp > (now + SIGNED_URL_SAFETY_MARGIN_MS)) {
      resultMap.set(path, entry.url);
    } else {
      pathsToFetch.push(path);
    }
  }

  if (pathsToFetch.length > 0) {
    try {
      const { data: signedImages, error } = await supabase.storage
        .from(bucketName)
        .createSignedUrls(pathsToFetch, expiresIn);

      if (error) {
        console.error('Storage createSignedUrls error:', error);
      } else if (signedImages) {
        for (const item of signedImages) {
          if (item?.path && item?.signedUrl) {
            resultMap.set(item.path, item.signedUrl);
            cache[item.path] = {
              url: item.signedUrl,
              exp: now + expiresIn * 1000
            };
          }
        }
        saveCachedSignedUrlsToStorage(cache);
      }
    } catch (err) {
      console.error('Failed to fetch signed URLs:', err);
    }
  }

  return resultMap;
}
