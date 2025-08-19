// src/lib/api.js
import { discoverBaseUrl } from "./discoverBaseUrl";

let BASE = null;

async function base() {
    if (BASE) return BASE;
    BASE = await discoverBaseUrl();
    return BASE;
}

async function getJson(path) {
    const b = await base();
    const r = await fetch(b + path, { method: "GET" });
    if (!r.ok) throw new Error("GET " + path + " failed: " + r.status);
    return r.json();
}

async function postJson(path, body) {
    const b = await base();
    const r = await fetch(b + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error("POST " + path + " failed: " + r.status + " " + txt);
    }
    return r.json();
}

// ----- endpoints -----
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
        "/generate-post-by-profile?profileId=" + encodeURIComponent(profileId)
    );
}
export async function postNow(profileId, postText, cta, linkUrl) {
    return postJson("/post-now", {
        profileId,
        postText: postText || "",
        cta: cta || "",
        linkUrl: linkUrl || "",
    });
}
export async function postNowAll() {
    return postJson("/post-now-all", {});
}
export async function getSchedulerConfig() {
    return getJson("/scheduler/config");
}
export async function setSchedulerConfig(cfg) {
    // backend expects PUT in your current code; if your route is PUT, use PUT here.
    const b = await base();
    const r = await fetch(b + "/scheduler/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg || {}),
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error("PUT /scheduler/config failed: " + r.status + " " + txt);
    }
    return r.json();
}
export async function getSchedulerStatus() {
    return getJson("/scheduler/status");
}
export async function runSchedulerOnce() {
    return postJson("/scheduler/run-once", {});
}
export async function runSchedulerNow(profileId) {
    return postJson("/scheduler/run-now/" + encodeURIComponent(profileId), {});
}
export async function getPostHistory(profileId, limit) {
    const p = [];
    if (profileId) p.push("profileId=" + encodeURIComponent(profileId));
    if (limit) p.push("limit=" + encodeURIComponent(limit));
    const q = p.length ? "?" + p.join("&") : "";
    return getJson("/posts/history" + q);
}
export async function getApiBase() {
    return base();
}

// ----- default export for "api" style -----
const api = {
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
    getApiBase,
};
export default api;