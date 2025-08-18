const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "data", "posts.json");

function ensureFile() {
    const dir = path.dirname(FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, "[]");
}

function readAll() {
    ensureFile();
    try {
        const arr = JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function readByProfile(profileId, limit) {
    const all = readAll();
    const out = [];
    for (let i = all.length - 1; i >= 0; i--) {
        const it = all[i];
        if (it && it.profileId === profileId) {
            out.push(it);
            if (typeof limit === "number" && out.length >= limit) break;
        }
    }
    return out;
}

function append(entry) {
    const all = readAll();
    all.push({
        id: Date.now().toString(36),
        createdAt: new Date().toISOString(),
        ...entry,
    });
    fs.writeFileSync(FILE_PATH, JSON.stringify(all, null, 2));
}

module.exports = { readAll, readByProfile, append };