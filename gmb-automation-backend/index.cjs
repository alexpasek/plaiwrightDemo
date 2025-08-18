require("dotenv").config();
const express = require("express");
const app = express();
const port = 4000;
const fs = require("fs");
const path = require("path");
const axios = require("axios"); // optional now, kept in case you need it
const OpenAI = require("openai");
const uploadRoutes = require("./server/upload.cjs");
app.use(uploadRoutes);

app.use(uploadRoutes);

app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));




// ✅ One import only (no duplicates)
const { oauth2Client, callBusinessProfileAPI } = require("./google-client.cjs");

app.use(express.json({ limit: "1mb" }));
//import the store 
const profilesStore = require("./server/profile-store.cjs");

// -------- Profiles CRUD (list/create/update/delete) --------

// List all saved profiles (what your scheduler uses)
app.get("/profiles", function(req, res) {
    try {
        const list = profilesStore.readAll();
        res.json({ profiles: list });
    } catch (e) {
        let msg;
        if (e && e.message) msg = e.message;
        else msg = String(e);
        res.status(500).json({ error: msg });
    }
});

// Create or update a profile
app.post("/profiles", function(req, res) {
    try {
        const p = req.body;
        // minimal validation
        if (!p || !p.profileId || !p.accountId || !p.locationId || !p.businessName) {
            return res.status(400).json({ error: "Missing fields: profileId, accountId, locationId, businessName are required" });
        }
        profilesStore.upsert(p);
        res.json({ ok: true, profile: p });
    } catch (e) {
        let msg;
        if (e && e.message) msg = e.message;
        else msg = String(e);
        res.status(500).json({ error: msg });
    }
});

// Delete a profile
app.delete("/profiles/:profileId", function(req, res) {
    try {
        const id = req.params.profileId;
        if (!id) return res.status(400).json({ error: "Missing profileId" });
        profilesStore.remove(id);
        res.json({ ok: true, deleted: id });
    } catch (e) {
        let msg;
        if (e && e.message) msg = e.message;
        else msg = String(e);
        res.status(500).json({ error: msg });
    }
});

// Accounts + locations in one response (for UI pickers)
app.get("/discovery/accounts-with-locations", async function(_req, res) {
    try {
        const accResp = await callBusinessProfileAPI(
            "GET",
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts"
        );
        let accounts = [];
        if (accResp && accResp.data && accResp.data.accounts) accounts = accResp.data.accounts;

        const out = [];
        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            let accountNameField = "";
            let accountId = "";
            if (acc && acc.name) {
                accountNameField = acc.name;
                const parts = acc.name.split("/");
                if (parts.length === 2 && parts[0] === "accounts") accountId = parts[1];
            }
            if (accountId !== "") {
                const url = "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/" + accountId + "/locations?readMask=name,title,languageCode,websiteUri,phoneNumbers,metadata&pageSize=100";
                const locResp = await callBusinessProfileAPI("GET", url);
                let locations = [];
                if (locResp && locResp.data && locResp.data.locations) locations = locResp.data.locations;

                out.push({
                    accountId: accountId,
                    accountName: acc && acc.accountName ? acc.accountName : "",
                    type: acc && acc.type ? acc.type : "",
                    locations: locations
                });
            }
        }
        res.json({ accounts: out });
    } catch (e) {
        let msg;
        if (e && e.response && e.response.data) msg = e.response.data;
        else if (e && e.message) msg = e.message;
        else msg = String(e);
        res.status(500).json({ error: msg });
    }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==================== GBP: ACCOUNTS & LOCATIONS ====================

// List all GBP accounts
app.get("/accounts", async(_req, res) => {
    try {
        const url =
            "https://mybusinessbusinessinformation.googleapis.com/v1/accounts";
        const result = await callBusinessProfileAPI("GET", url);
        const data = result.data;
        res.json(data);
    } catch (e) {
        let errMsg;
        if (e && e.response && e.response.data) {
            errMsg = e.response.data;
        } else if (e && e.message) {
            errMsg = e.message;
        } else {
            errMsg = String(e);
        }
        res.status(500).json({ error: errMsg });
    }
});

// List locations for a given accountId
// List locations for a given accountId (v1) — readMask REQUIRED
app.get("/locations", async(req, res) => {
    try {
        const accountId = req.query.accountId;
        let readMask = req.query.readMask;

        if (!accountId) {
            return res.status(400).json({ error: "Missing accountId" });
        }

        // Default mask: enough to identify the listing and build profiles.json
        if (!readMask || readMask.trim() === "") {
            readMask = "name,title,storeCode,languageCode,websiteUri,phoneNumbers,metadata";
        }

        // You can also pass pageSize or pageToken if you have many locations
        let base = "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/" + accountId + "/locations";
        const url = base + "?readMask=" + encodeURIComponent(readMask) + "&pageSize=100";

        const result = await callBusinessProfileAPI("GET", url);
        const data = result.data; // data has .locations and maybe .nextPageToken
        res.json(data);
    } catch (e) {
        let errMsg;
        if (e && e.response && e.response.data) {
            errMsg = e.response.data;
        } else if (e && e.message) {
            errMsg = e.message;
        } else {
            errMsg = String(e);
        }
        res.status(500).json({ error: errMsg });
    }
});


// ==================== Load profiles once at startup ====================
const PROFILES_PATH = path.join(__dirname, "data", "profiles.json");
let PROFILES = [];
try {
    PROFILES = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
    console.log(`Loaded ${PROFILES.length} profiles`);
} catch (e) {
    console.warn("Could not load profiles.json. Make sure it exists in /data.");
}

// ==================== AI POST GENERATION ====================
app.get("/generate-post-by-profile", async(req, res) => {
    const profileId = req.query.profileId;
    if (!profileId) {
        console.log("❌ Missing profileId");
        return res.status(400).json({ error: "Missing profileId" });
    }

    const profile = PROFILES.find((p) => p.profileId === profileId);
    if (!profile) {
        console.log("❌ Profile not found for:", profileId);
        return res.status(404).json({ error: "Profile not found" });
    }

    function pickNeighbourhood(p, date = new Date()) {
        if (!p.neighbourhoods || p.neighbourhoods.length === 0) {
            return null;
        }
        const dayIndex = date.getDate() - 1;
        const idx = dayIndex % p.neighbourhoods.length;
        return p.neighbourhoods[idx];
    }

    const neighbourhood = pickNeighbourhood(profile) || profile.city;

    const prompt = `
    Write an 80–120 word Google Business Profile post for "${
      profile.businessName
    }" offering popcorn ceiling removal in ${neighbourhood}, ${profile.city}.
    Use natural local SEO phrases like: "${
      profile.city
    } popcorn ceiling removal", "${neighbourhood} ceiling resurfacing", "smooth ceiling finishing".
    Also weave one or two of these service keywords naturally into the text: ${profile.keywords.join(
      ", "
    )}.
    Keep tone friendly and trustworthy. Mention benefits: modern look, brighter rooms, clean process, fast turnaround.
    End with a clear call to action to request a free quote today.
    `;


    try {
        console.log(
            `📝 Generating post for ${profile.businessName} in ${neighbourhood}...`
        );

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
        });

        let postText = "";
        if (
            completion &&
            completion.choices &&
            completion.choices[0] &&
            completion.choices[0].message &&
            completion.choices[0].message.content
        ) {
            postText = completion.choices[0].message.content.trim();
        }
        if (!postText) {
            throw new Error("No text returned from AI");
        }

        console.log(`✅ Post generated for ${profile.businessName}`);

        return res.json({
            profileId: profile.profileId,
            businessName: profile.businessName,
            city: profile.city,
            neighbourhood,
            post: postText,
        });
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.error("❌ AI generation error:", msg);
        return res.status(500).json({ error: "Failed to generate post" });
    }
});

// ==================== GOOGLE AUTH ====================
app.get("/auth", (req, res) => {
    const scopes = ["https://www.googleapis.com/auth/business.manage"];
    const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
    });
    res.redirect(url);
});

app.get("/oauth2callback", async(req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send("Missing code");
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

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
// Uses helper -> auto-refresh; no manual access_token reading
app.post("/post-to-gmb", async(req, res) => {
    const profileId = req.body && req.body.profileId;
    const postText = req.body && req.body.postText;
    const imageUrl = req.body && req.body.imageUrl;
    const cta = req.body && req.body.cta; // optional: e.g., "LEARN_MORE"
    const linkUrl = req.body && req.body.linkUrl; // optional

    if (!profileId || !postText) {
        return res.status(400).json({ error: "Missing profileId or postText" });
    }

    const profile = PROFILES.find((p) => p.profileId === profileId);
    if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
    }

    try {
        const parent = `accounts/${profile.accountId}/locations/${profile.locationId}`;
        const url = `https://mybusiness.googleapis.com/v4/${parent}/localPosts`;

        const body = {
            languageCode: "en",
            topicType: "STANDARD",
            summary: postText.slice(0, 1500),
            callToAction: cta && linkUrl ? { actionType: cta, url: linkUrl } : undefined,
            media: imageUrl ? [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }] : undefined,
        };

        const result = await callBusinessProfileAPI("POST", url, body);
        const data = result.data;

        console.log(`✅ Post published to ${profile.businessName}`);
        res.json({ success: true, data });
    } catch (err) {
        let errorMsg;
        if (err && err.response && err.response.data) {
            errorMsg = err.response.data;
        } else if (err && err.message) {
            errorMsg = err.message;
        } else {
            errorMsg = String(err);
        }
        console.error("❌ Failed to post to Google:", errorMsg);
        res
            .status(500)
            .json({ error: "Failed to post to Google", details: errorMsg });
    }
});

app.get("/", (_req, res) => {
    res.send(
        "✅ GMB Automation Backend is running. Use /auth to start authentication."
    );
});

app.listen(port, () => {
    console.log(`🚀 Backend running at http://localhost:${port}`);
});