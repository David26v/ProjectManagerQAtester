// Shared presentation helpers for recorded/suite steps — icon per step type,
// duration estimate, and a one-line "what this step targets" string. Used by
// the Recorder panel, Save Suite modal, and Suite Detail so all three agree
// on how a step reads.

import { Globe, MousePointerClick, TextCursorInput, ListChecks, Keyboard, Eye, CheckSquare, HelpCircle } from 'lucide-react';

const STEP_ICONS = {
  goto: Globe,
  click: MousePointerClick,
  fill: TextCursorInput,
  select: ListChecks,
  press: Keyboard,
  waitFor: HelpCircle,
  assertVisible: Eye,
  assertText: CheckSquare,
};

export function stepIcon(type) {
  return STEP_ICONS[type] || HelpCircle;
}

// Recorder has no real timing model in v1 — the mockups' "Estimated
// Duration" is a flat per-step estimate (2s/action), not a measured value.
const ESTIMATED_MS_PER_STEP = 2000;

export function estimateDurationMs(steps) {
  return (steps?.length || 0) * ESTIMATED_MS_PER_STEP;
}

export function fmtEstimate(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// The bit of a step worth showing under its name — a selector for
// click/fill/select/waitFor/assert*, the target value for goto/press.
export function stepDetail(step) {
  if (step.selector) return step.selector;
  if (step.value) return step.value;
  return '';
}
