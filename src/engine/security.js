'use strict';

// Passive security auditor. Given only what a normal test run already
// observes — the document responses it received, the subresource requests
// the page made, and the cookies the site set — it reports defensive
// hygiene findings about the tester's OWN application. It sends NO extra
// requests, injects nothing, and attacks nothing: every input here is a
// by-product of the functional run, so a security audit is "free" and
// completely non-intrusive. Pure Node, no Electron, unit-testable.
//
// Scope is deliberately defensive-only (headers, cookie flags, transport,
// mixed content, tech disclosure) — the things a QA tester should hand a
// developer, not an exploitation toolkit.

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

// One row per check. `applies` decides whether the check is relevant for a
// given document response; `evaluate` returns a findings-fragment string
// when something is wrong, or null when it's fine.
function analyzeDocument(doc) {
  const findings = [];
  const headers = doc.headers || {};
  const isHttps = /^https:/i.test(doc.url);
  const h = (name) => headers[name.toLowerCase()];

  const add = (severity, id, title, detail) => findings.push({ severity, id, title, detail, url: doc.url });

  if (!h('content-security-policy')) {
    add('medium', 'csp-missing', 'No Content-Security-Policy header',
      'The page ships no CSP, so the browser cannot restrict where scripts, styles, and frames may load from — the main defense against cross-site scripting.');
  }
  if (!h('x-content-type-options')) {
    add('low', 'nosniff-missing', 'Missing X-Content-Type-Options: nosniff',
      'Without nosniff the browser may MIME-sniff responses, which can turn an uploaded file into executable script.');
  }
  if (!h('x-frame-options') && !/frame-ancestors/i.test(h('content-security-policy') || '')) {
    add('medium', 'clickjacking', 'No clickjacking protection',
      'Neither X-Frame-Options nor a CSP frame-ancestors directive is set, so the page can be embedded in a hostile iframe (clickjacking).');
  }
  if (isHttps && !h('strict-transport-security')) {
    add('medium', 'hsts-missing', 'No Strict-Transport-Security (HSTS)',
      'An HTTPS site without HSTS can be downgraded to HTTP by a network attacker on the user\'s first visit.');
  }
  if (!h('referrer-policy')) {
    add('low', 'referrer-policy', 'No Referrer-Policy header',
      'Without an explicit Referrer-Policy, full URLs (which can carry tokens or IDs) may leak to third-party sites via the Referer header.');
  }
  if (h('server') || h('x-powered-by')) {
    const disclosed = [h('server') && `Server: ${h('server')}`, h('x-powered-by') && `X-Powered-By: ${h('x-powered-by')}`]
      .filter(Boolean)
      .join(' · ');
    add('low', 'tech-disclosure', 'Server technology disclosed in headers',
      `Response advertises its stack (${disclosed}). Version banners help an attacker target known CVEs — consider removing them.`);
  }

  return findings;
}

// `cookies` are the structured Playwright cookie objects (name, secure,
// httpOnly, sameSite, domain). Flags matter for session/auth cookies most,
// but we flag any cookie missing them since we can't reliably know which is
// which from the outside.
function analyzeCookies(cookies, anyHttps) {
  const findings = [];
  for (const c of cookies || []) {
    const problems = [];
    if (anyHttps && !c.secure) problems.push('no Secure flag');
    if (!c.httpOnly) problems.push('no HttpOnly flag');
    if (!c.sameSite || c.sameSite === 'None') problems.push('SameSite not restricting');
    if (problems.length) {
      findings.push({
        severity: c.httpOnly === false && anyHttps && !c.secure ? 'high' : 'medium',
        id: `cookie-flags-${c.name}`,
        title: `Cookie "${c.name}" is missing protection flags`,
        detail: `Set-Cookie for "${c.name}" has: ${problems.join(', ')}. A session cookie without HttpOnly can be stolen by XSS; without Secure it can leak over HTTP.`,
        url: c.domain || '',
      });
    }
  }
  return findings;
}

// `requests` = [{ url, resourceType }] the page issued. On an HTTPS document,
// any http:// subresource is mixed content the browser may block or that
// weakens the page's integrity.
function analyzeMixedContent(documentResponses, requests) {
  const findings = [];
  const anyHttpsDoc = documentResponses.some((d) => /^https:/i.test(d.url));
  if (!anyHttpsDoc) return findings;

  const seen = new Set();
  for (const r of requests || []) {
    if (/^http:\/\//i.test(r.url) && !seen.has(r.url)) {
      seen.add(r.url);
      findings.push({
        severity: 'medium',
        id: `mixed-content-${seen.size}`,
        title: 'Mixed content: insecure resource on a secure page',
        detail: `An HTTPS page loaded ${r.resourceType || 'a resource'} over plain HTTP (${r.url}). Modern browsers block or downgrade these, and they break the page's security guarantees.`,
        url: r.url,
      });
    }
  }
  return findings.slice(0, 10); // cap the noise from a CDN misconfig
}

// Insecure transport for credentials: a password field served over HTTP, or
// a form whose action posts over HTTP.
function analyzeInsecureForms(forms) {
  const findings = [];
  for (const f of forms || []) {
    if (f.hasPassword && /^http:/i.test(f.pageUrl)) {
      findings.push({
        severity: 'high',
        id: 'password-over-http',
        title: 'Password field served over HTTP',
        detail: `A password input was found on ${f.pageUrl}, which is not HTTPS. Credentials typed here travel in cleartext.`,
        url: f.pageUrl,
      });
    }
    if (/^http:/i.test(f.action || '')) {
      findings.push({
        severity: 'high',
        id: 'form-post-http',
        title: 'Form submits over HTTP',
        detail: `A form on ${f.pageUrl} posts to an insecure URL (${f.action}). Submitted data — possibly credentials — is sent in cleartext.`,
        url: f.action,
      });
    }
  }
  return findings;
}

// Dedupe by id (the same header gap repeats across every page) keeping the
// first occurrence, then sort by severity.
function dedupeAndSort(findings) {
  const byId = new Map();
  for (const f of findings) {
    if (!byId.has(f.id)) byId.set(f.id, f);
  }
  return Array.from(byId.values()).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// Entry point. `documentResponses`: [{ url, status, headers }] main-frame
// navigations. `requests`: [{ url, resourceType }]. `cookies`: Playwright
// cookie objects. `forms`: [{ pageUrl, action, hasPassword }].
function analyzeSecurity({ documentResponses = [], requests = [], cookies = [], forms = [] } = {}) {
  const anyHttps = documentResponses.some((d) => /^https:/i.test(d.url));
  const findings = [
    ...documentResponses.flatMap(analyzeDocument),
    ...analyzeCookies(cookies, anyHttps),
    ...analyzeMixedContent(documentResponses, requests),
    ...analyzeInsecureForms(forms),
  ];

  const deduped = dedupeAndSort(findings);
  return {
    findings: deduped,
    summary: {
      total: deduped.length,
      high: deduped.filter((f) => f.severity === 'high').length,
      medium: deduped.filter((f) => f.severity === 'medium').length,
      low: deduped.filter((f) => f.severity === 'low').length,
    },
  };
}

module.exports = { analyzeSecurity };
