// ==================== BOOTSTRAP ====================
require("dotenv").config();
const ATTACH_MEDIA =
    String(process.env.POST_ATTACH_MEDIA || "").toLowerCase() === "true";

const cors = require("cors");
const express = require("express");
const app = express();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const https = require("https");
const http = require("http");

// Public base for turning "/uploads/xxx.jpg" into absolute HTTPS
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "");

// ========= CONFIGURABLE UPLOADS DIR =========
// Use the same folder the website serves at https://.../uploads
const UPLOADS_DIR =
    process.env.UPLOADS_DIR && fs.existsSync(process.env.UPLOADS_DIR) ?
    process.env.UPLOADS_DIR :
    path.join(__dirname, "data", "uploads"); // fallback for local dev

console.log("🗂 Using uploads directory:", UPLOADS_DIR);

// Serve /uploads statically (handy for local/dev)
app.use(
    "/uploads",
    express.static(UPLOADS_DIR, {
        setHeaders: (res) => {
            res.set("Cache-Control", "public, max-age=2592000, immutable");
        },
    })
);

// Turn a relative /uploads path into absolute https, if possible
function makeAbsoluteUploadUrl(u) {
    if (!u) return "";
    var s = String(u);
    // already absolute
    if (/^https?:\/\//i.test(s)) return s;
    // only upgrade if PUBLIC_BASE_URL is https AND the path is /uploads/...
    if (
        s.indexOf("/uploads/") === 0 &&
        PUBLIC_BASE_URL &&
        /^https:\/\//i.test(PUBLIC_BASE_URL)
    ) {
        var base = PUBLIC_BASE_URL.replace(/\/+$/, "");
        return base + s;
    }
    // leave unchanged (will be skipped later if not https)
    return s;
}

// Quick preflight to make sure Google can likely fetch the image
function probeImageUrl(u) {
    return new Promise(function(resolve) {
        if (!u || !/^https:\/\//i.test(u))
            return resolve({ ok: false, reason: "not-https" });

        const mod = u.startsWith("https://") ? https : http;
        const req = mod.request(u, { method: "GET" }, function(res) {
            // follow one redirect
            if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers &&
                res.headers.location
            ) {
                const loc = res.headers.location;
                const m = (loc || "").startsWith("http") ?
                    loc :
                    new URL(loc, u).toString();
                // one redirect only
                const req2 = (m.startsWith("https://") ? https : http).request(
                    m, { method: "GET" },
                    function(res2) {
                        const ct2 = String(res2.headers["content-type"] || "");
                        const len2 = parseInt(res2.headers["content-length"] || "0", 10);
                        const ok2 =
                            res2.statusCode === 200 &&
                            /^image\//i.test(ct2) &&
                            (isNaN(len2) || len2 <= 5 * 1024 * 1024);
                        resolve({
                            ok: ok2,
                            status: res2.statusCode,
                            contentType: ct2,
                            bytes: isNaN(len2) ? 0 : len2,
                        });
                        res2.resume();
                    }
                );
                req2.on("error", function() {
                    resolve({ ok: false, reason: "redirect-error" });
                });
                req2.end();
                res.resume();
                return;
            }

            const ct = String(res.headers["content-type"] || "");
            const len = parseInt(res.headers["content-length"] || "0", 10);
            const ok =
                res.statusCode === 200 &&
                /^image\//i.test(ct) &&
                (isNaN(len) || len <= 5 * 1024 * 1024);
            resolve({
                ok: ok,
                status: res.statusCode,
                contentType: ct,
                bytes: isNaN(len) ? 0 : len,
            });
            res.resume();
        });
        req.on("error", function() {
            resolve({ ok: false, reason: "net-error" });
        });
        req.end();
    });
}

// Simple check to avoid attaching media with placeholder or local base
function isValidPublicBase() {
    if (!PUBLIC_BASE_URL) return false;
    if (!/^https:\/\//i.test(PUBLIC_BASE_URL)) return false;
    if (/your-domain\.com/i.test(PUBLIC_BASE_URL)) return false; // avoid placeholder
    if (/localhost|127\.0\.0\.1/i.test(PUBLIC_BASE_URL)) return false;
    return true;
}

// Routes (uploads/photos)
const uploadRoutes = require("./server/upload.cjs");

// Google helpers
const { oauth2Client, callBusinessProfileAPI } = require("./google-client.cjs");

// Data stores
const profilesStore = require("./server/profile-store.cjs");
const postsStore = require("./server/posts-store.cjs");

// Allow the React dev server to call the backend
app.use(
    cors({
        origin: function(origin, cb) {
            if (!origin) return cb(null, true);
            if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
            return cb(new Error("Not allowed by CORS: " + origin));
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false,
    })
);

// Middleware
app.use(express.json({ limit: "1mb" }));
app.use(uploadRoutes);

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==================== HELPERS ====================
function pickNeighbourhood(profile, date) {
    var p = profile || {};
    var arr = Array.isArray(p.neighbourhoods) ? p.neighbourhoods : [];
    var city = p.city || "";
    if (arr.length === 0) return city;

    // More variety:
    //  - 30% of the time use the city only
    //  - otherwise pick a random neighbourhood
    var useCityOnly = Math.random() < 0.3;
    if (useCityOnly) return city;

    var idx = Math.floor(Math.random() * arr.length);
    return arr[idx];
}

function safeJoinHashtags(arr, maxChars) {
    if (!Array.isArray(arr)) return "";
    var out = "";
    for (var i = 0; i < arr.length; i++) {
        var h = String(arr[i] || "").trim();
        if (h === "") continue;
        if (h[0] !== "#") h = "#" + h.replace(/^#+/, "");
        var candidate = out === "" ? h : out + " " + h;
        if (candidate.length > maxChars) break;
        out = candidate;
    }
    return out;
}

function parseJsonResponse(text) {
    var s = String(text || "");
    if (s.indexOf("```") !== -1) {
        var first = s.indexOf("{");
        var last = s.lastIndexOf("}");
        if (first !== -1 && last !== -1 && last > first)
            s = s.slice(first, last + 1);
    }
    try {
        var obj = JSON.parse(s);
        if (obj && typeof obj === "object") return obj;
        return null;
    } catch (_) {
        return null;
    }
}

async function aiGenerateSummaryAndHashtags(
    profile,
    neighbourhood,
    openaiClient
) {
    var city = profile && profile.city ? profile.city : "";
    var businessName =
        profile && profile.businessName ? profile.businessName : "";
    var keywords = Array.isArray(profile && profile.keywords) ?
        profile.keywords :
        [];
    var kwLine = keywords.join(", ");

    // Randomize the way we mention the area
    var area = neighbourhood && neighbourhood !== "" ? neighbourhood : "";
    var whereOptions = area ?
        [
            area + ", " + city,
            "the " + area + " area of " + city,
            area + " in " + city,
            city + " — including " + area,
            area + " / " + city,
        ] :
        [city];
    var where = whereOptions[Math.floor(Math.random() * whereOptions.length)];

    // Random tone + CTA to reduce repetition
    var tones = [
        "friendly and helpful",
        "confident and professional",
        "warm and community-focused",
        "concise and action-oriented",
        "benefit-driven and practical",
    ];
    var tone = tones[Math.floor(Math.random() * tones.length)];

    var ctas = [
        "Request a free quote today.",
        "Get your free estimate now.",
        "Message us for a free estimate.",
        "Book a free quote today.",
        "Contact us for a no-obligation quote.",
    ];
    var ctaLine = ctas[Math.floor(Math.random() * ctas.length)];

    var prompt =
        "Return ONLY valid JSON with fields: summary (string), hashtags (array of 5-7 strings). " +
        "Do not include markdown fences. " +
        "Constraints: summary 80-120 words, " +
        tone +
        ", no phone numbers, no emojis in body, no hashtags in body. " +
        "Mention the location naturally. End the body with EXACTLY this CTA: " +
        ctaLine +
        " " +
        "Hashtags should be concise, readable, and include a mix of general and geo hashtags (no punctuation except '#').\n\n" +
        "Business: " +
        businessName +
        "\n" +
        "City/Area: " +
        where +
        "\n" +
        "Keywords to inspire (do not list verbatim): " +
        kwLine +
        "\n";

    var completion = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
    });

    var txt = "";
    if (
        completion &&
        completion.choices &&
        completion.choices[0] &&
        completion.choices[0].message &&
        completion.choices[0].message.content
    ) {
        txt = completion.choices[0].message.content;
    }

    var obj = parseJsonResponse(txt);
    if (!obj) return { summary: String(txt || "").trim(), hashtags: [] };

    var summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    var hashtags = Array.isArray(obj.hashtags) ? obj.hashtags : [];
    var cleaned = [];
    for (var i = 0; i < hashtags.length; i++) {
        var h = String(hashtags[i] || "").trim();
        if (h === "") continue;
        if (h[0] !== "#") h = "#" + h.replace(/^#+/, "");
        cleaned.push(h);
    }
    return { summary: summary, hashtags: cleaned };
}

// ---- URL / media helpers ----
function isPublicHttps(url) {
    return typeof url === "string" && /^https:\/\/.+/i.test(url);
}

function isLocalHost(url) {
    return typeof url === "string" && /localhost|127\.0\.0\.1/i.test(url);
}

function shouldAttachMedia(url) {
    if (!ATTACH_MEDIA) return false;
    if (!url) return false;
    if (!isPublicHttps(url)) return false;
    if (isLocalHost(url)) return false;
    return true;
}

function tryPickPhotoFromProfile(profile) {
    if (
        profile &&
        Array.isArray(profile.photoPool) &&
        profile.photoPool.length > 0
    ) {
        var p =
            profile.photoPool[Math.floor(Math.random() * profile.photoPool.length)];
        if (p && typeof p === "object") return p;
    }
    return null;
}

// UPDATED: read from configurable UPLOADS_DIR (same as website /uploads)
function tryPickPhotoFromUploads() {
    if (!fs.existsSync(UPLOADS_DIR)) return null;
    var files = fs.readdirSync(UPLOADS_DIR).filter(function(f) {
        return !f.startsWith(".") && /\.(jpg|jpeg|png|webp|gif)$/i.test(f);
    });
    if (files.length === 0) return null;
    var randomFile = files[Math.floor(Math.random() * files.length)];
    return { url: "/uploads/" + randomFile, caption: "" }; // exact filename (case sensitive!)
}

function isHttpsImage(u) {
    try {
        var x = new URL(u);
        return (
            x.protocol === "https:" &&
            /\.(png|jpe?g|webp|gif)$/i.test(x.pathname || "")
        );
    } catch (_) {
        return false;
    }
}

function escapeRegExp(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimUrlForCompare(u) {
    try {
        var x = new URL(u);
        return (x.origin + x.pathname).replace(/\/+$/, "");
    } catch (_) {
        return String(u || "").replace(/\/+$/, "");
    }
}

function dedupeUrlInText(text, url) {
    if (!text || !url) return text || "";
    var core = escapeRegExp(trimUrlForCompare(url));
    var rx = new RegExp("(https?:\\/\\/[^\\s]*" + core + "\\/?)", "ig");
    var seen = false;
    return String(text).replace(rx, function(m) {
        if (seen) return "";
        seen = true;
        return m;
    });
}

// ==================== CTA MAP ====================
// Only web CTAs here. CALL/CALL_NOW are handled specially (fallback to LEARN_MORE or omitted).
const CTA_MAP = {
    LEARN_MORE: { actionType: "LEARN_MORE", needsUrl: true, urlKind: "http" },
    BOOK: { actionType: "BOOK", needsUrl: true, urlKind: "http" },
    ORDER: { actionType: "ORDER", needsUrl: true, urlKind: "http" },
    SHOP: { actionType: "SHOP", needsUrl: true, urlKind: "http" },
    SIGN_UP: { actionType: "SIGN_UP", needsUrl: true, urlKind: "http" },
};

// ==================== LIVE LOCATION BASICS ====================
const LOCATION_CACHE = {}; // { locationId: { websiteUri, primaryPhone, ts } }
function getCacheKey(profile) {
    return profile && profile.locationId ? String(profile.locationId) : "";
}

async function fetchLocationBasics(profile) {
    var out = { websiteUri: "", primaryPhone: "" };
    if (!profile) return out;

    var key = getCacheKey(profile);
    if (key && LOCATION_CACHE[key]) {
        var ageMs = Date.now() - LOCATION_CACHE[key].ts;
        if (ageMs < 5 * 60 * 1000) return LOCATION_CACHE[key]; // 5 min cache
    }
    try {
        var accountId = String(profile.accountId || "");
        var locationId = String(profile.locationId || "");
        if (!accountId || !locationId) return out;

        var url =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/" +
            accountId +
            "/locations/" +
            locationId +
            "?readMask=websiteUri,phoneNumbers";
        var resp = await callBusinessProfileAPI("GET", url);
        var data = resp && resp.data ? resp.data : {};

        var websiteUri = data && data.websiteUri ? String(data.websiteUri) : "";
        var primaryPhone = "";
        if (data && data.phoneNumbers && data.phoneNumbers.primaryPhone) {
            primaryPhone = String(data.phoneNumbers.primaryPhone);
        }
        out = {
            websiteUri: websiteUri,
            primaryPhone: primaryPhone,
            ts: Date.now(),
        };
        if (key) LOCATION_CACHE[key] = out;
        return out;
    } catch (e) {
        var fallbackPhone = profile && profile.phone ? String(profile.phone) : "";
        var fallbackSite =
            profile && profile.landingUrl ? String(profile.landingUrl) : "";
        out = {
            websiteUri: fallbackSite,
            primaryPhone: fallbackPhone,
            ts: Date.now(),
        };
        var k = getCacheKey(profile);
        if (k) LOCATION_CACHE[k] = out;
        return out;
    }
}

// Resolve CTA/link/media using body, profile defaults, and Google basics
function resolveDefaults(profile, body, basics) {
    var d = profile && profile.defaults ? profile.defaults : {};
    var incomingCta =
        body && typeof body.cta === "string" && body.cta ? body.cta : "";
    var incomingLink =
        body && typeof body.linkUrl === "string" ? body.linkUrl : null; // null = not provided
    var incomingMedia =
        body && typeof body.mediaUrl === "string" ? body.mediaUrl : null;

    var cta = incomingCta ? incomingCta : d.cta ? d.cta : "LEARN_MORE"; // default to LEARN_MORE now

    // website candidate priority: defaults.linkUrl > profile.landingUrl > Google websiteUri
    var siteFromDefaults = typeof d.linkUrl === "string" ? d.linkUrl : "";
    var siteFromProfile =
        profile && profile.landingUrl ? String(profile.landingUrl) : "";
    var siteFromGoogle =
        basics && basics.websiteUri ? String(basics.websiteUri) : "";
    var siteCandidate = siteFromDefaults || siteFromProfile || siteFromGoogle;

    var linkUrl = incomingLink !== null ? incomingLink : siteCandidate;

    var defMedia = typeof d.mediaUrl === "string" ? d.mediaUrl : "";
    var mediaUrl = incomingMedia !== null ? incomingMedia : defMedia;

    return {
        cta: cta,
        linkUrl: linkUrl,
        mediaUrl: mediaUrl,
        siteCandidate: siteCandidate,
    };
}

/**
 * Build a CTA for STANDARD posts with these rules:
 * - If ctaCode is CALL/CALL_NOW -> use LEARN_MORE if we have a valid https site URL; else return null (no CTA).
 * - For web CTAs (LEARN_MORE/BOOK/ORDER/SHOP/SIGN_UP) -> require valid https URL; else return null.
 */
function buildCallToAction(profile, ctaCode, linkUrl, basics) {
    // Normalize CALL* -> LEARN_MORE fallback attempt
    if (ctaCode === "CALL" || ctaCode === "CALL_NOW") {
        // try to find a https site
        var candidate = typeof linkUrl === "string" && linkUrl ? linkUrl : "";
        if (!/^https?:\/\//i.test(candidate || "")) {
            candidate =
                (basics && basics.websiteUri) || (profile && profile.landingUrl) || "";
        }
        if (candidate && /^https?:\/\//i.test(candidate)) {
            return { actionType: "LEARN_MORE", url: candidate };
        }
        return null; // no site -> no CTA
    }

    var spec = CTA_MAP[ctaCode] || null;
    if (!spec) return null;

    // only http(s) CTAs here
    var candidate2 = typeof linkUrl === "string" && linkUrl ? linkUrl : "";
    if (!/^https?:\/\//i.test(candidate2 || "")) {
        candidate2 =
            (basics && basics.websiteUri) || (profile && profile.landingUrl) || "";
    }
    if (!candidate2 || !/^https?:\/\//i.test(candidate2)) return null;

    return { actionType: spec.actionType, url: candidate2 };
}

// ==================== GBP: ACCOUNTS & LOCATIONS ====================
app.get("/accounts", async function(_req, res) {
    try {
        var url =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts";
        var result = await callBusinessProfileAPI("GET", url);
        res.json(result.data);
    } catch (e) {
        var errMsg =
            (e && e.response && e.response.data) || (e && e.message) || String(e);
        res.status(500).json({ error: errMsg });
    }
});

app.get("/locations", async function(req, res) {
    try {
        var accountId = req.query.accountId;
        var readMask = req.query.readMask;
        if (!accountId) return res.status(400).json({ error: "Missing accountId" });
        if (!readMask || readMask.trim() === "") {
            readMask =
                "name,title,storeCode,languageCode,websiteUri,phoneNumbers,metadata";
        }
        var base =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/" +
            accountId +
            "/locations";
        var url =
            base + "?readMask=" + encodeURIComponent(readMask) + "&pageSize=100";
        var result = await callBusinessProfileAPI("GET", url);
        res.json(result.data);
    } catch (e) {
        var errMsg =
            (e && e.response && e.response.data) || (e && e.message) || String(e);
        res.status(500).json({ error: errMsg });
    }
});

// ==================== Load profiles once at startup ====================
const PROFILES_PATH = path.join(__dirname, "data", "profiles.json");
let PROFILES = [];
try {
    PROFILES = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
    console.log("Loaded " + PROFILES.length + " profiles");
} catch (e) {
    console.warn("Could not load profiles.json. Make sure it exists in /data.");
}

// ==================== Health / Version / Profiles ====================
app.get("/health", function(_req, res) {
    res.json({ ok: true, status: "healthy" });
});
let serverPort = Number(process.env.PORT || 4000);
app.get("/version", function(_req, res) {
    res.json({
        name: "gmb-automation-backend",
        version: "0.0.0",
        port: serverPort,
        features: { profiles: true, scheduler: true, postNow: true },
    });
});
app.get("/profiles", function(_req, res) {
    try {
        var listFromStore = [];
        try {
            listFromStore = profilesStore.readAll();
        } catch (_) {}
        var out =
            Array.isArray(PROFILES) && PROFILES.length > 0 ?
            PROFILES :
            Array.isArray(listFromStore) ?
            listFromStore :
            [];
        res.json({ profiles: out });
    } catch (e) {
        var msg = (e && e.message) || String(e);
        res.status(500).json({ error: msg });
    }
});

// ==================== UPDATE PROFILE DEFAULTS ====================
app.patch("/profiles/:id/defaults", async function(req, res) {
    try {
        var id = req.params.id;
        var body = req.body || {};
        var p = PROFILES.find(function(x) {
            return x && x.profileId === id;
        });
        if (!p) return res.status(404).json({ error: "Profile not found" });
        p.defaults = p.defaults || {};
        if (typeof body.cta === "string") p.defaults.cta = body.cta;
        if (typeof body.linkUrl === "string") p.defaults.linkUrl = body.linkUrl;
        if (typeof body.mediaUrl === "string") p.defaults.mediaUrl = body.mediaUrl;
        if (typeof body.phone === "string") p.phone = body.phone;
        await fs.promises.writeFile(
            PROFILES_PATH,
            JSON.stringify(PROFILES, null, 2)
        );
        res.json({
            ok: true,
            profileId: id,
            defaults: p.defaults,
            phone: p.phone || "",
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
    }
});

// ==================== AI POST GENERATION (preview) ====================
app.get("/generate-post-by-profile", async function(req, res) {
    var profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: "Missing profileId" });

    var profile = PROFILES.find(function(p) {
        return p && p.profileId === profileId;
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    var neighbourhood = pickNeighbourhood(profile) || profile.city;
    try {
        console.log(
            "📝 Generating post for " +
            profile.businessName +
            " in " +
            neighbourhood +
            "..."
        );
        var resultAI = await aiGenerateSummaryAndHashtags(
            profile,
            neighbourhood,
            openai
        );
        var summaryAI = resultAI ? resultAI.summary : "";
        var hashtagsAI =
            resultAI && Array.isArray(resultAI.hashtags) ? resultAI.hashtags : [];
        if (!summaryAI) throw new Error("No summary returned from AI");

        var postText = summaryAI;
        if (hashtagsAI && hashtagsAI.length > 0) {
            postText += "\n\n" + hashtagsAI.join(" ");
        }

        console.log("✅ Post generated for " + profile.businessName);
        return res.json({
            profileId: profile.profileId,
            businessName: profile.businessName,
            city: profile.city,
            neighbourhood: neighbourhood,
            post: postText,
        });
    } catch (err) {
        var msg = (err && err.message) || String(err);
        console.error("❌ AI generation error:", msg);
        return res
            .status(500)
            .json({ error: "Failed to generate post", details: msg });
    }
});

// ==================== GOOGLE AUTH ====================
app.get("/auth", function(_req, res) {
    var scopes = ["https://www.googleapis.com/auth/business.manage"];
    var url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
    });
    res.redirect(url);
});

app.get("/oauth2callback", async function(req, res) {
    var code = req.query.code;
    if (!code) return res.status(400).send("Missing code");
    try {
        var tokenResp = await oauth2Client.getToken(code);
        var tokens = tokenResp && tokenResp.tokens ? tokenResp.tokens : null;
        if (tokens) oauth2Client.setCredentials(tokens);
        var TOKENS_PATH = path.join(__dirname, "data", "tokens.json");
        fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
        fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
        res.send("✅ Tokens saved successfully! You can now use the API.");
    } catch (err) {
        var msg = (err && err.message) || String(err);
        console.error("Error retrieving access token", msg);
        res.status(500).send("Auth failed");
    }
});

// ==================== CORE POST LOGIC ====================
function containsInvalidArgument(detail) {
    try {
        var msg = typeof detail === "string" ? detail : JSON.stringify(detail);
        return /INVALID_ARGUMENT/i.test(msg);
    } catch (_) {
        return false;
    }
}

async function postToGmb(body) {
    // Inputs / profile
    var profileId = body && body.profileId ? String(body.profileId) : "";
    var postText = body && typeof body.postText === "string" ? body.postText : "";
    var isBulk = !!body.bulk; // bulk flag: skip store writes to avoid nodemon restarts
    var mediaCaptionInput =
        body && typeof body.mediaCaption === "string" ? body.mediaCaption : "";
    if (!profileId) throw new Error("Missing profileId");

    var profile = PROFILES.find(function(p) {
        return p && p.profileId === profileId;
    });
    if (!profile) throw new Error("Profile not found");

    // Fresh basics (phone / website)
    var basics = await fetchLocationBasics(profile);

    // Resolve defaults and site candidate
    var rd = resolveDefaults(
        profile, { cta: body.cta, linkUrl: body.linkUrl, mediaUrl: body.mediaUrl },
        basics
    );
    var ctaCode = rd.cta;
    var providedLinkUrl = rd.linkUrl || "";
    var mediaUrl = rd.mediaUrl || "";
    var siteCandidate = rd.siteCandidate || "";

    // Pick photo (normalize /uploads/* to absolute HTTPS using PUBLIC_BASE_URL)
    var chosenPhoto = null;

    // 1) Respect an explicit mediaUrl if provided
    var m1 = makeAbsoluteUploadUrl(mediaUrl);
    if (m1 && isHttpsImage(m1) && isPublicHttps(m1) && !isLocalHost(m1)) {
        chosenPhoto = { url: m1, caption: mediaCaptionInput || "" };
    } else {
        // 2) Otherwise try a random photo from profile pool or UPLOADS_DIR
        var candidate =
            tryPickPhotoFromProfile(profile) || tryPickPhotoFromUploads();
        if (candidate && candidate.url) {
            var m2 = makeAbsoluteUploadUrl(candidate.url);
            if (m2 && isHttpsImage(m2) && isPublicHttps(m2) && !isLocalHost(m2)) {
                chosenPhoto = {
                    url: m2,
                    caption: candidate.caption ? String(candidate.caption) : "",
                };
            }
        }
    }
    // --- Preflight the chosen image (skip if Google likely to reject)
    if (chosenPhoto && chosenPhoto.url) {
        try {
            const probe = await probeImageUrl(chosenPhoto.url);
            if (!probe || !probe.ok) {
                console.log(
                    "ℹ️ Image preflight failed; skipping media:",
                    chosenPhoto.url,
                    probe
                );
                chosenPhoto = null;
            }
        } catch (e) {
            console.log("ℹ️ Image preflight threw; skipping media:", chosenPhoto.url);
            chosenPhoto = null;
        }
    }

    // Generate text if needed
    var generatedHashtags = [];
    if (!postText) {
        var nbh = pickNeighbourhood(profile, new Date());
        var gen = await aiGenerateSummaryAndHashtags(profile, nbh, openai);
        postText = gen && gen.summary ? gen.summary : "";
        generatedHashtags = gen && Array.isArray(gen.hashtags) ? gen.hashtags : [];
    }

    // Build body, then links (deduped)
    var summary = String(postText || "").trim();

    // Optional links section (deduped). Keep Google Maps once; prefer mapsUri over mapsUrl.
    var links = [];
    var seen = {};

    function maybePush(label, url) {
        if (!url) return;
        var key = trimUrlForCompare(url);
        if (seen[key]) return;
        seen[key] = true;
        links.push(label + " ➡️ " + url);
    }
    var maps = profile.mapsUri || profile.mapsUrl;
    maybePush("Reviews", profile.reviewsUrl);
    maybePush("Service Area", profile.serviceAreaUrl);
    maybePush("Google Maps", maps);
    if (links.length) summary += "\n\n" + links.join("\n");

    if (generatedHashtags.length > 0) {
        var spaceLeft = 1450 - summary.length;
        if (spaceLeft > 20) {
            var tagLine = safeJoinHashtags(generatedHashtags, spaceLeft);
            if (tagLine && summary.length + 2 + tagLine.length <= 1450)
                summary += "\n\n" + tagLine;
        }
    }

    // CTA rules (CALL/CALL_NOW => LEARN_MORE with site, else no CTA)
    var ctaObj = buildCallToAction(profile, ctaCode, providedLinkUrl, basics);
    if (ctaObj && ctaObj.url) {
        summary = dedupeUrlInText(summary, ctaObj.url);
    }
    if (summary.length > 1500) summary = summary.slice(0, 1500);

    // GBP payload
    var parent =
        "accounts/" + profile.accountId + "/locations/" + profile.locationId;
    var url = "https://mybusiness.googleapis.com/v4/" + parent + "/localPosts";

    var payload = { languageCode: "en", topicType: "STANDARD", summary: summary };
    if (ctaObj && ctaObj.actionType && ctaObj.url) {
        payload.callToAction = ctaObj; // web CTAs only
    }

    if (
        chosenPhoto &&
        chosenPhoto.url &&
        isPublicHttps(chosenPhoto.url) &&
        !isLocalHost(chosenPhoto.url) &&
        shouldAttachMedia(chosenPhoto.url) &&
        isValidPublicBase()
    ) {
        payload.media = [{ mediaFormat: "PHOTO", sourceUrl: chosenPhoto.url }];
    } else {
        if (!isValidPublicBase() && chosenPhoto && chosenPhoto.url) {
            console.log(
                "ℹ️ Media skipped: PUBLIC_BASE_URL is missing/invalid/placeholder:",
                PUBLIC_BASE_URL
            );
        } else if (chosenPhoto && chosenPhoto.url) {
            console.log(
                "ℹ️ Media skipped (not public https or feature off):",
                chosenPhoto.url
            );
        } else {
            console.log("ℹ️ No media selected, posting without photo.");
        }
    }

    // Call Google with up to 2 safe fallbacks:
    // 1) strip CTA on INVALID_ARGUMENT
    // 2) then strip MEDIA on INVALID_ARGUMENT
    try {
        console.log("[TRY] Posting payload:");
        try {
            console.log(JSON.stringify(payload, null, 2));
        } catch (_) {}
        var result = await callBusinessProfileAPI("POST", url, payload);

        if (!isBulk) {
            try {
                postsStore.append({
                    profileId: profileId,
                    accountId: profile.accountId,
                    locationId: profile.locationId,
                    summary: summary,
                    usedImage: payload.media ?
                        chosenPhoto ?
                        chosenPhoto.url :
                        null :
                        null,
                    gmbPostId: result && result.data && result.data.name ? result.data.name : null,
                    status: "POSTED",
                    createdAt: new Date().toISOString(),
                });
            } catch (_) {}
        }

        return {
            data: result.data,
            usedImage: payload.media ? (chosenPhoto ? chosenPhoto.url : null) : null,
            ctaUsed: payload.callToAction || null,
            ctaStripped: false,
            firstError: null,
        };
    } catch (err) {
        var detail =
            (err && err.response && err.response.data) ||
            (err && err.message) ||
            String(err);

        // Retry 1: remove CTA if invalid
        if (containsInvalidArgument(detail) && payload.callToAction) {
            console.error("❌ Google Post Error (first attempt):", detail);
            var firstError = detail;
            delete payload.callToAction;
            console.log("[RETRY_NO_CTA] Posting payload:");
            try {
                console.log(JSON.stringify(payload, null, 2));
            } catch (_) {}

            try {
                var result2 = await callBusinessProfileAPI("POST", url, payload);

                if (!isBulk) {
                    try {
                        postsStore.append({
                            profileId: profileId,
                            accountId: profile.accountId,
                            locationId: profile.locationId,
                            summary: summary,
                            usedImage: payload.media ?
                                chosenPhoto ?
                                chosenPhoto.url :
                                null :
                                null,
                            gmbPostId: result2 && result2.data && result2.data.name ?
                                result2.data.name :
                                null,
                            status: "POSTED",
                            createdAt: new Date().toISOString(),
                        });
                    } catch (_) {}
                }

                console.warn(
                    "⚠️ CTA was stripped due to INVALID_ARGUMENT; post created without CTA."
                );
                return {
                    data: result2.data,
                    usedImage: payload.media ?
                        chosenPhoto ?
                        chosenPhoto.url :
                        null :
                        null,
                    ctaUsed: null,
                    ctaStripped: true,
                    firstError: firstError,
                };
            } catch (err2) {
                var detail2 =
                    (err2 && err2.response && err2.response.data) ||
                    (err2 && err2.message) ||
                    String(err2);

                // Retry 2: remove media if still invalid and media present
                if (containsInvalidArgument(detail2) && payload.media) {
                    console.error(
                        "❌ Google Post Error (second attempt, no CTA):",
                        detail2
                    );
                    var secondError = detail2;
                    delete payload.media; // strip media entirely
                    console.log("[RETRY_NO_MEDIA] Posting payload:");
                    try {
                        console.log(JSON.stringify(payload, null, 2));
                    } catch (_) {}

                    var result3 = await callBusinessProfileAPI("POST", url, payload);

                    if (!isBulk) {
                        try {
                            postsStore.append({
                                profileId: profileId,
                                accountId: profile.accountId,
                                locationId: profile.locationId,
                                summary: summary,
                                usedImage: null,
                                gmbPostId: result3 && result3.data && result3.data.name ?
                                    result3.data.name :
                                    null,
                                status: "POSTED",
                                createdAt: new Date().toISOString(),
                            });
                        } catch (_) {}
                    }

                    console.warn(
                        "⚠️ Media was stripped due to INVALID_ARGUMENT; post created without CTA and without media."
                    );
                    return {
                        data: result3.data,
                        usedImage: null,
                        ctaUsed: null,
                        ctaStripped: true,
                        firstError: secondError,
                    };
                }

                // not invalid anymore or no media to strip -> throw
                console.error("❌ Google Post Error (second attempt):", detail2);
                throw new Error(
                    typeof detail2 === "string" ? detail2 : JSON.stringify(detail2)
                );
            }
        }

        // No CTA in payload or not INVALID_ARGUMENT -> maybe media is invalid: try once without media
        if (containsInvalidArgument(detail) && payload.media) {
            console.error(
                "❌ Google Post Error (first attempt, no CTA or CTA absent):",
                detail
            );
            var errBeforeMediaStrip = detail;
            delete payload.media;
            console.log("[RETRY_NO_MEDIA] Posting payload:");
            try {
                console.log(JSON.stringify(payload, null, 2));
            } catch (_) {}

            var resultNoMedia = await callBusinessProfileAPI("POST", url, payload);

            if (!isBulk) {
                try {
                    postsStore.append({
                        profileId: profileId,
                        accountId: profile.accountId,
                        locationId: profile.locationId,
                        summary: summary,
                        usedImage: null,
                        gmbPostId: resultNoMedia && resultNoMedia.data && resultNoMedia.data.name ?
                            resultNoMedia.data.name :
                            null,
                        status: "POSTED",
                        createdAt: new Date().toISOString(),
                    });
                } catch (_) {}
            }

            console.warn(
                "⚠️ Media was stripped due to INVALID_ARGUMENT; post created without media."
            );
            return {
                data: resultNoMedia.data,
                usedImage: null,
                ctaUsed: payload.callToAction || null,
                ctaStripped: false,
                firstError: errBeforeMediaStrip,
            };
        }

        console.error("❌ Google Post Error:", detail);
        throw new Error(
            typeof detail === "string" ? detail : JSON.stringify(detail)
        );
    }
}

// ==================== POST ROUTES (used by frontend) ====================
app.post("/post-to-gmb", async function(req, res) {
    try {
        var body = req.body || {};
        if (!body.profileId)
            return res.status(400).json({ error: "Missing profileId" });
        var r = await postToGmb({
            profileId: body.profileId,
            postText: body.postText ? body.postText : "",
            cta: body.cta ? body.cta : "",
            linkUrl: body.linkUrl ? body.linkUrl : "",
            mediaUrl: body.mediaUrl ? body.mediaUrl : "",
            mediaCaption: body.mediaCaption ? body.mediaCaption : "",
            bulk: !!body.bulk,
        });
        res.json({
            success: true,
            data: r.data,
            usedPhoto: r.usedImage ? { url: r.usedImage } : null,
            mediaAttached: !!r.usedImage,
            mediaFeatureEnabled: ATTACH_MEDIA,
            ctaUsed: r.ctaUsed || null,
            ctaStripped: !!r.ctaStripped,
            firstError: r.firstError || null,
        });
    } catch (err) {
        var errorMsg =
            (err && err.response && err.response.data) ||
            (err && err.message) ||
            String(err);
        console.error("❌ Failed to post to Google:", errorMsg);
        res
            .status(500)
            .json({ error: "Failed to post to Google", details: errorMsg });
    }
});

app.post("/post-now", async function(req, res) {
    try {
        var body = req.body || {};
        if (!body.profileId)
            return res.status(400).json({ error: "Missing profileId" });
        var r = await postToGmb({
            profileId: body.profileId,
            postText: body.postText ? body.postText : "",
            cta: body.cta ? body.cta : "",
            linkUrl: body.linkUrl ? body.linkUrl : "",
            mediaUrl: body.mediaUrl ? body.mediaUrl : "",
            mediaCaption: body.mediaCaption ? body.mediaCaption : "",
            bulk: false,
        });
        LAST_RUN_MAP[body.profileId] = new Date().toISOString();
        res.json({
            ok: true,
            data: r.data,
            ctaUsed: r.ctaUsed || null,
            ctaStripped: !!r.ctaStripped,
            firstError: r.firstError || null,
        });
    } catch (err) {
        var msg = (err && err.message) || String(err);
        res.status(500).json({ error: msg });
    }
});

app.post("/post-now-all", async function(_req, res) {
    try {
        var results = [];
        var count = 0;
        // IMPORTANT: pass bulk:true to avoid per-post file writes (nodemon restarts)
        for (var i = 0; i < PROFILES.length; i++) {
            var p = PROFILES[i];
            if (!p || !p.profileId) continue;
            try {
                var r = await postToGmb({
                    profileId: p.profileId,
                    postText: "",
                    bulk: true,
                });
                LAST_RUN_MAP[p.profileId] = new Date().toISOString();
                results.push({
                    profileId: p.profileId,
                    ok: true,
                    data: r.data,
                    ctaUsed: r.ctaUsed || null,
                    ctaStripped: !!r.ctaStripped,
                    firstError: r.firstError || null,
                });
                count++;
            } catch (e) {
                results.push({
                    profileId: p.profileId,
                    ok: false,
                    error: (e && e.message) || String(e),
                });
            }
        }
        res.json({ ok: true, count: count, results: results });
    } catch (err) {
        var msg = (err && err.message) || String(err);
        res.status(500).json({ error: msg });
    }
});

// ==================== SCHEDULER API (simple in-memory state) ====================
const DEFAULT_SCHED = {
    enabled: false,
    defaultTime: "10:00",
    tickSeconds: 30,
    perProfileTimes: {},
};
const SCHED_CFG = Object.assign({}, DEFAULT_SCHED);
const LAST_RUN_MAP = {}; // { profileId: ISOString }

app.get("/scheduler/config", function(_req, res) {
    res.json(SCHED_CFG);
});

app.put("/scheduler/config", function(req, res) {
    try {
        var body = req.body || {};
        SCHED_CFG.enabled = !!body.enabled;
        if (
            typeof body.defaultTime === "string" &&
            /^\d{2}:\d{2}$/.test(body.defaultTime)
        )
            SCHED_CFG.defaultTime = body.defaultTime;
        if (typeof body.tickSeconds === "number" && body.tickSeconds > 0)
            SCHED_CFG.tickSeconds = body.tickSeconds;
        var ppt = body.perProfileTimes || {};
        if (ppt && typeof ppt === "object") {
            var cleaned = {};
            var keys = Object.keys(ppt);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                var v = String(ppt[k] || "");
                if (/^\d{2}:\d{2}$/.test(v)) cleaned[k] = v;
            }
            SCHED_CFG.perProfileTimes = cleaned;
        }
        res.json({ ok: true, config: SCHED_CFG });
    } catch (e) {
        res.status(400).json({ error: (e && e.message) || String(e) });
    }
});

app.get("/scheduler/status", function(_req, res) {
    var todayISO = new Date().toISOString().slice(0, 10);
    var profiles = (Array.isArray(PROFILES) ? PROFILES : []).map(function(p) {
        var hhmm =
            (SCHED_CFG.perProfileTimes && SCHED_CFG.perProfileTimes[p.profileId]) ||
            SCHED_CFG.defaultTime;
        var lastRunISODate = LAST_RUN_MAP[p.profileId] || null;
        var willRunToday = !!SCHED_CFG.enabled;
        return {
            profileId: p.profileId,
            businessName: p.businessName || "",
            scheduledTime: hhmm,
            lastRunISODate: lastRunISODate,
            willRunToday: willRunToday,
        };
    });
    res.json({
        enabled: SCHED_CFG.enabled,
        defaultTime: SCHED_CFG.defaultTime,
        tickSeconds: SCHED_CFG.tickSeconds,
        todayISO: todayISO,
        profiles: profiles,
    });
});

app.post("/scheduler/run-once", async function(_req, res) {
    try {
        var results = [];
        for (var i = 0; i < PROFILES.length; i++) {
            var p = PROFILES[i];
            if (!p || !p.profileId) continue;
            try {
                var r = await postToGmb({
                    profileId: p.profileId,
                    postText: "",
                    bulk: true,
                });
                LAST_RUN_MAP[p.profileId] = new Date().toISOString();
                results.push({ profileId: p.profileId, ok: true, data: r.data });
            } catch (e) {
                results.push({
                    profileId: p.profileId,
                    ok: false,
                    error: (e && e.message) || String(e),
                });
            }
        }
        res.json({ ok: true, results: results });
    } catch (err) {
        res.status(500).json({ error: (err && err.message) || String(err) });
    }
});

app.post("/scheduler/run-now/:profileId", async function(req, res) {
    try {
        var id = req.params.profileId;
        if (!id) return res.status(400).json({ error: "Missing profileId" });
        var r = await postToGmb({ profileId: id, postText: "", bulk: false });
        LAST_RUN_MAP[id] = new Date().toISOString();
        res.json({ ok: true, data: r.data });
    } catch (err) {
        res.status(500).json({ error: (err && err.message) || String(err) });
    }
});

// ==================== POSTS HISTORY ====================
app.get("/posts/history", function(req, res) {
    var qProfileId = req.query.profileId || "";
    var qLimit = parseInt(req.query.limit || "50", 10);
    try {
        var items = [];
        if (postsStore && typeof postsStore.readLatest === "function") {
            items = postsStore.readLatest(qProfileId || null, qLimit);
        } else if (postsStore && typeof postsStore.readAll === "function") {
            items = postsStore.readAll();
            if (qProfileId)
                items = items.filter(function(x) {
                    return x && x.profileId === qProfileId;
                });
            items = items.slice(-qLimit);
        }
        res.json({ items: Array.isArray(items) ? items : [] });
    } catch (_) {
        res.json({ items: [] });
    }
});

// ==================== ROOT ====================
app.get("/", function(_req, res) {
    res.send(
        "✅ GMB Automation Backend is running. Use /auth to start authentication."
    );
});

// ========== DEBUG UPLOADS LIST ==========
app.get("/uploads-list", (req, res) => {
    try {
        const files = fs
            .readdirSync(UPLOADS_DIR)
            .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
        const urls = files
            .map((f) => makeAbsoluteUploadUrl("/uploads/" + f))
            .filter(Boolean);
        res.json({ count: files.length, files, urls });
    } catch (e) {
        let msg;
        if (e && e.message) {
            msg = e.message;
        } else {
            msg = e;
        }
        res.status(500).json({ error: String(msg) });
    }
});

// ========== DEBUG UPLOADS CHECK ==========
app.get("/uploads-check", async(req, res) => {
    try {
        const files = fs
            .readdirSync(UPLOADS_DIR)
            .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
        if (!files.length) return res.json({ ok: false, reason: "no_files" });

        const pick = files[Math.floor(Math.random() * files.length)];
        const rel = "/uploads/" + pick;
        const url = makeAbsoluteUploadUrl(rel);

        // robust preflight using same logic as posting
        const check = await probeImageUrl(url);
        res.json({
            ok: !!check.ok,
            pick,
            url,
            status: check.status,
            contentType: check.contentType,
        });
    } catch (e) {
        let msg;
        if (e && e.message) {
            msg = e.message;
        } else {
            msg = e;
        }
        res.status(500).json({ error: String(msg) });
    }
});

// ==================== SERVER LIFECYCLE ====================
let server = null;

function tryListen(startPort, maxAttempts, cb) {
    let attempt = 0;

    function start() {
        const p = startPort + attempt;
        const s = app.listen(p, function() {
            server = s;
            serverPort = p;
            console.log(
                "🚀 Backend running at http://localhost:" +
                p +
                " (requested " +
                (process.env.PORT || 4000) +
                ")"
            );
            cb(null, s, p);
        });
        s.on("error", function(err) {
            if (err && err.code === "EADDRINUSE" && attempt < maxAttempts) {
                attempt += 1;
                console.warn(
                    "⚠️ Port " + p + " is busy, trying " + (startPort + attempt) + "..."
                );
                start();
            } else {
                cb(err || new Error("Failed to bind port"), null, null);
            }
        });
    }
    start();
}

tryListen(Number(process.env.PORT || 4000), 10, function(err) {
    if (err) {
        console.error("💥 HTTP server error:", (err && err.message) || String(err));
        process.exit(1);
    }
});

process.on("exit", function(code) {
    console.log("👋 Process exit with code:", code);
});
process.on("SIGINT", function() {
    console.log("🛑 SIGINT received");
});
process.on("SIGTERM", function() {
    console.log("🛑 SIGTERM received");
});
process.on("uncaughtException", function(err) {
    console.error("⚠️ Uncaught Exception:", (err && err.stack) || String(err));
});
process.on("unhandledRejection", function(reason) {
    console.error("⚠️ Unhandled Rejection:", String(reason));
});