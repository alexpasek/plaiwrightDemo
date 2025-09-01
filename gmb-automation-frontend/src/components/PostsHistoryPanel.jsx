import React, { useEffect, useMemo, useState, useRef } from "react";

function classNames() {
  var out = "";
  for (var i = 0; i < arguments.length; i++) {
    var s = arguments[i];
    if (s && typeof s === "string") out += (out ? " " : "") + s;
  }
  return out;
}

// Basic time formatter → "2025-08-27 10:42"
function fmt(ts) {
  try {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts || "");
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var da = String(d.getDate()).padStart(2, "0");
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    return y + "-" + m + " " + da + " " + hh + ":" + mm;
  } catch (_) {
    return String(ts || "");
  }
}

// Normalize a history row from various backends into a single shape the UI can render.
function normalizeRow(row, idx) {
  row = row || {};
  const createdAt =
    row.createdAt ||
    row.time ||
    row.timestamp ||
    (row.meta && row.meta.time) ||
    null;

  const locationId =
    row.locationId ||
    (row.profile && row.profile.locationId) ||
    row.location_id ||
    "";

  const profileId =
    row.profileId ||
    (row.profile && row.profile.profileId) ||
    row.profile_id ||
    "";

  const businessName =
    row.profileName ||
    row.businessName ||
    (row.profile && (row.profile.businessName || row.profile.title)) ||
    row.title ||
    "";

  // Try typical places summary might be
  const summary =
    row.summary ||
    (row.payload && (row.payload.summary || row.payload.text)) ||
    row.text ||
    "";

  // Media count (prefer explicit, else infer from arrays/flags)
  const mediaCount =
    (row.mediaCount != null && Number(row.mediaCount)) ||
    (Array.isArray(row.media) ? row.media.length : 0) ||
    (Array.isArray(row.mediaAttachments) ? row.mediaAttachments.length : 0) ||
    (row.usedImage ? 1 : 0);

  // CTA (prefer explicit fields)
  const cta =
    row.cta ||
    (row.callToAction && row.callToAction.actionType) ||
    (row.payload &&
      row.payload.callToAction &&
      row.payload.callToAction.actionType) ||
    "";

  // Status detection
  const gmbPostId =
    row.gmbPostId ||
    (row.data && row.data.name) ||
    (row.result && row.result.name) ||
    "";
  const statusRaw = row.status || row.state || (gmbPostId ? "POSTED" : "");
  const status = /posted|success/i.test(String(statusRaw))
    ? "POSTED"
    : gmbPostId
    ? "POSTED"
    : "PENDING";

  // Stable row id
  const rid = String(createdAt || gmbPostId || row.id || idx);

  return {
    _raw: row,
    id: rid,
    createdAt,
    locationId,
    profileId,
    businessName,
    summary,
    mediaCount,
    cta,
    status,
    gmbPostId,
  };
}

export default function PostsHistoryPanel() {
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({}); // id -> bool
  const [err, setErr] = useState("");

  // try /api/posts/history first, fallback to /posts/history
  const historyPaths = useRef([
    "/api/posts/history?limit=100",
    "/posts/history?limit=100",
  ]);

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " -> " + r.status);
    return r.json();
  }

  async function fetchHistory() {
    let histJson = null,
      lastErr = null;
    for (const path of historyPaths.current) {
      try {
        histJson = await fetchJson(path);
        // lock onto the working path
        historyPaths.current = [path];
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!histJson) throw lastErr || new Error("No history endpoint responded");

    // Support {items:[]} or the array itself
    const rawItems = Array.isArray(histJson) ? histJson : histJson.items || [];
    const normalized = rawItems.map(normalizeRow);
    // newest first by createdAt if present
    normalized.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    return normalized;
  }

  function refresh() {
    setLoading(true);
    setErr("");
    Promise.all([
      fetchHistory(),
      fetch("/api/profiles")
        .then((r) =>
          r.ok ? r.json() : fetch("/profiles").then((r2) => r2.json())
        )
        .catch(() => ({})),
    ])
      .then(function ([hist, profs]) {
        setRows(hist || []);
        const list = (profs && (profs.profiles || profs.items || [])) || [];
        setProfiles(Array.isArray(list) ? list : []);
      })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(function () {
        setLoading(false);
      });
  }

  useEffect(function () {
    refresh();
  }, []);

  // Build a lookup: locationId -> businessName
  const locationNameById = useMemo(
    function () {
      var map = {};
      for (var i = 0; i < profiles.length; i++) {
        var p = profiles[i] || {};
        var lid = String(p.locationId || p.location_id || "");
        if (lid) map[lid] = String(p.businessName || p.title || "");
      }
      return map;
    },
    [profiles]
  );

  function statusPill(row) {
    var hasId = !!row.gmbPostId;
    var isPosted = String(row.status || "") === "POSTED";
    var ok = hasId || isPosted;
    var base =
      "inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium";
    return (
      <span
        className={
          base +
          " " +
          (ok ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700")
        }
        title={row.gmbPostId || ""}
      >
        {ok ? "✅ Posted" : "⚠️ Pending"}
      </span>
    );
  }

  function short(text, n) {
    var s = String(text || "");
    if (s.length <= n) return s;
    return s.slice(0, n) + "…";
  }

  function rowProfileName(row) {
    if (row.businessName) return row.businessName;
    var locId = String(row.locationId || "");
    if (locId && locationNameById[locId]) return locationNameById[locId];
    var pid = String(row.profileId || "");
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i] || {};
      if (String(p.profileId || "") === pid)
        return String(p.businessName || p.title || pid);
    }
    return locId || pid || "—";
  }

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Posts History</h3>
        <div className="flex items-center gap-2">
          {err ? <span className="text-xs text-red-600">{err}</span> : null}
          <button
            onClick={refresh}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border shadow-sm overflow-hidden">
        <div className="max-h-[420px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="text-left text-gray-600">
                <th className="px-3 py-2 w-[160px]">Time</th>
                <th className="px-3 py-2">Posted To</th>
                <th className="px-3 py-2">CTA / Media</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2 w-[120px]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-gray-500">
                    No posts yet.
                  </td>
                </tr>
              ) : null}

              {rows.map(function (row) {
                const rid = row.id;
                const isOpen = !!expanded[rid];
                const hasMedia = Number(row.mediaCount || 0) > 0;
                const hasCta = !!row.cta;

                return (
                  <tr key={rid} className="hover:bg-gray-50">
                    <td className="px-3 py-3 align-top whitespace-nowrap">
                      {fmt(row.createdAt)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{rowProfileName(row)}</div>
                      <div className="text-xs text-gray-500">
                        {(row.locationId || "").slice(0, 18) || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-2">
                        {hasCta ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs">
                            CTA
                          </span>
                        ) : null}
                        {hasMedia ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs">
                            Photo×{row.mediaCount}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="text-gray-800">
                        {isOpen
                          ? String(row.summary || "")
                          : short(row.summary, 120)}
                      </div>
                      {String(row.summary || "").length > 120 ? (
                        <button
                          className="mt-1 text-xs text-blue-600 hover:underline"
                          onClick={function () {
                            setExpanded((prev) => ({
                              ...prev,
                              [rid]: !isOpen,
                            }));
                          }}
                        >
                          {isOpen ? "Show less" : "Show more"}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top">{statusPill(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
