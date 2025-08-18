const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const profilesStore = require("./profile-store.cjs");

const router = express.Router();

// Ensure pool folder exists
const uploadDir = path.join(__dirname, "..", "data", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer storage config
const storage = multer.diskStorage({
    destination: function(_req, _file, cb) {
        cb(null, uploadDir);
    },
    filename: function(_req, file, cb) {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    },
});
const upload = multer({ storage });

/**
 * Upload photo for a profile
 * Field name: "photo"
 */
router.post(
    "/profiles/:profileId/upload-photo",
    upload.single("photo"),
    (req, res) => {
        const id = req.params.profileId;
        if (!id) return res.status(400).json({ error: "Missing profileId" });

        const p = profilesStore.getById(id);
        if (!p) return res.status(404).json({ error: "Profile not found" });

        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        if (!Array.isArray(p.photoPool)) p.photoPool = [];

        const relUrl = "/uploads/" + req.file.filename;

        // 🎯 Caption logic
        let caption;
        if (req.body && req.body.caption) {
            caption = String(req.body.caption);
        } else if (Array.isArray(p.keywords) && p.keywords.length > 0) {
            caption = p.keywords[Math.floor(Math.random() * p.keywords.length)];
        } else {
            caption = "Popcorn ceiling removal";
        }

        p.photoPool.push({ url: relUrl, caption });
        profilesStore.upsert(p);

        res.json({
            ok: true,
            profileId: id,
            photo: { url: relUrl, caption },
        });
    }
);

/**
 * Upload photo to GLOBAL pool (no profile)
 * Field name: "photo"
 */
router.post("/upload", upload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const relUrl = "/uploads/" + req.file.filename;

    res.json({
        ok: true,
        photo: { url: relUrl },
    });
});

/**
 * List all uploaded files (for debugging/preview)
 */
router.get("/uploads/list", (req, res) => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return res.status(500).json({ error: "Failed to read uploads" });

        const urls = files.map((f) => ({
            name: f,
            url: `${req.protocol}://${req.get("host")}/uploads/${f}`,
        }));
        res.json({ files: urls });
    });
});

/**
 * PATCH caption for a specific photo inside profile photoPool
 */
router.patch("/profiles/:id/photos/:index", (req, res) => {
    const { id, index } = req.params;
    const { caption } = req.body;

    const profile = profilesStore.getById(id);
    if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
    }

    if (!profile.photoPool || !profile.photoPool[index]) {
        return res.status(404).json({ error: "Photo not found" });
    }

    profile.photoPool[index].caption =
        caption || profile.photoPool[index].caption;
    profilesStore.upsert(profile);

    res.json({ success: true, photo: profile.photoPool[index] });
});

module.exports = router;