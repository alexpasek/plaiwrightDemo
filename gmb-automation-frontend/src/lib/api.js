// src/lib/api.js

// --- tiny fetch with timeout ---
async function xfetch(url, opts = {}, ms = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, {...opts, signal: ctrl.signal });
        return r;
    } finally {
        clearTimeout(t);
    }
}

// --- backend base URL auto-discovery (cached) ---
let BASE = null;

async function discoverBaseUrl() {
    const proto = window.location.protocol || "http:";
    const host = window.location.hostname || "localhost";
    const candidates = [
        `${proto}//${host}:4000`,
        `http://localhost:4000`,
        `http://127.0.0.1:4000`,
    ];

    for (let i = 0; i < candidates.length; i++) {
        const b = candidates[i];
        try {
            const r = await xfetch(b + "/health", { method: "GET" }, 2500);
            if (r.ok) {
                const j = await r.json().catch(() => null);
                if (j && j.ok) return b;
            }
        } catch (_) {
            // keep trying other candidates
        }
    }
    return `http://localhost:4000`;
}

async function base() {
    if (BASE) return BASE;
    BASE = await discoverBaseUrl();
    return BASE;
}

// Expose for BackendBadge.jsx
export async function getApiBase() {
    return base();
}

// --- helpers ---
async function getJson(path) {
    const b = await base();
    const r = await xfetch(b + path, { method: "GET" });
    if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
    return r.json();
}

async function postJson(path, body) {
    const b = await base();
    const r = await xfetch(b + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`POST ${path} ${r.status} ${t}`);
    }
    return r.json();
}

async function putJson(path, body) {
    const b = await base();
    const r = await xfetch(b + path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`PUT ${path} ${r.status} ${t}`);
    }
    return r.json();
}

async function patchJson(path, body) {
    const b = await base();
    const r = await xfetch(b + path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`PATCH ${path} ${r.status} ${t}`);
    }
    return r.json();
}

// --- API surface used by your App.jsx ---

export async function getHealth() {
    return getJson("/health");
}
export async function getVersion() {
    return getJson("/version");
}
export async function getProfiles() {
    return getJson("/profiles");
}
export async function generatePost(profileId) {
    return getJson(
        `/generate-post-by-profile?profileId=${encodeURIComponent(profileId)}`
    );
}

// Supports both old (profileId, postText) and new (payload) signatures
export async function postNow(
    profileIdOrPayload,
    postText,
    cta,
    linkUrl,
    mediaUrl
) {
    let body;
    if (typeof profileIdOrPayload === "object" && profileIdOrPayload) {
        body = profileIdOrPayload;
    } else {
        body = {
            profileId: profileIdOrPayload,
            postText: postText || "",
            cta: cta || "",
            linkUrl: linkUrl || "",
            mediaUrl: mediaUrl || "",
        };
    }
    return postJson("/post-now", body);
}

export async function postNowAll() {
    return postJson("/post-now-all", {});
}

export async function getSchedulerConfig() {
    return getJson("/scheduler/config");
}
export async function setSchedulerConfig(cfg) {
    return putJson("/scheduler/config", cfg);
}
export async function getSchedulerStatus() {
    return getJson("/scheduler/status");
}
export async function runSchedulerOnce() {
    return postJson("/scheduler/run-once", {});
}
export async function runSchedulerNow(profileId) {
    return postJson(`/scheduler/run-now/${encodeURIComponent(profileId)}`, {});
}

export async function getPostHistory(profileId, limit = 50) {
    const q = [];
    if (profileId) q.push(`profileId=${encodeURIComponent(profileId)}`);
    if (limit) q.push(`limit=${encodeURIComponent(String(limit))}`);
    const qs = q.length ? `?${q.join("&")}` : "";
    return getJson(`/posts/history${qs}`);
}

export async function postToGmb(body) {
    return postJson("/post-to-gmb", body);
}

export async function updateProfileDefaults(profileId, defaults) {
    return patchJson(
        `/profiles/${encodeURIComponent(profileId)}/defaults`,
        defaults || {}
    );
}

// convenient default export (matches your current imports)
const api = {
    // discovery
    base,
    getApiBase,
    // general
    getHealth,
    getVersion,
    getProfiles,
    // compose/post
    generatePost,
    postNow,
    postNowAll,
    // scheduler
    getSchedulerConfig,
    setSchedulerConfig,
    getSchedulerStatus,
    runSchedulerOnce,
    runSchedulerNow,
    // history
    getPostHistory,
    // misc
    postToGmb,
    updateProfileDefaults,
};

export default api;