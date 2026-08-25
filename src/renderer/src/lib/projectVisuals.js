// Deterministic icon/color assignment for project cards — projects don't
// carry a stored icon/color today, so we derive one from the id so a given
// project always renders the same way across screens.
import { ShoppingCart, Globe, Server, BarChart3, Boxes, Briefcase } from 'lucide-react';

const ICONS = [ShoppingCart, Globe, Server, BarChart3, Boxes, Briefcase];
const COLORS = ['bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-500', 'bg-pink-600', 'bg-cyan-600'];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function projectVisual(project) {
  const h = hash(String(project?.id || project?.name || ''));
  return { Icon: ICONS[h % ICONS.length], colorClass: COLORS[h % COLORS.length] };
}

const NAMED_ENV_COLORS = {
  staging: { chip: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  production: { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  development: { chip: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
  qa: { chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
};
const ENV_FALLBACK = Object.values(NAMED_ENV_COLORS).concat([
  { chip: 'bg-pink-50 text-pink-700', dot: 'bg-pink-500' },
  { chip: 'bg-cyan-50 text-cyan-700', dot: 'bg-cyan-500' },
]);

function envPalette(name) {
  const key = String(name || '').toLowerCase();
  return NAMED_ENV_COLORS[key] || ENV_FALLBACK[hash(key) % ENV_FALLBACK.length];
}

export function envColorClass(name) {
  return envPalette(name).chip;
}

export function envDotClass(name) {
  return envPalette(name).dot;
}
