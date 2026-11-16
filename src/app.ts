/** Animation adapted from https://github.com/stackedlol/ascii-sharks by stackedlol. */
import { OceanEngine } from './engine';
import type { SharkKind, SharkSpec } from './world';
import type { RenderMode } from './renderer';
import { themes, type OceanTheme } from './themes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const icons = {
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>',
};
const mixed: SharkSpec[] = [
  { kind: 'whaleshark', size: 1 }, { kind: 'manta', size: .83 },
  { kind: 'hammerhead', size: .86 },
  { kind: 'sunfish', size: .64 }, { kind: 'classic', size: .78 },
];
const kinds: SharkKind[] = ['manta', 'whaleshark', 'sunfish', 'thresher', 'mako', 'nurse', 'greathammer', 'zebra', 'tiger', 'classic', 'hammerhead'];
const names: Record<SharkKind, string> = { manta: 'Manta ray', whaleshark: 'Whale shark', sunfish: 'Sunfish', thresher: 'Thresher shark', mako: 'Mako shark', nurse: 'Nurse shark', greathammer: 'Great hammerhead', zebra: 'Zebra shark', tiger: 'Tiger shark', classic: 'Classic shark', hammerhead: 'Hammerhead' };
let roster = mixed.map(s => ({ ...s }));
let paused = false;
const themeModes = Object.keys(themes) as OceanTheme[];
let currentTheme: OceanTheme = 'light';
let statusTimer: ReturnType<typeof setTimeout>;
const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
};
function status(message: string) {
  const el = $('ocean-status');
  clearTimeout(statusTimer);
  el.textContent = message;
  el.classList.add('visible');
  statusTimer = setTimeout(() => el.classList.remove('visible'), 3400);
}

const pause = $<HTMLButtonElement>('pause');
const theme = $<HTMLButtonElement>('theme');
const themeSelect = $<HTMLSelectElement>('water-theme');
pause.innerHTML = icons.pause;


const engine = new OceanEngine($<HTMLCanvasElement>('ocean'), roster);
// Give the initial scene a small head start, so the first frame already feels alive.
engine.setSharks(roster);

const renderModes: RenderMode[] = ['braille', 'geometry', 'ascii', 'hanzi'];
const modeLabels: Record<RenderMode, string> = { ascii: 'ASCII', braille: 'DOTS', geometry: 'GEO', hanzi: 'HANZI' };
const modeNames: Record<RenderMode, string> = { ascii: 'ASCII', braille: 'Braille dots', geometry: 'Geometric shapes', hanzi: 'Hanzi' };
const modeDescriptions: Record<RenderMode, string> = {
  ascii: 'Monospaced characters and shaded cells shape the fish.',
  braille: 'Fine dots trace the fish silhouettes.',
  geometry: 'Dots, rings, diamonds, and squares form the fish.',
  hanzi: 'The fish are drawn with characters from the Classic of Clarity and Stillness.',
};
let renderMode: RenderMode = 'ascii';
function applyRenderMode(mode: RenderMode) {
  renderMode = mode;
  engine.setRenderMode(mode);
  $<HTMLSelectElement>('render-mode').value = mode;
  $('style-toggle').textContent = modeLabels[mode];
  $('style-toggle').setAttribute('aria-label', `Cycle character styles. Current style is ${modeNames[mode]}.`);
  $('style-toggle').title = `${modeNames[mode]} · Next style`;
  $('mode-description').textContent = modeDescriptions[mode];
  storage.set('ascii-ocean-render-mode', mode);
}
const savedMode = storage.get('ascii-ocean-render-mode') as RenderMode | null;
applyRenderMode(savedMode && renderModes.includes(savedMode) ? savedMode : 'ascii');
$<HTMLSelectElement>('render-mode').addEventListener('change', e => applyRenderMode((e.target as HTMLSelectElement).value as RenderMode));
$('style-toggle').addEventListener('click', () => applyRenderMode(renderModes[(renderModes.indexOf(renderMode) + 1) % renderModes.length]));

pause.addEventListener('click', () => {
  paused = !paused;
  engine.setPaused(paused);
  pause.innerHTML = paused ? icons.play : icons.pause;
  pause.setAttribute('aria-label', paused ? 'Resume animation' : 'Pause animation');
  pause.setAttribute('aria-pressed', String(paused));
  pause.title = paused ? 'Resume animation' : 'Pause animation';
});

function applyTheme(value: OceanTheme) {
  currentTheme = value;
  const { label, page } = themes[value];
  document.documentElement.dataset.theme = value;
  document.documentElement.style.setProperty('--page', page);
  engine.setTheme(value);
  themeSelect.value = value;
  theme.textContent = label;
  theme.setAttribute('aria-label', `Cycle water themes. Current theme is ${label}.`);
  theme.title = `${label} · Next water theme`;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', page);
}

const savedTheme = storage.get('ascii-ocean-theme') as OceanTheme | null;
applyTheme(savedTheme && themeModes.includes(savedTheme) ? savedTheme : currentTheme);

// Fade only the old water layer; controls remain live while the new palette renders.
function changeTheme(value: OceanTheme) {
  if (value === currentTheme) return;
  document.querySelectorAll('.ocean-theme-veil').forEach(el => el.remove());
  let veil: HTMLCanvasElement | null = null;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const canvas = $<HTMLCanvasElement>('ocean');
    const snapshot = document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const context = snapshot.getContext('2d');
    if (context && 'filter' in context) {
      const appearance = getComputedStyle(canvas);
      context.fillStyle = getComputedStyle(document.body).backgroundColor;
      context.fillRect(0, 0, snapshot.width, snapshot.height);
      context.filter = appearance.filter;
      context.globalAlpha = Number(appearance.opacity);
      context.drawImage(canvas, 0, 0);
      snapshot.className = 'ocean-theme-veil';
      snapshot.setAttribute('aria-hidden', 'true');
      canvas.after(snapshot);
      veil = snapshot;
    }
  }
  applyTheme(value);
  storage.set('ascii-ocean-theme', value);
  if (veil) {
    const snapshot = veil;
    const fade = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 480, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards',
    });
    fade.finished.catch(() => {}).finally(() => snapshot.remove());
    // A background tab can suspend animations; do not leave an obsolete layer behind.
    window.setTimeout(() => snapshot.remove(), 650);
  }
}

theme.addEventListener('click', () => changeTheme(themeModes[(themeModes.indexOf(currentTheme) + 1) % themeModes.length]));
themeSelect.addEventListener('change', () => changeTheme(themeSelect.value as OceanTheme));

const settingsToggle = $('settings-toggle');
const settingsPanel = $('settings-panel');

function setSettingsOpen(open: boolean) {
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', String(open));
}

settingsToggle.addEventListener('click', () => setSettingsOpen(settingsPanel.hidden));
document.addEventListener('click', e => {
  if (!(e.target as Element).closest('.ocean-controls')) setSettingsOpen(false);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || settingsPanel.hidden) return;
  if (settingsPanel.contains(document.activeElement)) settingsToggle.focus();
  setSettingsOpen(false);
});

const speed = $<HTMLInputElement>('speed');
speed.addEventListener('input', () => { engine.setSpeed(Number(speed.value)); $('speed-value').textContent = `${Number(speed.value).toFixed(2)}×`; });
$<HTMLSelectElement>('roster').addEventListener('change', e => {
  const kind = (e.target as HTMLSelectElement).value;
  roster = kind === 'mixed' ? mixed.map(s => ({ ...s })) : [1, .87, .76, .68].map(size => ({ kind: kind as SharkKind, size }));
  engine.setSharks(roster);
});
$('add-shark').addEventListener('click', () => {
  if (roster.length >= 9) { status('The tank is full. Let the animals swim.'); return; }
  const kind = kinds.find(kind => !roster.some(fish => fish.kind === kind)) ?? kinds[roster.length % kinds.length];
  roster.push({ kind, size: .64 + Math.random() * .15 });
  engine.setSharks(roster);
  status(`Now swimming · ${names[kind]}`);
});
$('ripple').addEventListener('click', () => {
  const panel = document.querySelector<HTMLElement>('.center-panel:not([hidden])');
  engine.rippleNearSchool(panel?.getBoundingClientRect());
  status('A ripple spreads across the water.');
});

type Layout = 'music' | 'focus';
const layouts: Layout[] = ['music', 'focus'];
const layoutNames: Record<Layout, string> = { music: 'Music', focus: 'Focus' };
const headlines: Record<Layout, string> = { music: 'take a little break.', focus: 'one thing at a time.' };
let layout: Layout = 'music';

// Playback is a visual demo; no audio file or remote service is needed.
const tracks = [
  { title: 'Somewhere, slowly', artist: 'Late Tide', duration: 272 },
  { title: 'Blue hour', artist: 'Quiet Current', duration: 218 },
  { title: 'A softer place', artist: 'Still Water', duration: 305 },
];
let trackIndex = 0;
let trackPosition = 84;
let trackStartedAt = 0;
let playing = false;
const trackSeek = $<HTMLInputElement>('track-seek');
const trackPlay = $('track-play');
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function updateText(id: string, text: string) { if ($(id).textContent !== text) $(id).textContent = text; }
function updatePlayButton(button: HTMLElement, active: boolean, label: string) {
  if (!button.firstElementChild || button.getAttribute('aria-pressed') !== String(active)) button.innerHTML = active ? icons.pause : icons.play;
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', label);
  button.title = label;
}
function playbackPosition() { return Math.min(tracks[trackIndex].duration, trackPosition + (playing ? (performance.now() - trackStartedAt) / 1000 : 0)); }
function renderTrack() {
  const track = tracks[trackIndex];
  const position = playbackPosition();
  updateText('track-title', track.title);
  updateText('track-artist', track.artist);
  updateText('track-elapsed', formatTime(position));
  updateText('track-duration', formatTime(track.duration));
  trackSeek.max = String(track.duration);
  trackSeek.value = String(Math.floor(position));
  trackSeek.style.setProperty('--progress', `${position / track.duration * 100}%`);
  trackSeek.setAttribute('aria-valuetext', `${formatTime(position)} / ${formatTime(track.duration)}`);
  $('music-panel').classList.toggle('is-playing', playing);
  updatePlayButton(trackPlay, playing, playing ? 'Pause playback demo' : 'Play demo');
}
function setPlaying(value: boolean) {
  trackPosition = playbackPosition();
  if (value && trackPosition >= tracks[trackIndex].duration) trackPosition = 0;
  playing = value;
  trackStartedAt = performance.now();
  renderTrack();
}
function changeTrack(direction: number) {
  trackIndex = (trackIndex + direction + tracks.length) % tracks.length;
  trackPosition = 0;
  trackStartedAt = performance.now();
  renderTrack();
}
trackPlay.addEventListener('click', () => setPlaying(!playing));
$('track-previous').addEventListener('click', () => changeTrack(-1));
$('track-next').addEventListener('click', () => changeTrack(1));
trackSeek.addEventListener('input', () => {
  trackPosition = Number(trackSeek.value);
  trackStartedAt = performance.now();
  renderTrack();
});
renderTrack();

const focusDuration = 25 * 60;
let focusRemaining = focusDuration;
let focusEndsAt = 0;
let focusing = false;
const focusPlay = $('focus-play');
const focusTask = $<HTMLInputElement>('focus-task');
focusTask.value = storage.get('ascii-ocean-focus-task')?.slice(0, 100) || 'Make something good.';
focusTask.addEventListener('input', () => storage.set('ascii-ocean-focus-task', focusTask.value));
function remainingFocus() { return focusing ? Math.max(0, (focusEndsAt - Date.now()) / 1000) : focusRemaining; }
function renderFocus() {
  updateText('focus-time', formatTime(Math.ceil(remainingFocus())).padStart(5, '0'));
  const label = focusing ? 'Pause focus timer' : focusRemaining < focusDuration && focusRemaining > 0 ? 'Resume focus timer' : 'Start focus timer';
  updatePlayButton(focusPlay, focusing, label);
}
function setFocusing(value: boolean) {
  focusRemaining = remainingFocus();
  if (value && focusRemaining <= 0) focusRemaining = focusDuration;
  focusing = value;
  focusEndsAt = Date.now() + focusRemaining * 1000;
  renderFocus();
}
focusPlay.addEventListener('click', () => setFocusing(!focusing));
$('focus-reset').addEventListener('click', () => {
  focusing = false;
  focusRemaining = focusDuration;
  renderFocus();
});
renderFocus();

function applyLayout(value: Layout, animate = true) {
  // Hidden demos pause, so switching away never silently consumes a focus session.
  if (value !== 'music' && playing) setPlaying(false);
  if (value !== 'focus' && focusing) setFocusing(false);
  layout = value;
  setSettingsOpen(false);
  clearTimeout(statusTimer);
  $('ocean-status').classList.remove('visible');
  for (const name of layouts) $(`${name}-panel`).hidden = name !== value;
  $('hero-title').textContent = headlines[value];
  $('layout-label').textContent = layoutNames[value];
  const next = layouts[(layouts.indexOf(value) + 1) % layouts.length];
  const description = `Switch from ${layoutNames[value]} to ${layoutNames[next]}`;
  $('layout-toggle').setAttribute('aria-label', description);
  $('layout-toggle').title = `Switch to ${layoutNames[next]}`;
  document.querySelectorAll('.layout-dots i').forEach((dot, i) => dot.classList.toggle('active', i === layouts.indexOf(value)));
  storage.set('ascii-ocean-layout', value);
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of [$('hero-title'), ...layouts.map(name => $(`${name}-panel`))]) el.getAnimations().forEach(animation => animation.cancel());
    for (const el of [$('hero-title'), $(`${value}-panel`)]) el.animate([{ opacity: 0, translate: '0 5px' }, { opacity: 1, translate: '0 0' }], { duration: 230, easing: 'ease-out' });
  }
}
const savedLayout = storage.get('ascii-ocean-layout') as Layout | null;
applyLayout(savedLayout && layouts.includes(savedLayout) ? savedLayout : 'music', false);
$('layout-toggle').addEventListener('click', () => applyLayout(layouts[(layouts.indexOf(layout) + 1) % layouts.length]));
const demoTimer = window.setInterval(() => {
  if (playing) {
    if (playbackPosition() >= tracks[trackIndex].duration) changeTrack(1);
    else renderTrack();
  }
  if (focusing) {
    if (remainingFocus() <= 0) {
      setFocusing(false);
      status('Focus session complete. Take a break.');
      engine.ripple(window.innerWidth * .5, window.innerHeight * .6);
    } else renderFocus();
  }
}, 250);

window.addEventListener('pagehide', () => { window.clearInterval(demoTimer); engine.destroy(); }, { once: true });
