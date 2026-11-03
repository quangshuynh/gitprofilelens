(function initializeShareModule(root, factory) {
  const shareModule = factory();
  if (typeof module === "object" && module.exports) module.exports = shareModule;
  root.GitProfileShare = shareModule;
})(typeof globalThis !== "undefined" ? globalThis : window, function createShareModule() {
  const PRODUCT_URL = "https://gitprofilelens.vercel.app/";
  const CATEGORY_LABELS = {
    presentation: "Repository presentation",
    descriptions: "Descriptions",
    readme: "README quality",
    discoverability: "Discoverability",
    maintenance: "Maintenance",
    focus: "Portfolio focus",
  };

  /**
   * builds a canonical anonymous audit URL
   * @param {string} username analyzed GitHub username
   * @param {string} productUrl canonical product origin
   * @returns {string} encoded share URL
   */
  function buildShareUrl(username, productUrl = PRODUCT_URL) {
    const url = new URL(productUrl);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    url.searchParams.set("user", String(username).trim());
    return url.toString();
  }

  /**
   * builds a curiosity-led message from the actual audit result
   * @param {string} username analyzed GitHub username
   * @param {number} score calculated profile score
   * @param {string} productUrl canonical product origin
   * @param {Object} options share options
   * @param {boolean} options.partial true when the score rests on partial evidence
   * @returns {string} share message and URL
   */
  function buildShareText(username, score, productUrl = PRODUCT_URL, { partial = false } = {}) {
    const article = /^(8|11|18)/.test(String(score)) ? "an" : "a";
    // A partial score is not comparable to a complete one, so it is never shared
    // as an invitation to compare.
    if (partial) {
      return `I got ${article} ${score}/100 on a partial GitProfileLens audit (some public data was unavailable). ${buildShareUrl(username, productUrl)}`;
    }
    return `I got ${article} ${score}/100 on GitProfileLens. What's your score? ${buildShareUrl(username, productUrl)}`;
  }

  /**
   * derives compact score-card copy from calculated category scores
   * @param {string} username analyzed GitHub username
   * @param {Object} profileScore calculated overall and category scores
   * @param {Object} options score-card options
   * @param {boolean} options.partial true when the score rests on partial evidence
   * @returns {Object} dynamic score-card content
   */
  function buildScoreCardData(username, profileScore, { partial = false } = {}) {
    const entries = Object.entries(profileScore.categories);
    const strongest = entries.reduce((best, entry) => entry[1] > best[1] ? entry : best);
    const improvement = entries.reduce((weakest, entry) => entry[1] < weakest[1] ? entry : weakest);
    return {
      username: `@${String(username).trim()}`,
      score: profileScore.overall,
      strongest: `${CATEGORY_LABELS[strongest[0]]}: ${strongest[1]}/100`,
      improvement: `${CATEGORY_LABELS[improvement[0]]}: ${improvement[1]}/100`,
      productUrl: new URL(PRODUCT_URL).host,
      ...(partial ? { partial: true } : {}),
    };
  }

  return { buildScoreCardData, buildShareText, buildShareUrl };
});
