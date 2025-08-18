// server/captions.cjs



function buildCaption(profile, customCaption) {
    if (typeof customCaption === "string" && customCaption.length > 0) {
        return customCaption;
    }

    var base = "Popcorn ceiling removal";
    if (
        profile &&
        typeof profile.captionBase === "string" &&
        profile.captionBase.length > 0
    ) {
        base = profile.captionBase;
    }

    var city = "";
    if (profile && typeof profile.city === "string") city = profile.city;

    if (city && city.length > 0) return base + " in " + city;
    return base;
}

module.exports = { buildCaption };