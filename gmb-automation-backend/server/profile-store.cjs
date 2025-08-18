// server/profile-store.cjs
const fs = require("fs");
const path = require("path");

//captions 
const captions = require("./captions.cjs");



// Where profiles are stored
const FILE_PATH = path.join(__dirname, "..", "data", "profiles.json");

// ----- internal helpers -----
function ensureFile() {
    const dir = path.dirname(FILE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(FILE_PATH)) {
        fs.writeFileSync(FILE_PATH, "[]");
    }
}

function readRaw() {
    ensureFile();
    return fs.readFileSync(FILE_PATH, "utf8");
}

function validateProfile(p) {
    if (!p || typeof p !== "object") return "Profile must be an object";
    if (!p.profileId || typeof p.profileId !== "string")
        return "profileId is required";
    if (!p.businessName || typeof p.businessName !== "string")
        return "businessName is required";
    if (!p.accountId || typeof p.accountId !== "string")
        return "accountId is required";
    if (!p.locationId || typeof p.locationId !== "string")
        return "locationId is required";

    // normalize optionals
    if (typeof p.city !== "string") p.city = "";
    if (!Array.isArray(p.neighbourhoods)) p.neighbourhoods = [];
    if (!Array.isArray(p.keywords)) p.keywords = [];
    if (!Array.isArray(p.photoPool)) p.photoPool = [];

    // optional CTA controls
    if (typeof p.enableSiteCTA !== "boolean") p.enableSiteCTA = false;
    if (typeof p.landingUrl !== "string") p.landingUrl = "";

    return null; // valid
}

// ----- public API -----
function readAll() {
    try {
        const raw = readRaw();
        const data = JSON.parse(raw);
        if (Array.isArray(data)) return data;
        return [];
    } catch (_e) {
        // If file is corrupted, keep data safe by returning empty array
        return [];
    }
}

function writeAll(items) {
    if (!Array.isArray(items)) {
        throw new Error("writeAll expects an array");
    }
    ensureFile();

    // Write atomically: write to temp file then rename
    const tmpPath = FILE_PATH + ".tmp";
    const json = JSON.stringify(items, null, 2);
    fs.writeFileSync(tmpPath, json);
    fs.renameSync(tmpPath, FILE_PATH);
}

function getById(profileId) {
    const list = readAll();
    for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p && p.profileId === profileId) return p;
    }
    return null;
}

function upsert(profile) {
    const err = validateProfile(profile);
    if (err) throw new Error(err);

    const items = readAll();
    let found = false;
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it && it.profileId === profile.profileId) {
            items[i] = profile;
            found = true;
            break;
        }
    }
    if (!found) items.push(profile);
    writeAll(items);
    return profile;
}

function bulkUpsert(profiles) {
    if (!Array.isArray(profiles)) {
        throw new Error("bulkUpsert expects an array of profiles");
    }
    const map = {};
    const existing = readAll();

    // index existing by profileId
    for (let i = 0; i < existing.length; i++) {
        const it = existing[i];
        if (it && it.profileId) map[it.profileId] = it;
    }

    // apply new/updates
    for (let j = 0; j < profiles.length; j++) {
        const p = profiles[j];
        const err = validateProfile(p);
        if (err) throw new Error("Invalid profile at index " + j + ": " + err);
        map[p.profileId] = p;
    }

    // rebuild list deterministically
    const out = [];
    const keys = Object.keys(map);
    keys.sort();
    for (let k = 0; k < keys.length; k++) {
        out.push(map[keys[k]]);
    }

    writeAll(out);
    return out.length;
}

function remove(profileId) {
    const items = readAll();
    const filtered = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || it.profileId !== profileId) filtered.push(it);
    }
    writeAll(filtered);
    return true;
}

module.exports = {
    FILE_PATH,
    readAll,
    writeAll,
    getById,
    upsert,
    bulkUpsert,
    remove,
};