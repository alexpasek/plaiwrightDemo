// src/components/DefaultsDialog.jsx
import React, { useState, useEffect } from "react";
import { CTA_OPTIONS } from "../lib/cta";
import { updateDefaults } from "../api";

export default function DefaultsDialog({ open, onClose, profile }) {
  const [cta, setCta] = useState("CALL_NOW");
  const [linkUrl, setLinkUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!profile) return;
    const d = profile.defaults || {};
    setCta(d.cta || "CALL_NOW");
    setLinkUrl(d.linkUrl || profile.landingUrl || "");
    setMediaUrl(d.mediaUrl || "");
    setPhone(profile.phone || "");
    setErr("");
  }, [profile, open]);

  if (!open) return null;

  async function save() {
    try {
      setSaving(true);
      setErr("");
      await updateDefaults(profile.profileId, {
        cta,
        linkUrl,
        mediaUrl,
        phone,
      });
      onClose(true);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "#fff",
          width: 520,
          maxWidth: "95vw",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          Profile defaults: {profile.businessName}
        </h3>

        <label style={{ display: "block", margin: "8px 0 4px" }}>
          Default CTA
        </label>
        <select
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          style={{ width: "100%", padding: 8 }}
        >
          {CTA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label style={{ display: "block", margin: "12px 0 4px" }}>
          Default link (used for non “Call now”)
        </label>
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://your-site/page"
          style={{ width: "100%", padding: 8 }}
        />

        <label style={{ display: "block", margin: "12px 0 4px" }}>
          Default media URL (https image)
        </label>
        <input
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          placeholder="https://.../image.jpg"
          style={{ width: "100%", padding: 8 }}
        />

        <label style={{ display: "block", margin: "12px 0 4px" }}>
          Phone (fallback for CALL_NOW)
        </label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1..."
          style={{ width: "100%", padding: 8 }}
        />

        {err ? (
          <div style={{ color: "#b00020", marginTop: 8 }}>{err}</div>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            justifyContent: "flex-end",
          }}
        >
          <button onClick={() => onClose(false)} disabled={saving}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: "#0b5",
              color: "#fff",
              border: "none",
              padding: "8px 14px",
              borderRadius: 8,
            }}
          >
            {saving ? "Saving..." : "Save defaults"}
          </button>
        </div>
      </div>
    </div>
  );
}
