// Pure helpers, kept free of n8n imports so they can be tested directly.
function transform(value) {
  return String(value ?? '').trim();
}

module.exports = { transform };
