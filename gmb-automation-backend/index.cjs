// ==================== BOOTSTRAP ====================
require("dotenv").config();
const ATTACH_MEDIA = String(process.env.POST_ATTACH_MEDIA || "").toLowerCase() === "true";
const cors = require("cors");
const express = require("express");
const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 4000);
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
const { makeScheduler } = require("./server/scheduler.cjs");

// Allow the React dev server (localhost:3000 or 3001) to call the backend


// Allow the React dev server to call the backend
app.use(
    cors({
        origin: function(origin, cb) {
            if (!origin) return cb(null, true); // curl/postman/no Origin
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
    const p = profile || {};
    const arr = Array.isArray(p.neighbourhoods) ? p.neighbourhoods : [];
    if (arr.length === 0) return p.city || "";
    const d = date || new Date();
    const idx = (d.getDate() - 1) % arr.length;
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
    const city = profile && profile.city ? profile.city : "";
    const businessName =
        profile && profile.businessName ? profile.businessName : "";
    const keywords = Array.isArray(profile && profile.keywords) ?
        profile.keywords : [];
    const kwLine = keywords.join(", ");
    const where =
        neighbourhood && neighbourhood !== "" ? neighbourhood + ", " + city : city;

    const prompt =
        "Return ONLY valid JSON with fields: summary (string), hashtags (array of 5-7 strings). " +
        "Do not include markdown fences. " +
        "Constraints: summary 80-120 words, friendly, benefit-focused, no phone numbers, no emojis in body, no hashtags in body. " +
        "Mention location and natural local SEO phrases. End body with a clear CTA to request a free quote today. " +
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

    const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
    });

    let txt = "";
    if (
        completion &&
        completion.choices &&
        completion.choices[0] &&
        completion.choices[0].message &&
        completion.choices[0].message.content
    ) {
        txt = completion.choices[0].message.content;
    }

    const obj = parseJsonResponse(txt);
    if (!obj) return { summary: String(txt || "").trim(), hashtags: [] };

    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    const hashtags = Array.isArray(obj.hashtags) ? obj.hashtags : [];
    const cleaned = [];
    for (let i = 0; i < hashtags.length; i++) {
        let h = String(hashtags[i] || "").trim();
        if (h === "") continue;
        if (h[0] !== "#") h = "#" + h.replace(/^#+/, "");
        cleaned.push(h);
    }
    return { summary, hashtags: cleaned };
}

// ---- Media helpers (no optional chaining) ----
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
        if (p && typeof p === "object") return p; // { url, caption? }
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

// ==================== GBP: ACCOUNTS & LOCATIONS ====================
app.get("/accounts", async function(_req, res) {
    try {
        const url =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts";
        const result = await callBusinessProfileAPI("GET", url);
        res.json(result.data);
    } catch (e) {
        const errMsg =
            e && e.response && e.response.data ?
            e.response.data :
            e && e.message ?
            e.message :
            String(e);
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
            e && e.response && e.response.data ?
            e.response.data :
            e && e.message ?
            e.message :
            String(e);
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
        const msg = e && e.message ? e.message : String(e);
        res.status(500).json({ error: msg });
    }
});

// ==================== AI POST GENERATION (preview) ====================
app.get("/generate-post-by-profile", async function(req, res) {
    const profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: "Missing profileId" });

    const profile = PROFILES.find(function(p) {
        return p && p.profileId === profileId;
    });
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

        let postText = summaryAI + "\n\n";
        if (profile.reviewsUrl)
            postText += "Reviews ➡️ " + profile.reviewsUrl + "\n";
        if (profile.serviceAreaUrl)
            postText += "Service Area ➡️ " + profile.serviceAreaUrl + "\n";
        if (profile.mapsUrl) postText += "Google Maps ➡️ " + profile.mapsUrl + "\n";
        if (profile.areaMapUrl)
            postText += "Area Map ➡️ " + profile.areaMapUrl + "\n";
        if (hashtagsAI && hashtagsAI.length > 0)
            postText += "\n" + hashtagsAI.join(" ");

        console.log("✅ Post generated for " + profile.businessName);
        return res.json({
            profileId: profile.profileId,
            businessName: profile.businessName,
            city: profile.city,
            neighbourhood: neighbourhood,
            post: postText,
        });
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
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
        const msg = err && err.message ? err.message : String(err);
        console.error("Error retrieving access token", msg);
        res.status(500).send("Auth failed");
    }
});

// ==================== CORE POST LOGIC (reused by routes & scheduler) ====================
async function postToGmb(body) {
    const profileId = body.profileId;
    let postText = body.postText || "";
    const cta = body.cta || "";
    const linkUrl = body.linkUrl || "";

    const profile = PROFILES.find(function(p) {
        return p && p.profileId === profileId;
    });
    if (!profile) throw new Error("Profile not found");

    // Pick photo
    let chosenPhoto = tryPickPhotoFromProfile(profile);
    if (!chosenPhoto) chosenPhoto = tryPickPhotoFromUploads();

    // Generate text if needed
    let generatedHashtags = [];
    if (!postText) {
        const nbh = pickNeighbourhood(profile, new Date());
        const gen = await aiGenerateSummaryAndHashtags(profile, nbh, openai);
        postText = gen && gen.summary ? gen.summary : "";
        generatedHashtags = gen && Array.isArray(gen.hashtags) ? gen.hashtags : [];
    }

    // Append links + hashtags
    let summary = String(postText || "").trim();
    if (profile.reviewsUrl) summary += "\n\nReviews ➡️ " + profile.reviewsUrl;
    if (profile.serviceAreaUrl)
        summary += "\nService Area ➡️ " + profile.serviceAreaUrl;
    if (profile.mapsUrl) summary += "\nGoogle Maps ➡️ " + profile.mapsUrl;
    if (profile.areaMapUrl) summary += "\nArea Map ➡️ " + profile.areaMapUrl;

    if (generatedHashtags.length > 0) {
        const spaceLeft = 1450 - summary.length;
        if (spaceLeft > 20) {
            const tagLine = safeJoinHashtags(generatedHashtags, spaceLeft);
            if (tagLine && summary.length + 2 + tagLine.length <= 1450)
                summary += "\n\n" + tagLine;
        }
    }
    if (summary.length > 1500) summary = summary.slice(0, 1500);

    // Build GBP payload
    const parent =
        "accounts/" + profile.accountId + "/locations/" + profile.locationId;
    const url = "https://mybusiness.googleapis.com/v4/" + parent + "/localPosts";

    const payload = {
        languageCode: "en",
        topicType: "STANDARD",
        summary: summary,
    };
    if (cta && linkUrl) payload.callToAction = { actionType: cta, url: linkUrl };

    if (chosenPhoto && chosenPhoto.url) {
        // note: GBP requires public https; we'll still attach only if allowed + public
        const absLocal = "http://localhost:" + serverPort + chosenPhoto.url;
        if (shouldAttachMedia(absLocal)) {
            payload.media = [{ mediaFormat: "PHOTO", sourceUrl: absLocal }];
        }
    }

    const result = await callBusinessProfileAPI("POST", url, payload);

    // persist a history record
    try {
        postsStore.append({
            profileId: profileId,
            accountId: profile.accountId,
            locationId: profile.locationId,
            summary: summary,
            usedImage: payload.media ? (chosenPhoto ? chosenPhoto.url : null) : null,
            gmbPostId: result && result.data && result.data.name ? result.data.name : null,
            status: "POSTED",
            createdAt: new Date().toISOString(),
        });
    } catch (_) {}

    return {
        data: result.data,
        usedImage: payload.media ? (chosenPhoto ? chosenPhoto.url : null) : null,
    };
}

// ==================== POST ROUTES (used by frontend) ====================
app.post("/post-to-gmb", async function(req, res) {
    try {
        const body = req.body || {};
        if (!body.profileId)
            return res.status(400).json({ error: "Missing profileId" });
        const r = await postToGmb({
            profileId: body.profileId,
            postText: body.postText || "",
            cta: body.cta || "",
            linkUrl: body.linkUrl || "",
        });
        res.json({
            success: true,
            data: r.data,
            usedPhoto: r.usedImage ? { url: r.usedImage } : null,
            mediaAttached: !!r.usedImage,
            mediaFeatureEnabled: ATTACH_MEDIA,
        });
    } catch (err) {
        let errorMsg;
        if (err && err.response && err.response.data) errorMsg = err.response.data;
        else if (err && err.message) errorMsg = err.message;
        else errorMsg = String(err);
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
            postText: body.postText || "",
            cta: body.cta || "",
            linkUrl: body.linkUrl || "",
        });
        LAST_RUN_MAP[body.profileId] = new Date().toISOString();
        res.json({ ok: true, data: r.data });
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        res.status(500).json({ error: msg });
    }
});

app.post("/post-now-all", async function(_req, res) {
    try {
        const results = [];
        let count = 0;
        for (let i = 0; i < PROFILES.length; i++) {
            const p = PROFILES[i];
            if (!p || !p.profileId) continue;
            try {
                const r = await postToGmb({ profileId: p.profileId, postText: "" });
                LAST_RUN_MAP[p.profileId] = new Date().toISOString();
                results.push({ profileId: p.profileId, ok: true, data: r.data });
                count++;
            } catch (e) {
                results.push({
                    profileId: p.profileId,
                    ok: false,
                    error: e && e.message ? e.message : String(e),
                });
            }
        }
        res.json({ ok: true, count: count, results: results });
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
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
let SCHED_CFG = Object.assign({}, DEFAULT_SCHED);
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
        ) {
            SCHED_CFG.defaultTime = body.defaultTime;
        }
        if (typeof body.tickSeconds === "number" && body.tickSeconds > 0) {
            SCHED_CFG.tickSeconds = body.tickSeconds;
        }
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
        res.status(400).json({ error: e && e.message ? e.message : String(e) });
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
                const r = await postToGmb({ profileId: p.profileId, postText: "" });
                LAST_RUN_MAP[p.profileId] = new Date().toISOString();
                results.push({ profileId: p.profileId, ok: true, data: r.data });
            } catch (e) {
                results.push({
                    profileId: p.profileId,
                    ok: false,
                    error: e && e.message ? e.message : String(e),
                });
            }
        }
        res.json({ ok: true, results: results });
    } catch (err) {
        res
            .status(500)
            .json({ error: err && err.message ? err.message : String(err) });
    }
});

app.post("/scheduler/run-now/:profileId", async function(req, res) {
    try {
        const id = req.params.profileId;
        if (!id) return res.status(400).json({ error: "Missing profileId" });
        const r = await postToGmb({ profileId: id, postText: "" });
        LAST_RUN_MAP[id] = new Date().toISOString();
        res.json({ ok: true, data: r.data });
    } catch (err) {
        res
            .status(500)
            .json({ error: err && err.message ? err.message : String(err) });
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

// ==================== SERVER LIFECYCLE ====================
let server = null;
let serverPort = Number(process.env.PORT || 4000);

// simple auto-pick logic: try requested port; if busy, try +1, up to +10
function tryListen(startPort, maxAttempts, cb) {
    let attempt = 0;

    function start() {
        const p = startPort + attempt;
        const s = app.listen(p, function() {
            server = s;
            serverPort = p;
            console.log("🚀 Backend running at http://localhost:" + p + " (requested " + (process.env.PORT || 4000) + ")");
            cb(null, s, p);
        });
        s.on("error", function(err) {
            if (err && err.code === "EADDRINUSE" && attempt < maxAttempts) {
                attempt += 1;
                console.warn("⚠️ Port " + p + " is busy, trying " + (startPort + attempt) + "...");
                start();
            } else {
                cb(err || new Error("Failed to bind port"), null, null);
            }
        });
    }
    start();
}

tryListen(serverPort, 10, function(err) {
    if (err) {
        console.error("💥 HTTP server error:", err && err.message ? err.message : String(err));
        process.exit(1);
    }
});

// helpful logs if something is closing the server
process.on("exit", function(code) { console.log("👋 Process exit with code:", code); });
process.on("SIGINT", function() { console.log("🛑 SIGINT received"); });
process.on("SIGTERM", function() { console.log("🛑 SIGTERM received"); });
process.on("uncaughtException", function(err) {
    console.error("⚠️ Uncaught Exception:", err && err.stack ? err.stack : String(err));
});
process.on("unhandledRejection", function(reason) {
    console.error("⚠️ Unhandled Rejection:", String(reason));
});