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
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));

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
    let out = "";
    for (let i = 0; i < arr.length; i++) {
        let h = String(arr[i] || "").trim();
        if (h === "") continue;
        if (h[0] !== "#") h = "#" + h.replace(/^#+/, "");
        const candidate = out === "" ? h : out + " " + h;
        if (candidate.length > maxChars) break;
        out = candidate;
    }
    return out;
}

function parseJsonResponse(text) {
    let s = String(text || "");
    if (s.indexOf("```") !== -1) {
        const first = s.indexOf("{");
        const last = s.lastIndexOf("}");
        if (first !== -1 && last !== -1 && last > first)
            s = s.slice(first, last + 1);
    }
    try {
        const obj = JSON.parse(s);
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
        const p =
            profile.photoPool[Math.floor(Math.random() * profile.photoPool.length)];
        if (p && typeof p === "object") return p;
    }
    return null;
}

function tryPickPhotoFromUploads() {
    const uploadDir = path.join(__dirname, "data", "uploads");
    if (!fs.existsSync(uploadDir)) return null;
    const files = fs.readdirSync(uploadDir).filter(function(f) {
        return !f.startsWith(".") && /\.(jpg|jpeg|png|webp)$/i.test(f);
    });
    if (files.length === 0) return null;
    const randomFile = files[Math.floor(Math.random() * files.length)];
    return { url: "/uploads/" + randomFile, caption: "" };
}

function isHttpsImage(u) {
    try {
        const x = new URL(u);
        return (
            x.protocol === "https:" && /\.(png|jpe?g|webp)$/i.test(x.pathname || "")
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
        const x = new URL(u);
        return (x.origin + x.pathname).replace(/\/+$/, "");
    } catch (_) {
        return String(u || "").replace(/\/+$/, "");
    }
}

function dedupeUrlInText(text, url) {
    if (!text || !url) return text || "";
    const core = escapeRegExp(trimUrlForCompare(url));
    const rx = new RegExp("(https?:\\/\\/[^\\s]*" + core + "\\/?)", "ig");
    let seen = false;
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
    let out = { websiteUri: "", primaryPhone: "" };
    if (!profile) return out;

    const key = getCacheKey(profile);
    if (key && LOCATION_CACHE[key]) {
        const ageMs = Date.now() - LOCATION_CACHE[key].ts;
        if (ageMs < 5 * 60 * 1000) return LOCATION_CACHE[key]; // 5 min cache
    }
    try {
        const accountId = String(profile.accountId || "");
        const locationId = String(profile.locationId || "");
        if (!accountId || !locationId) return out;

        const url =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/" +
            accountId +
            "/locations/" +
            locationId +
            "?readMask=websiteUri,phoneNumbers";
        const resp = await callBusinessProfileAPI("GET", url);
        const data = resp && resp.data ? resp.data : {};

        const websiteUri = data && data.websiteUri ? String(data.websiteUri) : "";
        let primaryPhone = "";
        if (data && data.phoneNumbers && data.phoneNumbers.primaryPhone) {
            primaryPhone = String(data.phoneNumbers.primaryPhone);
        }
        out = {
            websiteUri,
            primaryPhone,
            ts: Date.now(),
        };
        if (key) LOCATION_CACHE[key] = out;
        return out;
    } catch (e) {
        const fallbackPhone = profile && profile.phone ? String(profile.phone) : "";
        const fallbackSite =
            profile && profile.landingUrl ? String(profile.landingUrl) : "";
        out = {
            websiteUri: fallbackSite,
            primaryPhone: fallbackPhone,
            ts: Date.now(),
        };
        const k = getCacheKey(profile);
        if (k) LOCATION_CACHE[k] = out;
        return out;
    }
}

// Resolve CTA/link/media using body, profile defaults, and Google basics
function resolveDefaults(profile, body, basics) {
    const d = profile && profile.defaults ? profile.defaults : {};
    const incomingCta =
        body && typeof body.cta === "string" && body.cta ? body.cta : "";
    const incomingLink =
        body && typeof body.linkUrl === "string" ? body.linkUrl : null; // null = not provided
    const incomingMedia =
        body && typeof body.mediaUrl === "string" ? body.mediaUrl : null;

    const cta = incomingCta ? incomingCta : d.cta ? d.cta : "LEARN_MORE"; // default to LEARN_MORE now

    // website candidate priority: defaults.linkUrl > profile.landingUrl > Google websiteUri
    const siteFromDefaults = typeof d.linkUrl === "string" ? d.linkUrl : "";
    const siteFromProfile =
        profile && profile.landingUrl ? String(profile.landingUrl) : "";
    const siteFromGoogle =
        basics && basics.websiteUri ? String(basics.websiteUri) : "";
    const siteCandidate = siteFromDefaults || siteFromProfile || siteFromGoogle;

    const linkUrl = incomingLink !== null ? incomingLink : siteCandidate;

    const defMedia = typeof d.mediaUrl === "string" ? d.mediaUrl : "";
    const mediaUrl = incomingMedia !== null ? incomingMedia : defMedia;

    return { cta, linkUrl, mediaUrl, siteCandidate };
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
        let candidate = typeof linkUrl === "string" && linkUrl ? linkUrl : "";
        if (!/^https?:\/\//i.test(candidate || "")) {
            candidate =
                (basics && basics.websiteUri) || (profile && profile.landingUrl) || "";
        }
        if (candidate && /^https?:\/\//i.test(candidate)) {
            return { actionType: "LEARN_MORE", url: candidate };
        }
        return null; // no site -> no CTA
    }

    const spec = CTA_MAP[ctaCode] || null;
    if (!spec) return null;

    // only http(s) CTAs here
    let candidate = typeof linkUrl === "string" && linkUrl ? linkUrl : "";
    if (!/^https?:\/\//i.test(candidate || "")) {
        candidate =
            (basics && basics.websiteUri) || (profile && profile.landingUrl) || "";
    }
    if (!candidate || !/^https?:\/\//i.test(candidate)) return null;

    return { actionType: spec.actionType, url: candidate };
}

// ==================== GBP: ACCOUNTS & LOCATIONS ====================
app.get("/accounts", async function(_req, res) {
    try {
        const url =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts";
        const result = await callBusinessProfileAPI("GET", url);
        res.json(result.data);
    } catch (e) {
        const errMsg =
            (e && e.response && e.response.data) || (e && e.message) || String(e);
        res.status(500).json({ error: errMsg });
    }
});

app.get("/locations", async function(req, res) {
    try {
        const accountId = req.query.accountId;
        let readMask = req.query.readMask;
        if (!accountId) return res.status(400).json({ error: "Missing accountId" });
        if (!readMask || readMask.trim() === "") {
            readMask =
                "name,title,storeCode,languageCode,websiteUri,phoneNumbers,metadata";
        }
        const base =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/" +
            accountId +
            "/locations";
        const url =
            base + "?readMask=" + encodeURIComponent(readMask) + "&pageSize=100";
        const result = await callBusinessProfileAPI("GET", url);
        res.json(result.data);
    } catch (e) {
        const errMsg =
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
        let listFromStore = [];
        try {
            listFromStore = profilesStore.readAll();
        } catch (_) {}
        const out =
            Array.isArray(PROFILES) && PROFILES.length > 0 ?
            PROFILES :
            Array.isArray(listFromStore) ?
            listFromStore : [];
        res.json({ profiles: out });
    } catch (e) {
        const msg = (e && e.message) || String(e);
        res.status(500).json({ error: msg });
    }
});

// ==================== UPDATE PROFILE DEFAULTS ====================
app.patch("/profiles/:id/defaults", async function(req, res) {
    try {
        const id = req.params.id;
        const body = req.body || {};
        const p = PROFILES.find((x) => x && x.profileId === id);
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
    const profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: "Missing profileId" });

    const profile = PROFILES.find((p) => p && p.profileId === profileId);
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const neighbourhood = pickNeighbourhood(profile) || profile.city;
    try {
        console.log(
            "📝 Generating post for " +
            profile.businessName +
            " in " +
            neighbourhood +
            "..."
        );
        const resultAI = await aiGenerateSummaryAndHashtags(
            profile,
            neighbourhood,
            openai
        );
        const summaryAI = resultAI ? resultAI.summary : "";
        const hashtagsAI =
            resultAI && Array.isArray(resultAI.hashtags) ? resultAI.hashtags : [];
        if (!summaryAI) throw new Error("No summary returned from AI");

        // keep body separate from hashtags; no links here to avoid doubles
        let postText = summaryAI;
        if (hashtagsAI && hashtagsAI.length > 0) {
            postText += "\n\n" + hashtagsAI.join(" ");
        }

        console.log("✅ Post generated for " + profile.businessName);
        return res.json({
            profileId: profile.profileId,
            businessName: profile.businessName,
            city: profile.city,
            neighbourhood,
            post: postText,
        });
    } catch (err) {
        const msg = (err && err.message) || String(err);
        console.error("❌ AI generation error:", msg);
        return res
            .status(500)
            .json({ error: "Failed to generate post", details: msg });
    }
});

// ==================== GOOGLE AUTH ====================
app.get("/auth", function(_req, res) {
    const scopes = ["https://www.googleapis.com/auth/business.manage"];
    const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
    });
    res.redirect(url);
});

app.get("/oauth2callback", async function(req, res) {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");
    try {
        const tokenResp = await oauth2Client.getToken(code);
        const tokens = tokenResp && tokenResp.tokens ? tokenResp.tokens : null;
        if (tokens) oauth2Client.setCredentials(tokens);
        const TOKENS_PATH = path.join(__dirname, "data", "tokens.json");
        fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
        fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
        res.send("✅ Tokens saved successfully! You can now use the API.");
    } catch (err) {
        const msg = (err && err.message) || String(err);
        console.error("Error retrieving access token", msg);
        res.status(500).send("Auth failed");
    }
});

// ==================== CORE POST LOGIC ====================
async function postToGmb(body) {
    // Inputs / profile
    const profileId = body && body.profileId ? String(body.profileId) : "";
    let postText = body && typeof body.postText === "string" ? body.postText : "";
    const isBulk = !!body.bulk; // bulk flag: skip store writes to avoid nodemon restarts
    if (!profileId) throw new Error("Missing profileId");

    const profile = PROFILES.find((p) => p && p.profileId === profileId);
    if (!profile) throw new Error("Profile not found");

    // Fresh basics (phone / website)
    const basics = await fetchLocationBasics(profile);

    // Resolve defaults and site candidate
    const rd = resolveDefaults(
        profile, { cta: body.cta, linkUrl: body.linkUrl, mediaUrl: body.mediaUrl },
        basics
    );
    const ctaCode = rd.cta;
    const providedLinkUrl = rd.linkUrl || "";
    const mediaUrl = rd.mediaUrl || "";
    const siteCandidate = rd.siteCandidate || "";

    // Pick photo
    let chosenPhoto = null;
    if (
        isHttpsImage(mediaUrl) &&
        isPublicHttps(mediaUrl) &&
        !isLocalHost(mediaUrl)
    ) {
        chosenPhoto = { url: mediaUrl, caption: "" };
    } else {
        const candidate =
            tryPickPhotoFromProfile(profile) || tryPickPhotoFromUploads();
        if (
            candidate &&
            candidate.url &&
            isPublicHttps(candidate.url) &&
            !isLocalHost(candidate.url)
        ) {
            chosenPhoto = candidate;
        }
    }

    // Generate text if needed
    let generatedHashtags = [];
    if (!postText) {
        const nbh = pickNeighbourhood(profile, new Date());
        const gen = await aiGenerateSummaryAndHashtags(profile, nbh, openai);
        postText = gen && gen.summary ? gen.summary : "";
        generatedHashtags = gen && Array.isArray(gen.hashtags) ? gen.hashtags : [];
    }

    // Build body, then links (deduped)
    let summary = String(postText || "").trim();

    // Optional links section (deduped). Keep Google Maps once; prefer mapsUri over mapsUrl.
    const links = [];
    const seen = {};

    function maybePush(label, url) {
        if (!url) return;
        const key = trimUrlForCompare(url);
        if (seen[key]) return;
        seen[key] = true;
        links.push(label + " ➡️ " + url);
    }
    const maps = profile.mapsUri || profile.mapsUrl;
    maybePush("Reviews", profile.reviewsUrl);
    maybePush("Service Area", profile.serviceAreaUrl);
    maybePush("Google Maps", maps);
    if (links.length) summary += "\n\n" + links.join("\n");

    if (generatedHashtags.length > 0) {
        const spaceLeft = 1450 - summary.length;
        if (spaceLeft > 20) {
            const tagLine = safeJoinHashtags(generatedHashtags, spaceLeft);
            if (tagLine && summary.length + 2 + tagLine.length <= 1450)
                summary += "\n\n" + tagLine;
        }
    }

    // CTA rules (CALL/CALL_NOW => LEARN_MORE with site, else no CTA)
    const ctaObj = buildCallToAction(profile, ctaCode, providedLinkUrl, basics);
    if (ctaObj && ctaObj.url) {
        summary = dedupeUrlInText(summary, ctaObj.url);
    }
    if (summary.length > 1500) summary = summary.slice(0, 1500);

    // GBP payload
    const parent =
        "accounts/" + profile.accountId + "/locations/" + profile.locationId;
    const url = "https://mybusiness.googleapis.com/v4/" + parent + "/localPosts";

    const payload = { languageCode: "en", topicType: "STANDARD", summary };
    if (ctaObj && ctaObj.actionType && ctaObj.url) {
        payload.callToAction = ctaObj; // web CTAs only
    }

    if (
        chosenPhoto &&
        chosenPhoto.url &&
        isPublicHttps(chosenPhoto.url) &&
        !isLocalHost(chosenPhoto.url) &&
        shouldAttachMedia(chosenPhoto.url)
    ) {
        payload.media = [{ mediaFormat: "PHOTO", sourceUrl: chosenPhoto.url }];
    }

    // Call Google (with one automatic retry stripping CTA if Google rejects it)
    try {
        console.log("[TRY] Posting payload:");
        try {
            console.log(JSON.stringify(payload, null, 2));
        } catch (_) {}
        const result = await callBusinessProfileAPI("POST", url, payload);

        // persist a history record (skip during bulk to avoid nodemon restarts)
        if (!isBulk) {
            try {
                postsStore.append({
                    profileId,
                    accountId: profile.accountId,
                    locationId: profile.locationId,
                    summary,
                    usedImage: payload.media ?
                        chosenPhoto ?
                        chosenPhoto.url :
                        null : null,
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
        const detail =
            (err && err.response && err.response.data) ||
            (err && err.message) ||
            String(err);

        // If Google rejects the CTA, strip it and retry once (to prevent a hard fail)
        let shouldRetryWithoutCTA = false;
        try {
            const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
            if (/INVALID_ARGUMENT/i.test(msg)) shouldRetryWithoutCTA = true;
        } catch (_) {}

        if (shouldRetryWithoutCTA && payload.callToAction) {
            console.error("❌ Google Post Error (first attempt):", detail);
            const firstError = detail;
            delete payload.callToAction;
            console.log("[RETRY_NO_CTA] Posting payload:");
            try {
                console.log(JSON.stringify(payload, null, 2));
            } catch (_) {}
            const result2 = await callBusinessProfileAPI("POST", url, payload);

            if (!isBulk) {
                try {
                    postsStore.append({
                        profileId,
                        accountId: profile.accountId,
                        locationId: profile.locationId,
                        summary,
                        usedImage: payload.media ?
                            chosenPhoto ?
                            chosenPhoto.url :
                            null : null,
                        gmbPostId: result2 && result2.data && result2.data.name ?
                            result2.data.name : null,
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
                    null : null,
                ctaUsed: null,
                ctaStripped: true,
                firstError,
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
        const body = req.body || {};
        if (!body.profileId)
            return res.status(400).json({ error: "Missing profileId" });
        const r = await postToGmb({
            profileId: body.profileId,
            postText: body.postText ? body.postText : "",
            cta: body.cta ? body.cta : "",
            linkUrl: body.linkUrl ? body.linkUrl : "",
            mediaUrl: body.mediaUrl ? body.mediaUrl : "",
            bulk: !!body.bulk, // passthrough
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
        const errorMsg =
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
        const body = req.body || {};
        if (!body.profileId)
            return res.status(400).json({ error: "Missing profileId" });
        const r = await postToGmb({
            profileId: body.profileId,
            postText: body.postText ? body.postText : "",
            cta: body.cta ? body.cta : "",
            linkUrl: body.linkUrl ? body.linkUrl : "",
            mediaUrl: body.mediaUrl ? body.mediaUrl : "",
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
        const msg = (err && err.message) || String(err);
        res.status(500).json({ error: msg });
    }
});

app.post("/post-now-all", async function(_req, res) {
    try {
        const results = [];
        let count = 0;
        // IMPORTANT: pass bulk:true to avoid per-post file writes (nodemon restarts)
        for (let i = 0; i < PROFILES.length; i++) {
            const p = PROFILES[i];
            if (!p || !p.profileId) continue;
            try {
                const r = await postToGmb({
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
        res.json({ ok: true, count, results });
    } catch (err) {
        const msg = (err && err.message) || String(err);
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
        const body = req.body || {};
        SCHED_CFG.enabled = !!body.enabled;
        if (
            typeof body.defaultTime === "string" &&
            /^\d{2}:\d{2}$/.test(body.defaultTime)
        )
            SCHED_CFG.defaultTime = body.defaultTime;
        if (typeof body.tickSeconds === "number" && body.tickSeconds > 0)
            SCHED_CFG.tickSeconds = body.tickSeconds;
        const ppt = body.perProfileTimes || {};
        if (ppt && typeof ppt === "object") {
            const cleaned = {};
            const keys = Object.keys(ppt);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const v = String(ppt[k] || "");
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
    const todayISO = new Date().toISOString().slice(0, 10);
    const profiles = (Array.isArray(PROFILES) ? PROFILES : []).map(function(p) {
        const hhmm =
            (SCHED_CFG.perProfileTimes && SCHED_CFG.perProfileTimes[p.profileId]) ||
            SCHED_CFG.defaultTime;
        const lastRunISODate = LAST_RUN_MAP[p.profileId] || null;
        const willRunToday = !!SCHED_CFG.enabled;
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
        const results = [];
        for (let i = 0; i < PROFILES.length; i++) {
            const p = PROFILES[i];
            if (!p || !p.profileId) continue;
            try {
                const r = await postToGmb({
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
        res.json({ ok: true, results });
    } catch (err) {
        res.status(500).json({ error: (err && err.message) || String(err) });
    }
});

app.post("/scheduler/run-now/:profileId", async function(req, res) {
    try {
        const id = req.params.profileId;
        if (!id) return res.status(400).json({ error: "Missing profileId" });
        const r = await postToGmb({ profileId: id, postText: "", bulk: false });
        LAST_RUN_MAP[id] = new Date().toISOString();
        res.json({ ok: true, data: r.data });
    } catch (err) {
        res.status(500).json({ error: (err && err.message) || String(err) });
    }
});

// ==================== POSTS HISTORY ====================
app.get("/posts/history", function(req, res) {
    const qProfileId = req.query.profileId || "";
    const qLimit = parseInt(req.query.limit || "50", 10);
    try {
        let items = [];
        if (postsStore && typeof postsStore.readLatest === "function") {
            items = postsStore.readLatest(qProfileId || null, qLimit);
        } else if (postsStore && typeof postsStore.readAll === "function") {
            items = postsStore.readAll();
            if (qProfileId)
                items = items.filter((x) => x && x.profileId === qProfileId);
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