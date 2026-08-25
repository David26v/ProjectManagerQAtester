// Bug severity heuristic — mirrors `src/engine/exporters/ticket.js`'s
// `deriveSeverity`/`findFailingStep`/`stepsUpToFailure` exactly (same
// regex), recomputed here so Run Detail / Report Builder can show a
// suggestion without a round trip through `reports.ticketText`.

const SEVERE_STEP_PATTERN = /login|checkout|payment/i;

export function findFailingStep(run) {
  return (run?.steps || []).find((s) => s.status === 'failed');
}

export function stepsUpToFailure(run) {
  const steps = run?.steps || [];
  const failIndex = steps.findIndex((s) => s.status === 'failed');
  const end = failIndex === -1 ? steps.length : failIndex + 1;
  return steps.slice(0, end);
}

export function deriveSeverity(run) {
  const failingStep = findFailingStep(run);
  if (failingStep && SEVERE_STEP_PATTERN.test(failingStep.name)) return 'high';
  return 'medium';
}

export const SEVERITY_REASONS = {
  high: ['Affects core user journey', 'Blocks access to application', 'Reproducible in the recorded environment'],
  medium: ['Non-critical path affected', 'Workaround may be available'],
  low: ['Cosmetic or minor impact'],
};

// Best-effort parse of a Playwright error message for a selector + timeout —
// not every error carries either (e.g. assertText's "Expected ... but found
// ..." has neither), so callers must treat both as optional.
export function parseErrorDetails(errorText) {
  if (!errorText) return { selector: null, timeout: null };
  const selectorMatch =
    errorText.match(/waiting for selector\s+"([^"]+)"/i) ||
    errorText.match(/locator\(["'`]([^"'`]+)["'`]\)/i) ||
    errorText.match(/selector[:\s]+["'`]([^"'`]+)["'`]/i);
  const timeoutMatch = errorText.match(/timeout\s+(\d+)\s*ms/i) || errorText.match(/(\d+)\s*ms\s+exceeded/i);
  return {
    selector: selectorMatch ? selectorMatch[1] : null,
    timeout: timeoutMatch ? `${timeoutMatch[1]} ms` : null,
  };
}
