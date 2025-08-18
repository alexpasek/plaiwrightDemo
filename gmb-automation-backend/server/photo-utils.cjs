function toSourceUrl(input) {
    var s = String(input || "").trim();
    if (s === "") return "";
    if (s.indexOf("http://") === 0 || s.indexOf("https://") === 0) {
        var id = extractDriveFileId(s);
        if (id !== "")
            return "https://drive.google.com/uc?export=download&id=" + id;
        return s;
    }
    return "https://drive.google.com/uc?export=download&id=" + s;
}

function extractDriveFileId(url) {
    var u = String(url);
    var m1 = u.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m1 && m1[1]) return m1[1];
    var m2 = u.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    if (m2 && m2[1]) return m2[1];
    var m3 = u.match(/thumbnail\?id=([a-zA-Z0-9_-]{20,})/);
    if (m3 && m3[1]) return m3[1];
    var m4 = u.match(/[?&]export=download&id=([a-zA-Z0-9_-]{20,})/);
    if (m4 && m4[1]) return m4[1];
    return "";
}

module.exports = { toSourceUrl, extractDriveFileId };