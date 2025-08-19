// src/lib/discoverBaseUrl.js
const DEFAULT_PORTS = [
    4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009, 4010,
];

function timeoutFetch(url, opts, ms) {
    return new Promise(function(resolve, reject) {
        const t = setTimeout(function() {
            reject(new Error("timeout"));
        }, ms);
        fetch(url, opts)
            .then(function(r) {
                clearTimeout(t);
                resolve(r);
            })
            .catch(function(e) {
                clearTimeout(t);
                reject(e);
            });
    });
}

async function pingBase(url) {
    try {
        const r = await timeoutFetch(url + "/health", { method: "GET" }, 1200);
        if (!r.ok) return null;
        const j = await r.json().catch(function() {
            return null;
        });
        if (j && j.ok) return url;
        return null;
    } catch (_e) {
        return null;
    }
}

export async function discoverBaseUrl() {
    // 1) explicit env wins
    var envBase = process.env.REACT_APP_API_BASE;
    if (typeof envBase === "string" && envBase.indexOf("http://") === 0) {
        var ok = await pingBase(envBase);
        if (ok) return ok;
    }
    // 2) try localhost ports
    for (var i = 0; i < DEFAULT_PORTS.length; i++) {
        var url = "http://localhost:" + DEFAULT_PORTS[i];
        var ok2 = await pingBase(url);
        if (ok2) return ok2;
    }
    // 3) last resort
    return "http://localhost:4000";
}