// Spectrum bars (mirrored), beat-pulsing, palette-tinted.
import { Visualizer, VS_QUAD, GLSL_HELPERS } from './base.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uBeatPunch;
uniform float uBass;
uniform float uTreble;
uniform float uLevel;
uniform float uSpec[64];
uniform vec3 uPal[5];
out vec4 frag;

${GLSL_HELPERS}

void main(){
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  // background: subtle radial palette
  vec3 bg = mix(uPal[4]*0.10, uPal[3]*0.18, smoothstep(0.0, 0.8, length(uv - 0.5)));
  bg += 0.04 * uPal[0] * uBeatPunch;

  // Mirror around y = 0.5
  float y = uv.y;
  float dy = abs(y - 0.5) * 2.0; // 0 at center, 1 at edges

  // Bar index from x
  float NB = 64.0;
  float bx = uv.x * NB;
  int i = int(clamp(bx, 0.0, NB - 1.0));
  float frac = fract(bx);
  // sample neighbors for soft edges
  float a = uSpec[i];
  float b = uSpec[min(i+1, 63)];
  float v = mix(a, b, smoothstep(0.0, 1.0, frac));

  // bar height boosted by beat and overall level
  float h = pow(v, 0.7) * (0.55 + uBeatPunch * 0.4 + uLevel * 0.3);
  float bar = smoothstep(h, h - 0.01, dy);

  // gap between bars
  float gap = 0.7;
  float bars = smoothstep(gap, gap*0.6, abs(fract(bx) - 0.5));
  bars = 1.0 - bars;
  bar *= bars;

  // color: palette gradient by frequency, brightened by treble
  float t = uv.x;
  vec3 col = mix(uPal[0], uPal[1], smoothstep(0.0, 0.4, t));
  col = mix(col, uPal[2], smoothstep(0.4, 0.8, t));
  col = mix(col, uPal[3], smoothstep(0.8, 1.0, t));
  col *= 0.7 + uTreble * 0.6;

  // Glow under each bar
  float glow = exp(-dy * 6.0) * v * 0.5;

  vec3 outc = bg + bar * col + glow * col;
  frag = vec4(outc, 1.0);
}
`;

export class BarsVisualizer extends Visualizer {
  static id = 'bars';
  static name = 'Spectrum Bars';
  static desc = 'Classic mirrored bars';

  constructor(r) {
    super(r);
    this.prog = r.buildProgram(VS_QUAD, FS);
  }
  render(f, t) {
    const gl = this.gl;
    gl.useProgram(this.prog.program);
    gl.uniform2f(this.prog.u.uRes, this.r.width, this.r.height);
    gl.uniform1f(this.prog.u.uTime, t);
    gl.uniform1f(this.prog.u.uBeatPunch, f.beatPunch);
    gl.uniform1f(this.prog.u.uBass, f.bass);
    gl.uniform1f(this.prog.u.uTreble, f.treble);
    gl.uniform1f(this.prog.u.uLevel, f.level);
    gl.uniform1fv(this.prog.u.uSpec, f.spectrum);
    const pal = this.palette;
    if (pal) gl.uniform3fv(this.prog.u.uPal, flat(pal));
    this.r.drawQuad();
  }
}

function flat(arr) {
  const out = new Float32Array(arr.length * 3);
  for (let i = 0; i < arr.length; i++) {
    out[i*3] = arr[i][0]; out[i*3+1] = arr[i][1]; out[i*3+2] = arr[i][2];
  }
  return out;
}
