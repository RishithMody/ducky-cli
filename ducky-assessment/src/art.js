// Gemini-CLI-style block wordmark with a blue→purple→pink horizontal gradient.
const ART = [
  '██████╗ ██╗   ██╗ ██████╗██╗  ██╗██╗   ██╗',
  '██╔══██╗██║   ██║██╔════╝██║ ██╔╝╚██╗ ██╔╝',
  '██║  ██║██║   ██║██║     █████╔╝  ╚████╔╝ ',
  '██║  ██║██║   ██║██║     ██╔═██╗   ╚██╔╝  ',
  '██████╔╝╚██████╔╝╚██████╗██║  ██╗   ██║   ',
  '╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═╝   ',
];
const STOPS = [[66, 133, 244], [155, 114, 203], [217, 101, 112]]; // Gemini blue→purple→pink

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function gradientColor(t) {
  const seg = t * (STOPS.length - 1);
  const i = Math.min(Math.floor(seg), STOPS.length - 2);
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  const f = seg - i;
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

export function renderArt() {
  const tty = process.stdout.isTTY;
  const width = Math.max(...ART.map((l) => [...l].length));
  return ART.map((line) => {
    if (!tty) return line;
    return [...line].map((ch, x) => {
      const [r, g, b] = gradientColor(width > 1 ? x / (width - 1) : 0);
      return `\x1b[38;2;${r};${g};${b}m${ch}`;
    }).join('') + '\x1b[0m';
  }).join('\n');
}

export function rgb(r, g, b, s) {
  return process.stdout.isTTY ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : s;
}
