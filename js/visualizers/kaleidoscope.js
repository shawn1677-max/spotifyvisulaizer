// Kaleidoscope: domain-warped fbm sampled with N-fold mirror symmetry.
import { Visualizer, VS_QUAD, GLSL_HELPERS } from './base.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeatPunch;
uniform float uLevel;
uniform float uSegments;
uniform vec3 uPal[5];
out vec4 frag;

${GLSL_HELPERS}

void main(){
  vec2 p = (vUv - 0.5) * vec2(uRes.x/uRes.y, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  // N-fold symmetry
  float seg = uSegments;
  float wedge = 6.28318530 / seg;
  a = mod(a, wedge);
  a = abs(a - wedge*0.5);

  vec2 q = vec2(cos(a), sin(a)) * r;

  // Layered fbm with rotation over time and beat-driven push
  float t = uTime * 0.15 + uBeatPunch * 0.4;
  vec2 f1 = q * 3.0 + vec2(t, -t*0.7);
  vec2 f2 = q * 6.0 + vec2(-t*1.3, t*0.5);
  float n = fbm(f1) * 0.6 + fbm(f2) * 0.4;
  // bass push: compress towards bright bands
  n = pow(n, 1.0 - uBass * 0.5);

  // colorize via 4-stop palette
  vec3 col;
  if (n < 0.33) col = mix(uPal[4], uPal[0], n / 0.33);
  else if (n < 0.66) col = mix(uPal[0], uPal[1], (n - 0.33) / 0.33);
  else col = mix(uPal[1], uPal[2], (n - 0.66) / 0.34);

  // beat halo glow
  col += uPal[3] * exp(-r * 5.0) * uBeatPunch * 0.6;
  // treble sparkle
  col += vec3(1.0) * pow(n, 6.0) * uTreble * 0.6;

  // vignette
  col *= 1.0 - smoothstep(0.7, 1.1, r);
  frag = vec4(col, 1.0);
}
`;

export class KaleidoscopeVisualizer extends Visualizer {
  static id = 'kaleido';
  static name = 'Kaleidoscope';
  static desc = 'N-fold mirror world';

  constructor(r) {
    super(r);
    this.prog = r.buildProgram(VS_QUAD, FS);
    this.segments = 8;
  }
  render(f, t) {
    // segments evolve slowly with mid energy; jump on section change
    const targetSeg = 6 + Math.floor(f.sectionMood * 6);
    this.segments += (targetSeg - this.segments) * 0.02;
    if (f.sectionPunch > 0.8) this.segments = targetSeg;

    const gl = this.gl;
    gl.useProgram(this.prog.program);
    gl.uniform2f(this.prog.u.uRes, this.r.width, this.r.height);
    gl.uniform1f(this.prog.u.uTime, t);
    gl.uniform1f(this.prog.u.uBass, f.bass);
    gl.uniform1f(this.prog.u.uMid, f.mid);
    gl.uniform1f(this.prog.u.uTreble, f.treble);
    gl.uniform1f(this.prog.u.uBeatPunch, f.beatPunch);
    gl.uniform1f(this.prog.u.uLevel, f.level);
    gl.uniform1f(this.prog.u.uSegments, Math.max(3, Math.round(this.segments)));
    if (this.palette) {
      const fl = new Float32Array(15);
      for (let i = 0; i < 5; i++) { fl[i*3]=this.palette[i][0]; fl[i*3+1]=this.palette[i][1]; fl[i*3+2]=this.palette[i][2]; }
      gl.uniform3fv(this.prog.u.uPal, fl);
    }
    this.r.drawQuad();
  }
}
