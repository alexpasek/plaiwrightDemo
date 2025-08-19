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
    if (arr.length === 0) return p.city || "";
    var d = date || new Date();
    var idx = (d.getDate() - 1) % arr.length;
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
    var where =
        neighbourhood && neighbourhood !== "" ? neighbourhood + ", " + city : city;

    var prompt =
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

    var completion = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
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

function tryPickPhotoFromUploads() {
    var uploadDir = path.join(__dirname, "data", "uploads");
    if (!fs.existsSync(uploadDir)) return null;
    var files = fs.readdirSync(uploadDir).filter(function(f) {
        return !f.startsWith(".") && /\.(jpg|jpeg|png|webp)$/i.test(f);
    });
    if (files.length === 0) return null;
    var randomFile = files[Math.floor(Math.random() * files.length)];
    return { url: "/uploads/" + randomFile, caption: "" };
}

function isHttpsImage(u) {
    try {
        var x = new URL(u);
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
var CTA_MAP = {
    CALL: { actionType: "CALL", needsUrl: true, urlKind: "tel" },
    CALL_NOW: { actionType: "CALL", needsUrl: true, urlKind: "tel" }, // legacy alias
    LEARN_MORE: { actionType: "LEARN_MORE", needsUrl: true, urlKind: "http" },
    BOOK: { actionType: "BOOK", needsUrl: true, urlKind: "http" },
    ORDER: { actionType: "ORDER", needsUrl: true, urlKind: "http" },
    SHOP: { actionType: "SHOP", needsUrl: true, urlKind: "http" },
    SIGN_UP: { actionType: "SIGN_UP", needsUrl: true, urlKind: "http" },
};

// ==================== LIVE LOCATION BASICS ====================
var LOCATION_CACHE = {}; // { locationId: { websiteUri, primaryPhone, ts } }
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
        out = { websiteUri, primaryPhone, ts: Date.now() };
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

    var cta = incomingCta ? incomingCta : d.cta ? d.cta : "CALL";

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

    return { cta, linkUrl, mediaUrl, siteCandidate };
}

function buildCallToAction(profile, ctaCode, linkUrl, basics) {
    var spec = CTA_MAP[ctaCode] || CTA_MAP.CALL; // default to CALL
    var finalUrl = "";

    if (spec.needsUrl) {
        if (spec.urlKind === "tel") {
            var explicitTel =
                typeof linkUrl === "string" && /^tel:/i.test(linkUrl) ? linkUrl : "";
            var googlePhone =
                basics && basics.primaryPhone ? String(basics.primaryPhone) : "";
            var profPhone = profile && profile.phone ? String(profile.phone) : "";
            var chosen = explicitTel ?
                explicitTel :
                googlePhone ?
                "tel:" + googlePhone.replace(/[^+\d]/g, "") :
                "";
            if (!chosen && profPhone)
                chosen = "tel:" + profPhone.replace(/[^+\d]/g, "");
            finalUrl = chosen;
        } else {
            var candidate = typeof linkUrl === "string" && linkUrl ? linkUrl : "";
            if (!candidate || !/^https?:\/\//i.test(candidate)) {
                candidate =
                    basics && basics.websiteUri ? String(basics.websiteUri) : "";
            }
            if (!candidate || !/^https?:\/\//i.test(candidate)) {
                candidate =
                    profile && profile.landingUrl ? String(profile.landingUrl) : "";
            }
            finalUrl = candidate;
        }
    }
    var cta = { actionType: spec.actionType };
    if (finalUrl) cta.url = finalUrl;
    return cta;
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
            e && e.response && e.response.data ?
            e.response.data :
            e && e.message ?
            e.message :
            String(e);
        res.status(500).json({ error: errMsg });
    }
});

// ==================== Load profiles once at startup ====================
var PROFILES_PATH = path.join(__dirname, "data", "profiles.json");
var PROFILES = [];
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
        var msg = e && e.message ? e.message : String(e);
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
        res
            .status(500)
            .json({ ok: false, error: e && e.message ? e.message : String(e) });
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

        var postText = summaryAI + "\n\n";
        if (profile.reviewsUrl)
            postText += "Reviews ➡️ " + profile.reviewsUrl + "\n";
        if (profile.serviceAreaUrl)
            postText += "Service Area ➡️ " + profile.serviceAreaUrl + "\n";

        // Prefer one Google Maps link in preview too (mapsUri, then mapsUrl)
        var mapsUrlOrUri = profile.mapsUri || profile.mapsUrl;
        if (mapsUrlOrUri) postText += "Google Maps ➡️ " + mapsUrlOrUri + "\n";

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
        var msg = err && err.message ? err.message : String(err);
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
        var msg = err && err.message ? err.message : String(err);
        console.error("Error retrieving access token", msg);
        res.status(500).send("Auth failed");
    }
});

// ==================== CORE POST LOGIC ====================
async function postToGmb(body) {
    // Inputs / profile
    var profileId = body && body.profileId ? String(body.profileId) : "";
    var postText = body && typeof body.postText === "string" ? body.postText : "";
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

    // Pick photo
    var chosenPhoto = null;
    if (
        isHttpsImage(mediaUrl) &&
        isPublicHttps(mediaUrl) &&
        !isLocalHost(mediaUrl)
    ) {
        chosenPhoto = { url: mediaUrl, caption: "" };
    } else {
        var candidate =
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
    var generatedHashtags = [];
    if (!postText) {
        var nbh = pickNeighbourhood(profile, new Date());
        var gen = await aiGenerateSummaryAndHashtags(profile, nbh, openai);
        postText = gen && gen.summary ? gen.summary : "";
        generatedHashtags = gen && Array.isArray(gen.hashtags) ? gen.hashtags : [];
    }

    // Links section (deduped)
    var summary = String(postText || "").trim();
    var links = [];
    var seen = {};

    function maybePush(label, url) {
        if (!url) return;
        var key = trimUrlForCompare(url);
        if (seen[key]) return;
        seen[key] = true;
        links.push(label + " ➡️ " + url);
    }
    // Prefer a single Google Maps link (avoid pushing both)
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

    // Build CTA with fallback rules
    var ctaObj = buildCallToAction(profile, ctaCode, providedLinkUrl, basics);
    var finalCta = null;
    if (ctaObj && ctaObj.actionType) {
        if (ctaObj.actionType === "CALL") {
            if (ctaObj.url) {
                finalCta = ctaObj; // valid CALL with tel:
            } else {
                // No phone available: fallback to LEARN_MORE using best site candidate
                var site = siteCandidate;
                if (!/^https?:\/\//i.test(site || "")) {
                    site = basics.websiteUri || profile.landingUrl || "";
                }
                if (site) {
                    finalCta = { actionType: "LEARN_MORE", url: site };
                }
            }
        } else {
            if (ctaObj.url) {
                finalCta = ctaObj;
            }
        }
    }

    if (finalCta && finalCta.url) {
        summary = dedupeUrlInText(summary, finalCta.url);
    }
    if (summary.length > 1500) summary = summary.slice(0, 1500);

    // GBP payload
    var parent =
        "accounts/" + profile.accountId + "/locations/" + profile.locationId;
    var url = "https://mybusiness.googleapis.com/v4/" + parent + "/localPosts";

    var payload = { languageCode: "en", topicType: "STANDARD", summary: summary };
    if (finalCta && finalCta.actionType && finalCta.url) {
        payload.callToAction = finalCta; // valid v4 CTA only
    }

    // Media
    if (
        chosenPhoto &&
        chosenPhoto.url &&
        isPublicHttps(chosenPhoto.url) &&
        !isLocalHost(chosenPhoto.url) &&
        shouldAttachMedia(chosenPhoto.url)
    ) {
        payload.media = [{ mediaFormat: "PHOTO", sourceUrl: chosenPhoto.url }];
    }

    // Helper: dump payload for debugging
    function logPayload(tag, pl) {
        try {
            console.error(
                `[${tag}] Posting payload:\n` + JSON.stringify(pl, null, 2)
            );
        } catch (_) {}
    }

    // Call Google with 1-pass retry without CTA on INVALID_ARGUMENT
    try {
        logPayload("TRY", payload);
        var result = await callBusinessProfileAPI("POST", url, payload);

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

        return {
            data: result.data,
            usedImage: payload.media ? (chosenPhoto ? chosenPhoto.url : null) : null,
            ctaUsed: payload.callToAction || null,
            ctaStripped: false,
        };
    } catch (err) {
        const detail =
            (err && err.response && err.response.data) ||
            (err && err.message) ||
            String(err);
        console.error("❌ Google Post Error (first attempt):", detail);

        // If we used a CTA, try once more without CTA (some accounts/locations reject CALL)
        if (payload.callToAction) {
            const retryPayload = {...payload };
            delete retryPayload.callToAction;
            try {
                logPayload("RETRY_NO_CTA", retryPayload);
                var result2 = await callBusinessProfileAPI("POST", url, retryPayload);

                try {
                    postsStore.append({
                        profileId: profileId,
                        accountId: profile.accountId,
                        locationId: profile.locationId,
                        summary: summary,
                        usedImage: retryPayload.media ?
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

                console.warn(
                    "⚠️ CTA was stripped due to INVALID_ARGUMENT; post created without CTA."
                );
                return {
                    data: result2.data,
                    usedImage: retryPayload.media ?
                        chosenPhoto ?
                        chosenPhoto.url :
                        null :
                        null,
                    ctaUsed: null,
                    ctaStripped: true,
                    firstError: detail,
                };
            } catch (err2) {
                const detail2 =
                    (err2 && err2.response && err2.response.data) ||
                    (err2 && err2.message) ||
                    String(err2);
                console.error("❌ Google Post Error (retry w/o CTA):", detail2);
                throw new Error(
                    typeof detail2 === "string" ? detail2 : JSON.stringify(detail2)
                );
            }
        }

        // No CTA to strip; propagate original error
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
            err && err.response && err.response.data ?
            err.response.data :
            err && err.message ?
            err.message :
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
        var msg = err && err.message ? err.message : String(err);
        res.status(500).json({ error: msg });
    }
});

app.post("/post-now-all", async function(_req, res) {
    try {
        var results = [];
        var count = 0;
        for (var i = 0; i < PROFILES.length; i++) {
            var p = PROFILES[i];
            if (!p || !p.profileId) continue;
            try {
                var r = await postToGmb({ profileId: p.profileId, postText: "" });
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
                    error: e && e.message ? e.message : String(e),
                });
            }
        }
        res.json({ ok: true, count: count, results: results });
    } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        res.status(500).json({ error: msg });
    }
});

// ==================== SCHEDULER API (simple in-memory state) ====================
var DEFAULT_SCHED = {
    enabled: false,
    defaultTime: "10:00",
    tickSeconds: 30,
    perProfileTimes: {},
};
var SCHED_CFG = Object.assign({}, DEFAULT_SCHED);
var LAST_RUN_MAP = {}; // { profileId: ISOString }

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
        res.status(400).json({ error: e && e.message ? e.message : String(e) });
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
                var r = await postToGmb({ profileId: p.profileId, postText: "" });
                LAST_RUN_MAP[p.profileId] = new Date().toISOString();
                results.push({
                    profileId: p.profileId,
                    ok: true,
                    data: r.data,
                    ctaUsed: r.ctaUsed || null,
                    ctaStripped: !!r.ctaStripped,
                    firstError: r.firstError || null,
                });
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
        var id = req.params.profileId;
        if (!id) return res.status(400).json({ error: "Missing profileId" });
        var r = await postToGmb({ profileId: id, postText: "" });
        LAST_RUN_MAP[id] = new Date().toISOString();
        res.json({
            ok: true,
            data: r.data,
            ctaUsed: r.ctaUsed || null,
            ctaStripped: !!r.ctaStripped,
            firstError: r.firstError || null,
        });
    } catch (err) {
        res
            .status(500)
            .json({ error: err && err.message ? err.message : String(err) });
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

// ==================== SERVER LIFECYCLE ====================
var server = null;
var serverPort = Number(process.env.PORT || 4000);

function tryListen(startPort, maxAttempts, cb) {
    var attempt = 0;

    function start() {
        var p = startPort + attempt;
        var s = app.listen(p, function() {
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

tryListen(serverPort, 10, function(err) {
    if (err) {
        console.error(
            "💥 HTTP server error:",
            err && err.message ? err.message : String(err)
        );
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
    console.error(
        "⚠️ Uncaught Exception:",
        err && err.stack ? err.stack : String(err)
    );
});
process.on("unhandledRejection", function(reason) {
    console.error("⚠️ Unhandled Rejection:", String(reason));
});