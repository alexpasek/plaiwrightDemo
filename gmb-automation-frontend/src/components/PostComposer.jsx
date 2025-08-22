// src/components/PostComposer.jsx
import React, { useEffect, useMemo, useState } from "react";
import { CTA_OPTIONS } from "../lib/cta";
import {
  generatePost as generatePreview,
  postNow,
  getApiBase,
  uploadPhoto,
} from "../lib/api";
import DefaultsDialog from "./DefaultsDialog";

export default function PostComposer({ profiles }) {
  const [profileId, setProfileId] = useState("");
  const [preview, setPreview] = useState("");
  const [cta, setCta] = useState("CALL_NOW");
  const [linkUrl, setLinkUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [openDefaults, setOpenDefaults] = useState(false);
  const [backendBase, setBackendBase] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imgPreviewSrc, setImgPreviewSrc] = useState("");

  const selected = useMemo(
    function () {
      var arr = profiles || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].profileId === profileId) return arr[i];
      }
      return null;
    },
    [profiles, profileId]
  );

  useEffect(function () {
    (async function () {
      try {
        const b = await getApiBase();
        setBackendBase(b);
      } catch (_) {
        setBackendBase("http://localhost:4000");
      }
    })();
  }, []);

  useEffect(
    function () {
      if (!selected) return;
      const d = selected.defaults || {};
      setCta(d.cta || "CALL_NOW");
      setLinkUrl(d.linkUrl || selected.landingUrl || "");
      setMediaUrl(d.mediaUrl || "");
      setMediaCaption("");
    },
    [selected]
  );

  // ---------- helpers ----------
  function isHttpsImage(u) {
    return /^https:\/\/.+\.(png|jpe?g|webp)$/i.test(String(u || ""));
  }
  function isRelativeUpload(u) {
    return /^\/uploads\/.+\.(png|jpe?g|webp)$/i.test(String(u || ""));
  }
  function buildPreviewSrc(u) {
    if (!u) return "";
    if (isHttpsImage(u)) return u;
    if (isRelativeUpload(u)) {
      const base = backendBase || "";
      return base.replace(/\/+$/, "") + u;
    }
    return "";
  }
  function setPreviewFor(u) {
    setImgPreviewSrc(buildPreviewSrc(u));
  }
  async function validateImageSize(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve((img.width || 0) >= 250 && (img.height || 0) >= 250);
      };
      img.onerror = function () {
        resolve(true);
      }; // if we can't load, let backend try
      img.src = url;
    });
  }

  async function doPreview() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await generatePreview(selected.profileId);
      setPreview(r && r.post ? r.post : "");
      setToast("Preview generated");
    } catch (e) {
      setToast("Preview failed: " + String(e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function doPostWithCurrentMedia() {
    if (!selected) return;

    // CTA validation
    if (cta !== "CALL_NOW") {
      if (!/^https?:\/\//i.test(String(linkUrl || ""))) {
        setToast("Please provide a valid https:// link for this CTA");
        return;
      }
    } else {
      if (
        linkUrl &&
        !/^tel:/i.test(linkUrl) &&
        !/^https?:\/\//i.test(linkUrl)
      ) {
        setToast("For Call now leave link empty or use tel:+...");
        return;
      }
    }

    // Media validation: allow https or /uploads, else empty = backend random
    if (mediaUrl) {
      const psrc = buildPreviewSrc(mediaUrl);
      if (!psrc) {
        setToast(
          "Media must be https image OR /uploads/xxx.(jpg|jpeg|png|webp)"
        );
        return;
      }
      const ok = await validateImageSize(psrc);
      if (!ok) {
        setToast("Image must be at least 250×250 px.");
        return;
      }
    }

    setBusy(true);
    try {
      const payload = {
        profileId: selected.profileId,
        postText: preview,
        cta,
        linkUrl,
        mediaUrl, // if empty, backend will pick random
        mediaCaption,
      };
      await postNow(payload);
      setToast("Posted ✅");
    } catch (e) {
      setToast("Post failed: " + String(e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  // Upload + set mediaUrl to returned /uploads/xxx.ext
  async function handleUpload(e) {
    const file = e && e.target && e.target.files ? e.target.files[0] : null;
    if (!file) return;
    if (!backendBase) {
      setToast("Backend base not resolved yet. Try again.");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadPhoto(file, backendBase);
      if (res && res.url) {
        setMediaUrl(String(res.url)); // relative path like /uploads/IMG_9849.JPG
        setPreviewFor(String(res.url)); // show immediate preview
        setToast("Photo uploaded.");
      } else {
        setToast("Upload did not return a URL");
      }
    } catch (err) {
      setToast(
        "Upload failed: " + String(err && err.message ? err.message : err)
      );
    } finally {
      setUploading(false);
      if (e && e.target) e.target.value = "";
    }
  }

  // Posts with NO mediaUrl so the backend picks a random image from /data/uploads
  async function doPostWithRandom() {
    if (!selected) return;
    setBusy(true);
    try {
      await postNow({
        profileId: selected.profileId,
        postText: preview,
        cta,
        linkUrl,
        mediaUrl: "", // important: let backend pick random
        mediaCaption: "",
      });
      setToast("Posted with random photo ✅");
    } catch (e) {
      setToast("Post failed: " + String(e && e.message ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  // Keep preview image in sync when user types/pastes a URL
  useEffect(
    function () {
      setPreviewFor(mediaUrl);
    },
    [mediaUrl, backendBase]
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px 1fr 340px",
        gap: 16,
      }}
    >
      {/* Left: profile & actions */}
      <div>
        <label>Profiles</label>
        <select
          value={profileId}
          onChange={function (e) {
            setProfileId(e.target.value);
          }}
          style={{ display: "block", width: "100%", marginTop: 6, padding: 8 }}
        >
          <option value="">Select a profile</option>
          {(profiles || []).map(function (p) {
            return (
              <option key={p.profileId} value={p.profileId}>
                {p.businessName}
              </option>
            );
          })}
        </select>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={doPreview} disabled={!profileId || busy}>
            Generate Preview
          </button>
          <button
            onClick={doPostWithCurrentMedia}
            disabled={!profileId || busy}
            style={{
              background: "#0b5",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
            }}
          >
            {busy ? "Posting..." : "Post Now"}
          </button>
        </div>

        {/* Post all stays untouched (your existing control) */}
        <div style={{ marginTop: 12 }}>
          <button disabled style={{ width: "100%", opacity: 0.6 }}>
            Post Now — All Profiles
          </button>
        </div>

        {/* NEW: Random photo button */}
        <div style={{ marginTop: 8 }}>
          <button
            onClick={doPostWithRandom}
            disabled={!profileId || busy}
            style={{ width: "100%" }}
          >
            Post with Random Photo
          </button>
        </div>

        {toast ? (
          <div style={{ marginTop: 10, color: "#333" }}>{toast}</div>
        ) : null}
      </div>

      {/* Center: editor */}
      <div>
        <label>Preview / Edit</label>
        <textarea
          value={preview}
          onChange={function (e) {
            setPreview(e.target.value);
          }}
          placeholder="Click Generate Preview, then edit here"
          style={{
            width: "100%",
            height: 280,
            padding: 10,
            resize: "vertical",
          }}
        />
        <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>
          Generated preview loaded. Edits here will be used when posting.
        </div>
      </div>

      {/* Right: CTA + link + media */}
      <div>
        <label>Action button</label>
        <select
          value={cta}
          onChange={function (e) {
            setCta(e.target.value);
          }}
          style={{ width: "100%", padding: 8, display: "block", marginTop: 6 }}
        >
          {CTA_OPTIONS.map(function (o) {
            return (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            );
          })}
        </select>

        <label style={{ display: "block", marginTop: 12 }}>
          Link (required unless “Call now”)
        </label>
        <input
          value={linkUrl}
          onChange={function (e) {
            setLinkUrl(e.target.value);
          }}
          placeholder="https://your-site/page — or tel:+1..."
          style={{ width: "100%", padding: 8 }}
        />
        <small style={{ color: "#666" }}>
          For CALL_NOW you may leave this blank; backend uses the Google phone.
        </small>

        <label style={{ display: "block", marginTop: 12 }}>Photo URL</label>
        <input
          value={mediaUrl}
          onChange={function (e) {
            setMediaUrl(e.target.value);
          }}
          placeholder="https://.../image.jpg  OR  /uploads/image.jpg  (leave blank for random)"
          style={{ width: "100%", padding: 8 }}
        />
        <small style={{ color: "#666" }}>
          Leave empty to let backend pick a random /uploads photo.
        </small>

        {/* Upload control */}
        <div style={{ marginTop: 8 }}>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleUpload}
            disabled={!profileId || uploading}
          />
          {uploading ? <div style={{ fontSize: 12 }}>Uploading…</div> : null}
        </div>

        <label style={{ display: "block", marginTop: 12 }}>
          Photo caption (optional)
        </label>
        <input
          value={mediaCaption}
          onChange={function (e) {
            setMediaCaption(e.target.value);
          }}
          placeholder="e.g., Before & after — Milton project"
          style={{ width: "100%", padding: 8 }}
        />

        {/* Live preview */}
        {imgPreviewSrc ? (
          <div style={{ marginTop: 12 }}>
            <img
              src={imgPreviewSrc}
              alt=""
              style={{ maxWidth: "100%", borderRadius: 6 }}
            />
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              Preview: {imgPreviewSrc}
            </div>
          </div>
        ) : null}
      </div>

      {selected ? (
        <DefaultsDialog
          open={openDefaults}
          onClose={function () {
            setOpenDefaults(false);
          }}
          profile={selected}
        />
      ) : null}
    </div>
  );
}
