// src/lib/api.js

// --- tiny fetch with timeout (default 45s, was 6s) ---
async function xfetch(url, opts = {}, ms = 45000) {
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

    // Try localhost:4000..4010, plus 127.0.0.1
    const candidates = [];
    for (let port = 4000; port <= 4010; port++) {
        candidates.push(`${proto}//${host}:${port}`);
        candidates.push(`http://127.0.0.1:${port}`);
    }

    for (let i = 0; i < candidates.length; i++) {
        const b = candidates[i];
        try {
            const r = await xfetch(b + "/health", { method: "GET" }, 3000);
            if (r.ok) {
                const j = await r.json().catch(() => null);
                if (j && j.ok) return b;
            }
        } catch (_) {
            // keep trying
        }
    }
    // Fallback
    return `http://localhost:4000`;
}

async function base() {
    if (BASE) return BASE;
    BASE = await discoverBaseUrl();
    return BASE;
}

// Expose for BackendBadge.jsx or other callers
export async function getApiBase() {
    return base();
}

// --- helpers ---
async function getJson(path, timeoutMs = 45000) {
    const b = await base();
    const r = await xfetch(b + path, { method: "GET" }, timeoutMs);
    if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
    return r.json();
}

async function postJson(path, body, timeoutMs = 45000) {
    const b = await base();
    const r = await xfetch(
        b + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
        },
        timeoutMs
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`POST ${path} ${r.status} ${t}`);
    }
    return r.json();
}

async function putJson(path, body, timeoutMs = 45000) {
    const b = await base();
    const r = await xfetch(
        b + path, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
        },
        timeoutMs
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`PUT ${path} ${r.status} ${t}`);
    }
    return r.json();
}

async function patchJson(path, body, timeoutMs = 45000) {
    const b = await base();
    const r = await xfetch(
        b + path, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
        },
        timeoutMs
    );
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`PATCH ${path} ${r.status} ${t}`);
    }
    return r.json();
}

// --- API surface used by your App.jsx ---

export async function getHealth() {
    return getJson("/health", 5000);
}
export async function getVersion() {
    return getJson("/version", 5000);
}
export async function getProfiles() {
    return getJson("/profiles", 10000);
}
export async function generatePost(profileId) {
    return getJson(
        `/generate-post-by-profile?profileId=${encodeURIComponent(profileId)}`,
        45000
    );
}

// Unified postNow (old + new signatures)
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
    return postJson("/post-now", body, 45000);
}

export async function postNowAll() {
    return postJson("/post-now-all", {}, 180000);
}

export async function getSchedulerConfig() {
    return getJson("/scheduler/config", 8000);
}
export async function setSchedulerConfig(cfg) {
    return putJson("/scheduler/config", cfg, 8000);
}
export async function getSchedulerStatus() {
    return getJson("/scheduler/status", 8000);
}
export async function runSchedulerOnce() {
    return postJson("/scheduler/run-once", {}, 45000);
}
export async function runSchedulerNow(profileId) {
    return postJson(
        `/scheduler/run-now/${encodeURIComponent(profileId)}`, {},
        45000
    );
}

export async function getPostHistory(profileId, limit = 50) {
    const q = [];
    if (profileId) q.push(`profileId=${encodeURIComponent(profileId)}`);
    if (limit) q.push(`limit=${encodeURIComponent(String(limit))}`);
    const qs = q.length ? `?${q.join("&")}` : "";
    return getJson(`/posts/history${qs}`, 10000);
}

export async function postToGmb(body) {
    return postJson("/post-to-gmb", body, 45000);
}

export async function updateProfileDefaults(profileId, defaults) {
    return patchJson(
        `/profiles/${encodeURIComponent(profileId)}/defaults`,
        defaults || {},
        10000
    );
}

// convenient default export
const api = {
    base,
    getApiBase,
    getHealth,
    getVersion,
    getProfiles,
    generatePost,
    postNow,
    postNowAll,
    getSchedulerConfig,
    setSchedulerConfig,
    getSchedulerStatus,
    runSchedulerOnce,
    runSchedulerNow,
    getPostHistory,
    postToGmb,
    updateProfileDefaults,
};

export default api;

// --- Extra helpers ---

export async function uploadPhoto(file, backendBase) {
    const form = new FormData();
    form.append("photo", file);
    const r = await fetch(backendBase + "/upload", {
        method: "POST",
        body: form,
    });
    if (!r.ok) throw new Error("Upload failed: " + r.status);
    return r.json(); // { url: "/uploads/xxx.jpg" }
}

// Optional direct post helper (explicit backendBase)
export async function postNowDirect(opts, backendBase) {
    const r = await fetch(backendBase + "/post-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts || {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data && data.error) || "HTTP " + r.status);
    return data;
}