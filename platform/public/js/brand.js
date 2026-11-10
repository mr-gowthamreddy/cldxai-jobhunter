// Brand: name + logo. The name comes from the server (APP_NAME in platform/.env);
// the CloudX AI wordmark is inlined so it takes the current text colour
// (white in dark mode, black in light mode).
import { h } from './ui.js';

const WORDMARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 118" role="img" aria-label="CloudX AI"> <g fill="none" stroke="currentColor" stroke-width="12" stroke-linejoin="round"> <path d="M70 61H22Q8 61 8 75V87Q8 101 22 101H70"/> <path d="M89 55V101H143"/> <path d="M173 61H215Q229 61 229 75V87Q229 101 215 101H173Q159 101 159 87V75Q159 61 173 61Z"/> <path d="M251 55V87Q251 101 265 101H303Q317 101 317 87V55"/> <path d="M339 61H384Q398 61 398 75V87Q398 101 384 101H339Z"/> <path d="M532 107L559 55L586 107"/> <path d="M613 55V107"/> </g> <g fill="currentColor"> <path d="M413 55H430L474 107H457Z"/> <path d="M413 107H431C466 76 530 38 656 12C548 33 476 64 441 94Z"/> </g></svg>';
const DEFAULT_NAME = 'CloudX AI JobHunter';
let appName = DEFAULT_NAME;

export function setAppName(name) {
  if (name && typeof name === 'string') appName = name;
}
export function brandName() { return appName; }

/** Product word shown under the wordmark ("JobHunter"), or the full name for custom brands. */
function subLabel() {
  const m = /^cloud\s*x\s*ai\s*(.*)$/i.exec(appName);
  return m ? m[1] : appName;
}

function wordmark() {
  const svg = new DOMParser().parseFromString(WORDMARK, 'image/svg+xml').documentElement;
  const node = document.importNode(svg, true);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  return node;
}

/** Brand lock-up: wordmark with the product name beneath. */
export function logo({ href = '/', size = '', onclick } = {}) {
  const sub = subLabel();
  return h('a', { class: `brand ${size}`, href, onclick, 'aria-label': `${appName} home` },
    h('span', { class: 'brand-logo' }, wordmark(), sub ? h('span', { class: 'brand-sub' }, sub) : null));
}
