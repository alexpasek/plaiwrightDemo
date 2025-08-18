// ==================== BOOTSTRAP ====================
require("dotenv").config();
const ATTACH_MEDIA =
    String(process.env.POST_ATTACH_MEDIA || "").toLowerCase() === "true";

const express = require("express");
const app = express();
const port = 4000; // default; smart binder may use PORT env or next free port
const fs = require("fs");
const path = require("path");
const axios = require("axios"); // optional
const OpenAI = require("openai");

// Routes (uploads/photos)
const uploadRoutes = require("./server/upload.cjs");

// Google helpers
const { oauth2Client, callBusinessProfileAPI } = require("./google-client.cjs");
// ==================== APP CREATION: BASIC CONTROL ENDPOINTS ====================

// Simple version endpoint for your UI
app.get("/version", function(_req, res) {
    res.json({
        name: "gmb-automation-backend",
        version: "0.1.0",
        features: {
            generatePost: true,
            postNow: true,
            postNowAll: true,
            mediaAttach: ATTACH_MEDIA
        }
    });
});

// Post NOW for a single profile (optional postText/cta/linkUrl)
// curl -s -X POST http://localhost:4000/post-now -H "Content-Type: application/json" -d '{"profileId":"popcorn-pro-1"}'
app.post("/post-now", async function(req, res) {
    try {
        const b = req.body || {};
        const profileId = b.profileId;
        if (!profileId) return res.status(400).json({ error: "Missing profileId" });

        const payload = {
            profileId: profileId,
            postText: b.postText || "",
            cta: b.cta || "",
            linkUrl: b.linkUrl || ""
        };

        const result = await postToGmb(payload);
        res.json({ ok: true, result: result });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("❌ /post-now failed:", msg);
        res.status(500).json({ ok: false, error: msg });
    }
});

// Post NOW for ALL saved profiles (text will be AI-generated per profile if not provided)
// curl -s -X POST http://localhost:4000/post-now-all | jq .
app.post("/post-now-all", async function(_req, res) {
    try {
        // Use the file-backed list to be in sync with UI saves
        var all = [];
        try { all = profilesStore.readAll(); } catch (_) {}
        if (!Array.isArray(all) || all.length === 0) {
            // fallback to PROFILES loaded at boot
            all = Array.isArray(PROFILES) ? PROFILES : [];
        }

        if (all.length === 0) {
            return res.status(400).json({ ok: false, error: "No profiles found" });
        }

        const results = [];
        for (var i = 0; i < all.length; i++) {
            const p = all[i];
            if (!p || !p.profileId) continue;

            try {
                const r = await postToGmb({
                    profileId: p.profileId,
                    postText: "", // let AI generate if empty
                    cta: "",
                    linkUrl: ""
                });
                results.push({ profileId: p.profileId, ok: true, data: r });
            } catch (errOne) {
                const em = errOne && errOne.message ? errOne.message : String(errOne);
                results.push({ profileId: p.profileId, ok: false, error: em });
            }
        }

        res.json({ ok: true, count: results.length, results: results });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("❌ /post-now-all failed:", msg);
        res.status(500).json({ ok: false, error: msg });
    }
});

// Data stores
const profilesStore = require("./server/profile-store.cjs");

// Express middleware
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

// ==================== Profiles CRUD ====================

app.get("/profiles", function(_req, res) {
    try {
        const list = profilesStore.readAll();
        res.json({ profiles: list });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        res.status(500).json({ error: msg });
    }
});

app.post("/profiles", function(req, res) {
    try {
        const p = req.body;
        if (!p ||
            !p.profileId ||
            !p.accountId ||
            !p.locationId ||
            !p.businessName
        ) {
            return res.status(400).json({
                error: "Missing fields: profileId, accountId, locationId, businessName are required",
            });
        }
        profilesStore.upsert(p);
        res.json({ ok: true, profile: p });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        res.status(500).json({ error: msg });
    }
});

app.delete("/profiles/:profileId", function(req, res) {
    try {
        const id = req.params.profileId;
        if (!id) return res.status(400).json({ error: "Missing profileId" });
        profilesStore.remove(id);
        res.json({ ok: true, deleted: id });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        res.status(500).json({ error: msg });
    }
});

app.get("/discovery/accounts-with-locations", async function(_req, res) {
    try {
        const accResp = await callBusinessProfileAPI(
            "GET",
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts"
        );
        let accounts = [];
        if (accResp && accResp.data && accResp.data.accounts)
            accounts = accResp.data.accounts;

        const out = [];
        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            let accountId = "";
            if (acc && acc.name) {
                const parts = acc.name.split("/");
                if (parts.length === 2 && parts[0] === "accounts") accountId = parts[1];
            }
            if (accountId !== "") {
                const url =
                    "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/" +
                    accountId +
                    "/locations" +
                    "?readMask=name,title,languageCode,websiteUri,phoneNumbers,metadata&pageSize=100";
                const locResp = await callBusinessProfileAPI("GET", url);
                const locations =
                    locResp && locResp.data && locResp.data.locations ?
                    locResp.data.locations : [];

                out.push({
                    accountId: accountId,
                    accountName: acc && acc.accountName ? acc.accountName : "",
                    type: acc && acc.type ? acc.type : "",
                    locations: locations,
                });
            }
        }
        res.json({ accounts: out });
    } catch (e) {
        const msg =
            e && e.response && e.response.data ?
            e.response.data :
            e && e.message ?
            e.message :
            String(e);
        res.status(500).json({ error: msg });
    }
});

// ==================== AI POST GENERATION ====================
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

// ==================== GOOGLE BUSINESS POSTING ====================
app.post("/post-to-gmb", async function(req, res) {
    try {
        const body = req.body || {};
        const profileId = body.profileId;
        let postText = body.postText || "";
        const cta = body.cta || "";
        const linkUrl = body.linkUrl || "";

        if (!profileId) return res.status(400).json({ error: "Missing profileId" });

        const profile = PROFILES.find(function(p) {
            return p && p.profileId === profileId;
        });
        if (!profile) return res.status(404).json({ error: "Profile not found" });

        // ----- pick photo candidates (but attach only if allowed) -----
        let chosenPhoto = tryPickPhotoFromProfile(profile);
        if (!chosenPhoto) chosenPhoto = tryPickPhotoFromUploads();

        // ----- text + hashtags (on-demand) -----
        let generatedHashtags = [];
        if (!postText) {
            const nbh = pickNeighbourhood(profile, new Date());
            const gen = await aiGenerateSummaryAndHashtags(profile, nbh, openai);
            postText = gen && gen.summary ? gen.summary : "";
            generatedHashtags =
                gen && Array.isArray(gen.hashtags) ? gen.hashtags : [];
        }

        // ----- append links + hashtags and enforce limit -----
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
                if (tagLine && summary.length + 2 + tagLine.length <= 1450) {
                    summary += "\n\n" + tagLine;
                }
            }
        }
        if (summary.length > 1500) summary = summary.slice(0, 1500);

        // ----- build payload -----
        const parent =
            "accounts/" + profile.accountId + "/locations/" + profile.locationId;
        const url =
            "https://mybusiness.googleapis.com/v4/" + parent + "/localPosts";

        const payload = {
            languageCode: "en",
            topicType: "STANDARD",
            summary: summary,
        };
        if (cta && linkUrl)
            payload.callToAction = { actionType: cta, url: linkUrl };

        if (chosenPhoto && chosenPhoto.url) {
            const absFromReq =
                req.protocol + "://" + req.get("host") + chosenPhoto.url;
            if (shouldAttachMedia(absFromReq)) {
                payload.media = [{ mediaFormat: "PHOTO", sourceUrl: absFromReq }];
            }
        }

        const result = await callBusinessProfileAPI("POST", url, payload);
        res.json({
            success: true,
            data: result.data,
            usedPhoto: payload.media ? chosenPhoto : null,
            mediaAttached: Boolean(payload.media),
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

// ==================== ROOT ====================
app.get("/", function(_req, res) {
    res.send(
        "✅ GMB Automation Backend is running. Use /auth to start authentication."
    );
});

// ===== Scheduler hookup (after all routes & helpers are defined) =====
const postsStore = require("./server/posts-store.cjs");
const { makeScheduler } = require("./server/scheduler.cjs");

// expose a thin wrapper so scheduler can call the same logic as /post-to-gmb
async function postToGmb(body) {
    const profileId = body.profileId;
    let postText = body.postText || "";
    const cta = body.cta || "";
    const linkUrl = body.linkUrl || "";

    const profile = PROFILES.find(function(p) {
        return p && p.profileId === profileId;
    });
    if (!profile) throw new Error("Profile not found");

    let chosenPhoto = tryPickPhotoFromProfile(profile);
    if (!chosenPhoto) chosenPhoto = tryPickPhotoFromUploads();

    let generatedHashtags = [];
    if (postText === "") {
        const nbh = pickNeighbourhood(profile, new Date());
        const gen = await aiGenerateSummaryAndHashtags(profile, nbh, openai);
        postText = gen && gen.summary ? gen.summary : "";
        generatedHashtags = gen && Array.isArray(gen.hashtags) ? gen.hashtags : [];
    }

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
            if (tagLine && summary.length + 2 + tagLine.length <= 1450) {
                summary += "\n\n" + tagLine;
            }
        }
    }
    if (summary.length > 1500) summary = summary.slice(0, 1500);

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
        // This uses localhost (non-https) so shouldAttachMedia will reject attaching,
        // which is correct unless you provide a public https image.
        const absUrl = "http://localhost:" + port + chosenPhoto.url;
        if (shouldAttachMedia(absUrl)) {
            payload.media = [{ mediaFormat: "PHOTO", sourceUrl: absUrl }];
        }
    }

    const result = await callBusinessProfileAPI("POST", url, payload);

    postsStore.append({
        profileId: profileId,
        accountId: profile.accountId,
        locationId: profile.locationId,
        summary: summary,
        usedImage: payload.media ? (chosenPhoto ? chosenPhoto.url : null) : null,
        gmbPostId: result && result.data && result.data.name ? result.data.name : null,
        status: "POSTED",
    });

    return {
        data: result.data,
        usedImage: payload.media ? (chosenPhoto ? chosenPhoto.url : null) : null,
    };
}

makeScheduler({
    app: app,
    postToGmb: postToGmb,
    pickNeighbourhood: pickNeighbourhood,
    profilesRef: function() {
        return PROFILES;
    },
});

// ==================== HEALTH ENDPOINT ====================
app.get("/health", function(_req, res) {
    res.json({ ok: true, status: "up" });
});

// ==================== SERVER LIFECYCLE & SMART PORT BIND ====================
const net = require("net");

function findAvailablePort(startPort, cb) {
    function tryPort(p) {
        const tester = net
            .createServer()
            .once("error", function(err) {
                if (err && err.code === "EADDRINUSE") {
                    tryPort(p + 1);
                } else {
                    cb(err, null);
                }
            })
            .once("listening", function() {
                tester.close(function() {
                    cb(null, p);
                });
            })
            .listen(p);
        tester.unref();
    }
    tryPort(startPort);
}

var preferredPort = 4000;
if (process && process.env && process.env.PORT) {
    var parsed = parseInt(process.env.PORT, 10);
    if (!isNaN(parsed) && parsed > 0) preferredPort = parsed;
}

findAvailablePort(preferredPort, function(err, chosenPort) {
    if (err) {
        console.error("💥 Could not find free port:", err);
        process.exit(1);
        return;
    }

    const server = app.listen(chosenPort, function() {
        console.log(
            "🚀 Backend running at http://localhost:" +
            chosenPort +
            " (requested " +
            preferredPort +
            ")"
        );
    });

    server.on("close", function() {
        console.log("🔌 HTTP server closed");
    });
    server.on("error", function(err) {
        console.error(
            "💥 HTTP server error:",
            err && err.message ? err.message : String(err)
        );
    });

    // Optional keepalive if your environment closes stdio
    if (String(process.env.FORCE_KEEPALIVE || "").toLowerCase() === "true") {
        try {
            process.stdin.resume();
            console.log("⏳ FORCE_KEEPALIVE active (stdin held open)");
        } catch (_) {}
    }

    function shutdown(sig) {
        console.log("🛑 " + sig + " received, closing server…");
        server.close(function() {
            console.log("✅ Server closed, exiting.");
            process.exit(0);
        });
        setTimeout(function() {
            console.log("⏱️ Force exit after timeout.");
            process.exit(0);
        }, 3000).unref();
    }
    process.on("SIGINT", function() {
        shutdown("SIGINT");
    });
    process.on("SIGTERM", function() {
        shutdown("SIGTERM");
    });
    process.on("exit", function(code) {
        console.log("👋 Process exit with code:", code);
    });
    process.on("uncaughtException", function(err) {
        console.error(
            "⚠️ Uncaught Exception:",
            err && err.stack ? err.stack : String(err)
        );
    });
    process.on("unhandledRejection", function(reason) {
        console.error("⚠️ Unhandled Rejection:", String(reason));
    });
});