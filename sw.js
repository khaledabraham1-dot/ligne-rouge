// Ligne Rouge — Service Worker
// Mettre à jour CACHE_VER à chaque déploiement majeur pour invalider les caches
const CACHE_VER   = 'lr-v3';
const STATIC      = `${CACHE_VER}-static`;
const DYNAMIC     = `${CACHE_VER}-dynamic`;
const IMG         = `${CACHE_VER}-images`;
const IMG_LIMIT   = 60; // max images en cache (FIFO)

// Ressources pré-cachées à l'installation
const PRE_CACHE = [
    '/ligne-rouge/',
    '/ligne-rouge/index.html',
    '/ligne-rouge/manifest.json',
    '/ligne-rouge/icon-192.png',
    '/ligne-rouge/icon-512.png',
    '/ligne-rouge/icon-180.png',
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(STATIC)
            .then(c => c.addAll(PRE_CACHE))
            .then(() => self.skipWaiting()) // prend le contrôle immédiatement
    );
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                // Supprime tous les caches d'anciennes versions
                keys.filter(k => !k.startsWith(CACHE_VER)).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim()) // contrôle immédiat de tous les onglets
    );
});

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
    // Ne jamais intercepter les requêtes non-GET (POST commentaires, newsletter…)
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

    // Supabase API — Network First : données fraîches, cache en fallback hors-ligne
    if (url.hostname.includes('supabase.co')) {
        e.respondWith(networkFirst(e.request, DYNAMIC));
        return;
    }

    // Images (Unsplash, Supabase storage) — Cache First avec limite de taille
    if (e.request.destination === 'image') {
        e.respondWith(cacheFirstLimited(e.request, IMG, IMG_LIMIT));
        return;
    }

    // Google Fonts & jsDelivr CDN — Cache First (ressources stables)
    if (
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('cdn.jsdelivr.net')
    ) {
        e.respondWith(cacheFirst(e.request, DYNAMIC));
        return;
    }

    // Site statique (HTML, icons, manifest) — Cache First avec mise à jour réseau
    if (url.hostname === self.location.hostname) {
        e.respondWith(cacheFirst(e.request, STATIC));
        return;
    }
});

// ─── STRATÉGIES ─────────────────────────────────────────────────────────────

// Cache First : cache prioritaire, réseau en fallback
async function cacheFirst(req, cacheName) {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
        const res = await fetch(req);
        if (res.ok) {
            const cache = await caches.open(cacheName);
            cache.put(req, res.clone());
        }
        return res;
    } catch {
        if (req.mode === 'navigate') return caches.match('/ligne-rouge/');
        return new Response('', { status: 503 });
    }
}

// Network First : réseau prioritaire, cache en fallback hors-ligne
async function networkFirst(req, cacheName) {
    try {
        const res = await fetch(req);
        if (res.ok) {
            const cache = await caches.open(cacheName);
            cache.put(req, res.clone());
        }
        return res;
    } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('/ligne-rouge/');
        // Retourne un JSON vide pour que l'app ne plante pas
        return new Response('[]', { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

// Cache First avec limite FIFO : évite de saturer le stockage avec les images
async function cacheFirstLimited(req, cacheName, limit) {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
        const res = await fetch(req);
        if (res.ok) {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            if (keys.length >= limit) await cache.delete(keys[0]); // supprime la plus ancienne
            cache.put(req, res.clone());
        }
        return res;
    } catch {
        return new Response('', { status: 503 });
    }
}
