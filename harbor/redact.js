/* Masks secrets a member may type (passwords, PINs, one-time codes, card and Social Security numbers) before anything is stored,
   logged or sent to a model. Harbor never needs them: it only needs to know one was shared. Node and browser. */
(function (root) {
  const RULES = [
    [/\b(password|passcode|passphrase|pin|security code|one-?time code|verification code)(\s*(?:is|was|=|:)\s*)(\S+)/gi, (m, word, sep) => word + sep + '[removed]'],
    [/\b\d{3}-\d{2}-\d{4}\b/g, '[number removed]'],              // Social Security number
    [/\b(?:\d[ -]?){12,18}\d\b/g, '[number removed]'],            // card or account number
    [/\b\d{6}\b/g, '[code removed]'],                            // one-time code
  ];
  const redact = (text) => RULES.reduce((t, [re, to]) => t.replace(re, to), String(text ?? ''));
  /** True when the text contained something that had to be masked. */
  const hasSecret = (text) => redact(text) !== String(text ?? '');
  /** Masks every string inside a JSON-like value (feedback snapshots, interaction details). */
  const deep = (v) => (typeof v === 'string' ? redact(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  const api = { redact, hasSecret, deep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HarborRedact = api;
})(typeof window !== 'undefined' ? window : globalThis);
