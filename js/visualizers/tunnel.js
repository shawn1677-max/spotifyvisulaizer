// Pseudo-3D tunnel: ray-marched concentric rings flying past camera, beat-warped.
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
uniform vec3 uPal[5];
out vec4 frag;

${GLSL_HELPERS}

void main(){
  vec2 p = (vUv - 0.5) * vec2(uRes.x/uRes.y, 1.0);
  // polar
  float r = length(p);
  float a = atan(p.y, p.x);

  // Pinch / warp the angle on bass to add motion
  a += sin(uTime * 0.4 + r * 4.0) * 0.3 * (0.5 + uBass);

  // Tunnel coordinate: radial distance maps to depth z; we shift z over time.
  float depth = 0.5 / max(r, 0.001) + uTime * (1.0 + uLevel * 1.5);
  float ring = fract(depth * 1.5);
  // soft edges per ring
  float band = smoothstep(0.5, 0.45, abs(ring - 0.5));

  // angular slats
  float slat = 0.5 + 0.5 * sin(a * 24.0 + depth * 3.0);

  // shading: brighter at center, dimmed at far end, kicked by beat
  float light = exp(-r * 1.5) * (0.6 + uBeatPunch * 0.8);
  float energy = band * (0.4 + slat * 0.5) * (0.6 + uTreble * 0.6);

  // colors cycle via depth
  float t = fract(depth * 0.2 + uTime * 0.05);
  vec3 colA = mix(uPal[0], uPal[1], t);
  vec3 colB = mix(uPal[2], uPal[3], t);
  vec3 col = mix(colA, colB, slat);

  vec3 bg = uPal[4] * 0.10;

  vec3 outc = bg + col * energy * light * (1.0 + uMid * 0.5);

  // soft chromatic-ish edge punch
  outc += uPal[0] * exp(-r * 8.0) * uBeatPunch * 0.6;
  // vignette
  outc *= 1.0 - smoothstep(0.7, 1.2, r);

  frag = vec4(outc, 1.0);
}
`;

export class TunnelVisualizer extends Visualizer {
  static id = 'tunnel';
  static name = 'Tunnel';
  static desc = 'Beat-warped fly-through';

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
    if (this.palette) {
      const fl = new Float32Array(15);
      for (let i = 0; i < 5; i++) { fl[i*3]=this.palette[i][0]; fl[i*3+1]=this.palette[i][1]; fl[i*3+2]=this.palette[i][2]; }
      gl.uniform3fv(this.prog.u.uPal, fl);
    }
    this.r.drawQuad();
  }
}
