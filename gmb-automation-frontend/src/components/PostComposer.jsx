// src/components/PostComposer.jsx
import React, { useEffect, useMemo, useState } from "react";
import { CTA_OPTIONS } from "../lib/cta";
import { generatePreview, postNow } from "../api";
import DefaultsDialog from "./DefaultsDialog";

export default function PostComposer({ profiles }) {
  const [profileId, setProfileId] = useState("");
  const [preview, setPreview] = useState("");
  const [cta, setCta] = useState("CALL_NOW");
  const [linkUrl, setLinkUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [openDefaults, setOpenDefaults] = useState(false);

  const selected = useMemo(
    () => (profiles || []).find((p) => p.profileId === profileId) || null,
    [profiles, profileId]
  );

  useEffect(() => {
    if (!selected) return;
    const d = selected.defaults || {};
    setCta(d.cta || "CALL_NOW");
    setLinkUrl(d.linkUrl || selected.landingUrl || "");
    setMediaUrl(d.mediaUrl || "");
  }, [selected]);

  async function doPreview() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await generatePreview(selected.profileId);
      setPreview(r.post || "");
      setToast("Preview generated");
    } catch (e) {
      setToast("Preview failed: " + String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function doPost() {
    if (!selected) return;

    // basic form validation:
    if (cta !== "CALL_NOW") {
      if (!/^https?:\/\//i.test(linkUrl || "")) {
        setToast("Please provide a valid https:// link for this CTA");
        return;
      }
    } else {
      // CALL_NOW: allow blank link; backend will use Google phone (or profile/def)
      if (
        linkUrl &&
        !/^tel:/i.test(linkUrl) &&
        !/^https?:\/\//i.test(linkUrl)
      ) {
        setToast("For Call now you can leave link empty OR provide tel:+...");
        return;
      }
    }
    if (mediaUrl && !/^https:\/\/.+\.(png|jpe?g|webp)$/i.test(mediaUrl)) {
      setToast("Media must be a public HTTPS image (.png/.jpg/.jpeg/.webp)");
      return;
    }

    setBusy(true);
    try {
      const r = await postNow({
        profileId: selected.profileId,
        postText: preview,
        cta,
        linkUrl,
        mediaUrl,
      });
      setToast("Posted ✅");
    } catch (e) {
      setToast("Post failed: " + String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px 1fr 320px",
        gap: 16,
      }}
    >
      {/* Left: profile & actions */}
      <div>
        <label>Profiles</label>
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          style={{ display: "block", width: "100%", marginTop: 6, padding: 8 }}
        >
          <option value="">Select a profile</option>
          {(profiles || []).map((p) => (
            <option key={p.profileId} value={p.profileId}>
              {p.businessName}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={doPreview} disabled={!profileId || busy}>
            Generate Preview
          </button>
          <button
            onClick={doPost}
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

        <div style={{ marginTop: 10 }}>
          <button onClick={() => setOpenDefaults(true)} disabled={!selected}>
            Update profile defaults…
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
          onChange={(e) => setPreview(e.target.value)}
          placeholder="Click Generate Preview, then edit here"
          style={{
            width: "100%",
            height: 280,
            padding: 10,
            resize: "vertical",
          }}
        />
      </div>

      {/* Right: CTA + link + media */}
      <div>
        <label>Action button</label>
        <select
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          style={{ width: "100%", padding: 8, display: "block", marginTop: 6 }}
        >
          {CTA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label style={{ display: "block", marginTop: 12 }}>
          Link (required unless “Call now”)
        </label>
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://your-site/page  — or tel:+1..."
          style={{ width: "100%", padding: 8 }}
        />
        <small style={{ color: "#666" }}>
          For CALL_NOW you may leave this blank; backend uses the Google phone.
        </small>

        <label style={{ display: "block", marginTop: 12 }}>
          Photo URL (https image)
        </label>
        <input
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          placeholder="https://.../image.jpg"
          style={{ width: "100%", padding: 8 }}
        />
        <small style={{ color: "#666" }}>
          If empty, backend may pick from profile pool/uploads.
        </small>
      </div>

      {selected ? (
        <DefaultsDialog
          open={openDefaults}
          onClose={() => setOpenDefaults(false)}
          profile={selected}
        />
      ) : null}
    </div>
  );
}
