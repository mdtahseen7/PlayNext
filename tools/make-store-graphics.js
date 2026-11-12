// Generates the Chrome Web Store graphics for PlayNext.
// Pure Node + ffmpeg (drawtext/drawbox), no image service involved.
// Output: store/small-promo.png (440x280) and store/screenshot-1..3.png (1280x800)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'store');
const FONT_R = 'C\\:/Windows/Fonts/segoeui.ttf';
const FONT_B = 'C\\:/Windows/Fonts/segoeuib.ttf';

const WHITE = '0xededed';
const GRAY = '0x8f8f8f';
const DIM = '0x5a5a5a';
const BLUE = '0x0070f3';
const PANEL = '0x0a0a0a';
const BORDER = '0x262626';
const TRACK = '0x242424';

const safe = (s) => String(s).replace(/:/g, ' -').replace(/'/g, '');

function text(str, o) {
  const font = o.bold ? FONT_B : FONT_R;
  return `drawtext=fontfile='${font}':text='${safe(str)}':fontcolor=${o.color || WHITE}:fontsize=${o.size || 24}:x=${o.x}:y=${o.y}`;
}
function fill(o) {
  return `drawbox=x=${o.x}:y=${o.y}:w=${o.w}:h=${o.h}:color=${o.color || PANEL}@1:t=1`;
}
function panel(o) {
  return [fill(o), `drawbox=x=${o.x}:y=${o.y}:w=${o.w}:h=${o.h}:color=${o.color || BORDER}@1:t=2`];
}

// Chain filters into a labelled graph and return {graph, outLabel}.
function chain(steps, head) {
  const parts = [];
  let prev = head; // e.g. "0:v" or "t"
  steps.forEach((step, i) => {
    const label = 'v' + i;
    parts.push(`[${prev}]${step}[${label}]`);
    prev = label;
  });
  return { graph: parts.join(';'), out: prev };
}

function render(name, size, steps, inputs) {
  const head = inputs.length ? '0:v' : '0:v';
  const { graph, out } = chain(steps, head);
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x000000:s=${size}`];
  for (const inp of inputs) args.push('-i', inp);
  args.push('-filter_complex', graph, '-map', `[${out}]`, '-frames:v', '1', '-update', '1', path.join(OUT, name));
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('wrote store/' + name);
}

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- promo tile
{
  const logo = path.join(ROOT, 'icons', 'logo.png');
  const steps = [
    ...['[1:v]scale=64:64[lg]', '[0:v][lg]overlay=40:44[t]'].map(() => null).filter(Boolean),
  ];
  // build manually because of the logo overlay
  const fc = [
    `[1:v]scale=64:64[lg]`,
    `[0:v][lg]overlay=40:44[t0]`,
    `[t0]${fill({ x: 40, y: 36, w: 4, h: 64, color: BLUE })}[t1]`,
    `[t1]${text('PlayNext', { x: 64, y: 136, size: 34, bold: true })}[t2]`,
    `[t2]${text('Watch movies and TV shows', { x: 40, y: 196, size: 15, color: GRAY })}[t3]`,
    `[t3]${text('straight from IMDb', { x: 40, y: 218, size: 15, color: GRAY })}[t4]`
  ].join(';');
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x000000:s=440x280', '-i', logo,
    '-filter_complex', fc, '-map', '[t4]', '-frames:v', '1', '-update', '1', path.join(OUT, 'small-promo.png')];
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('wrote store/small-promo.png');
}

// ------------------------------------------------------------- screenshot 1
{
  const logo = path.join(ROOT, 'icons', 'logo.png');
  const steps = [
    fill({ x: 100, y: 92, w: 56, h: 4, color: BLUE }),
    text('PlayNext', { x: 100, y: 250, size: 76, bold: true }),
    text('Watch movies and TV shows directly from IMDb.', { x: 100, y: 356, size: 28, color: GRAY })
  ];
  const chips = ['One click to play', 'Subtitles included', 'Progress that follows you'];
  let x = 100;
  for (const c of chips) {
    const w = 60 + c.length * 11.5;
    steps.push(...panel({ x: x, y: 440, w: w, h: 62 }));
    steps.push(text(c, { x: x + 26, y: 461, size: 20 }));
    x += w + 26;
  }
  steps.push(text('No account. No tracking. Everything stays on your device.', { x: 100, y: 600, size: 21, color: DIM }));

  const fc = [`[1:v]scale=104:104[lg]`, `[0:v][lg]overlay=100:110[t0]`];
  let prev = 't0';
  steps.forEach((s, i) => {
    const label = 's' + i;
    fc.push(`[${prev}]${s}[${label}]`);
    prev = label;
  });
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x000000:s=1280x800', '-i', logo,
    '-filter_complex', fc.join(';'), '-map', `[${prev}]`, '-frames:v', '1', '-update', '1', path.join(OUT, 'screenshot-1.png')];
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('wrote store/screenshot-1.png');
}

// ------------------------------------------------------------- screenshot 2
{
  const steps = [];
  steps.push(text('Subtitles that actually work', { x: 100, y: 96, size: 52, bold: true }));
  steps.push(text('Live styling, instant sync and automatic fallback.', { x: 100, y: 172, size: 24, color: GRAY }));
  steps.push(...panel({ x: 100, y: 250, w: 1080, h: 330 }));
  const rows = [['Font size', 0.42], ['Text colour', 0.66], ['Background', 0.3], ['Sync offset', 0.78]];
  let y = 292;
  for (const [label, pos] of rows) {
    steps.push(text(label, { x: 140, y: y, size: 20, color: GRAY }));
    steps.push(fill({ x: 380, y: y + 8, w: 700, h: 6, color: TRACK }));
    steps.push(fill({ x: 380, y: y + 8, w: Math.round(700 * pos), h: 6, color: BLUE }));
    steps.push(fill({ x: 380 + Math.round(700 * pos) - 7, y: y + 3, w: 14, h: 16, color: WHITE }));
    y += 62;
  }
  steps.push(...panel({ x: 100, y: 620, w: 1080, h: 104, color: '0x141414' }));
  steps.push(fill({ x: 440, y: 650, w: 400, h: 44, color: '0x000000' }));
  steps.push(text('Subtitles are served automatically', { x: 470, y: 662, size: 19 }));
  steps.push(text('Sync applies while you drag the slider. No reload.', { x: 100, y: 756, size: 19, color: DIM }));
  render('screenshot-2.png', '1280x800', steps, []);
}

// ------------------------------------------------------------- screenshot 3
{
  const steps = [];
  steps.push(text('Download with sound', { x: 100, y: 96, size: 52, bold: true }));
  steps.push(text('Video and audio merged into one seekable MP4.', { x: 100, y: 172, size: 24, color: GRAY }));
  steps.push(...panel({ x: 100, y: 250, w: 1080, h: 150 }));
  steps.push(text('TheMovie.2024.1080p.mp4', { x: 140, y: 286, size: 24, bold: true }));
  steps.push(text('Video and audio, fully seekable', { x: 140, y: 330, size: 19, color: GRAY }));
  steps.push(fill({ x: 700, y: 302, w: 420, h: 8, color: TRACK }));
  steps.push(fill({ x: 700, y: 302, w: 286, h: 8, color: BLUE }));
  steps.push(text('68 percent', { x: 1136, y: 294, size: 18, color: GRAY }));
  steps.push(...panel({ x: 100, y: 430, w: 1080, h: 120 }));
  steps.push(text('TheMovie.2024.en.srt', { x: 140, y: 462, size: 24, bold: true }));
  steps.push(text('Subtitle sidecar, picked up automatically by VLC and mpv', { x: 140, y: 502, size: 19, color: GRAY }));
  const chips = ['No external tools', 'Quality picker', 'Cancel any time'];
  let x = 100;
  for (const c of chips) {
    const w = 60 + c.length * 11.5;
    steps.push(...panel({ x: x, y: 600, w: w, h: 58 }));
    steps.push(text(c, { x: x + 26, y: 619, size: 19 }));
    x += w + 26;
  }
  steps.push(text('Everything runs inside the extension.', { x: 100, y: 716, size: 19, color: DIM }));
  render('screenshot-3.png', '1280x800', steps, []);
}
console.log('done');
