// Aurora: domain-warped, layered fbm bands sweeping across the screen,
// curl-noise-ish motion, beat triggers a "flare". Shader-only, cheap.
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
uniform float uChroma[12];
uniform vec3 uPal[5];
out vec4 frag;

${GLSL_HELPERS}

void main(){
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x/uRes.y, 1.0);

  float t = uTime * 0.1;
  // Domain warp
  vec2 q = p;
  q.x += 0.4 * fbm(p*1.5 + vec2(0.0, t));
  q.y += 0.4 * fbm(p*1.5 + vec2(t, 0.0));

  // Aurora bands: vertical ribbons modulated by horizontal phase
  float bands = 0.0;
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    float phase = t * (0.6 + fi*0.2) + fi * 1.7;
    float band = sin(q.x*3.0 + phase + q.y*2.0);
    band = exp(-pow((q.y - 0.2*sin(q.x*1.5 + phase)) * 3.0, 2.0)) * (0.5 + 0.5*band);
    bands += band * (0.3 + 0.2*float(i));
  }
  bands *= 0.6 + uLevel * 0.6;

  // Chroma drives palette index — most-energetic pitch class picks a hue
  float maxC = 0.0; int idx = 0;
  for (int i = 0; i < 12; i++){
    if (uChroma[i] > maxC) { maxC = uChroma[i]; idx = i; }
  }
  float hueOff = float(idx) / 12.0;

  // pick two palette colors and blend by band intensity
  vec3 colA = uPal[(idx) % 5];
  vec3 colB = uPal[(idx + 2) % 5];
  vec3 col = mix(colA, colB, smoothstep(0.0, 1.0, bands));
  col *= bands;

  // Stars (treble glints)
  float stars = pow(noise(p * 200.0 + uTime), 30.0) * uTreble * 1.5;
  col += vec3(1.0, 0.95, 0.9) * stars;

  // Beat flare from bottom
  float flare = exp(-pow((uv.y - 0.0) * 4.0, 2.0)) * uBeatPunch * 0.6;
  col += uPal[0] * flare;

  // Background gradient (deep)
  vec3 bg = mix(uPal[4]*0.06, uPal[3]*0.16, smoothstep(0.0, 1.0, uv.y));
  col += bg;

  frag = vec4(col, 1.0);
}
`;

export class AuroraVisualizer extends Visualizer {
  static id = 'aurora';
  static name = 'Aurora';
  static desc = 'Northern-lights ribbons';

  constructor(r) {
    super(r);
    this.prog = r.buildProgram(VS_QUAD, FS);
  }
  render(f, t) {
    const gl = this.gl;
    gl.useProgram(this.prog.program);
    gl.uniform2f(this.prog.u.uRes, this.r.width, this.r.height);
    gl.uniform1f(this.prog.u.uTime, t);
    gl.uniform1f(this.prog.u.uBass, f.bass);
    gl.uniform1f(this.prog.u.uMid, f.mid);
    gl.uniform1f(this.prog.u.uTreble, f.treble);
    gl.uniform1f(this.prog.u.uBeatPunch, f.beatPunch);
    gl.uniform1f(this.prog.u.uLevel, f.level);
    gl.uniform1fv(this.prog.u.uChroma, f.chroma);
    if (this.palette) {
      const fl = new Float32Array(15);
      for (let i = 0; i < 5; i++) { fl[i*3]=this.palette[i][0]; fl[i*3+1]=this.palette[i][1]; fl[i*3+2]=this.palette[i][2]; }
      gl.uniform3fv(this.prog.u.uPal, fl);
    }
    this.r.drawQuad();
  }
}
