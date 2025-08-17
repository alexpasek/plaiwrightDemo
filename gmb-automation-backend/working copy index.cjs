/*


const express = require("express");
const app = express();
const port = 4000;
const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();
const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Load profiles once at startup
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

    function pickNeighbourhood(profile, date = new Date()) {
        if (!profile.neighbourhoods || profile.neighbourhoods.length === 0)
            return null;
        const dayIndex = date.getDate() - 1;
        const idx = dayIndex % profile.neighbourhoods.length;
        return profile.neighbourhoods[idx];
    }

    const neighbourhood = pickNeighbourhood(profile) || profile.city;

    const prompt = `
Write a Google Business Profile post (80–100 words) for "${profile.businessName}" offering popcorn ceiling removal in ${neighbourhood}, ${profile.city}.
Use natural local SEO phrases like: "${profile.city} popcorn ceiling removal", "${neighbourhood} ceiling resurfacing", "smooth ceiling finishing".
Keep it friendly and trustworthy. Mention benefits: modern look, brighter rooms, clean process, fast turnaround.
Avoid medical/health claims. End with a clear call to action to request a free quote today.
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
        if (!postText) throw new Error("No text returned from AI");

        console.log(`✅ Post generated for ${profile.businessName}`);

        return res.json({
            profileId: profile.profileId,
            businessName: profile.businessName,
            city: profile.city,
            neighbourhood,
            post: postText,
        });
    } catch (err) {
        console.error("❌ AI generation error:", err);
        return res.status(500).json({ error: "Failed to generate post" });
    }
});

// ==================== GOOGLE AUTH ====================
const { oauth2Client } = require("./google-client.cjs");

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
    if (!code) return res.status(400).send("Missing code");

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const TOKENS_PATH = path.join(__dirname, "data", "tokens.json");
        fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));

        res.send("✅ Tokens saved successfully! You can now use the API.");
    } catch (err) {
        console.error("Error retrieving access token", err);
        res.status(500).send("Auth failed");
    }
});

// ==================== GOOGLE BUSINESS POSTING ====================
app.post("/post-to-gmb", express.json(), async(req, res) => {
    const { profileId, postText } = req.body;

    if (!profileId || !postText) {
        return res.status(400).json({ error: "Missing profileId or postText" });
    }

    const TOKENS_PATH = path.join(__dirname, "data", "tokens.json");
    if (!fs.existsSync(TOKENS_PATH)) {
        return res
            .status(400)
            .json({ error: "No tokens found. Please authenticate first." });
    }

    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
    const accessToken = tokens.access_token;

    const profile = PROFILES.find((p) => p.profileId === profileId);
    if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
    }

    try {
        const url = `https://mybusiness.googleapis.com/v4/accounts/${profile.accountId}/locations/${profile.locationId}/localPosts`;

        const response = await axios.post(
            url, {
                summary: postText,
                languageCode: "en",
                topicType: "STANDARD",
            }, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log(`✅ Post published to ${profile.businessName}`);
        return res.json({ success: true, data: response.data });
    } catch (err) {
        console.error(
            "❌ Failed to post to Google:",
            (err.response && err.response.data) || err.message
        );
        return res.status(500).json({ error: "Failed to post to Google" });
    }
}); // <-- closing brace for the route


res.status(500).json({ error: "Failed to post to Google" });


app.listen(port, () => {
    console.log(`🚀 Backend running at http://localhost:${port}`);
});   

*/