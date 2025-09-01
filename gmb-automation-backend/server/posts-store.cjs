// server/posts-store.cjs  (CommonJS version)
const fs = require("fs");
const path = require("path");

const FILE = path.join(process.cwd(), "data", "posts-history.json");
let cache = null;

function load() {
    if (cache) return cache;
    try {
        const raw = fs.readFileSync(FILE, "utf8");
        const arr = JSON.parse(raw);
        cache = Array.isArray(arr) ? arr : [];
    } catch {
        cache = [];
    }
    return cache;
}

function save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
}

/** Append a normalized record */
function append(rec = {}) {
    load();
    const row = {
        id: String(Date.now()),
        createdAt: rec.createdAt || new Date().toISOString(),
        locationId: rec.locationId || "",
        profileId: rec.profileId || "",
        profileName: rec.profileName || "",
        summary: rec.summary || "",
        mediaCount: Number(rec.mediaCount || 0),
        usedImage: Number(rec.mediaCount || 0) > 0, // keeps your UI's "Photo" flag working
        cta: rec.cta || "",
        status: rec.status || "PENDING", // "POSTED" | "FAILED" | "PENDING"
        gmbPostId: rec.gmbPostId || "",
    };
    cache.push(row);
    if (cache.length > 1000) cache = cache.slice(-1000);
    save();
    return row;
}

function readAll() {
    load();
    return cache.slice();
}

/** readLatest(profileId|null, limit) → oldest→newest (your UI reverses if needed) */
function readLatest(profileId, limit = 50) {
    load();
    let arr = cache;
    if (profileId) arr = arr.filter((x) => x && x.profileId === profileId);
    return arr.slice(-limit);
}

module.exports = { append, readAll, readLatest };