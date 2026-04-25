// Radial spectrum: bars arranged in a circle, glowing core, palette gradient.
import { Visualizer, VS_QUAD, GLSL_HELPERS } from './base.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uBeatPunch;
uniform float uSpec[64];
uniform vec3 uPal[5];
out vec4 frag;

${GLSL_HELPERS}

void main(){
  vec2 p = (vUv - 0.5) * vec2(uRes.x/uRes.y, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x); // -PI..PI
  float ang = (a + 3.14159265) / 6.28318530; // 0..1

  // Sample spectrum by angle
  float NB = 64.0;
  float idx = ang * NB;
  int i = int(idx) % 64;
  float v = uSpec[i];

  // Inner ring radius pulses with bass
  float inner = 0.18 + uBass * 0.07 + uBeatPunch * 0.02;
  float outer = inner + 0.04 + v * 0.32;
  float ring = smoothstep(inner, inner + 0.005, r) * smoothstep(outer, outer - 0.005, r);

  // tick segmentation
  float ticks = smoothstep(0.85, 0.7, abs(fract(idx) - 0.5));
  ring *= ticks;

  // Core glow
  float core = exp(-r * (10.0 - uBass * 4.0)) * (0.6 + uBeatPunch * 0.6);

  // Outer aura with noise
  float aura = exp(-(r - inner) * 3.5) * 0.4 * (0.5 + uMid);
  aura *= 0.6 + 0.4 * fbm(p*4.0 + uTime*0.3);

  // Color
  vec3 col = mix(uPal[0], uPal[1], smoothstep(0.0, 0.5, ang));
  col = mix(col, uPal[2], smoothstep(0.5, 1.0, ang));
  vec3 coreCol = mix(uPal[3], vec3(1.0), uTreble);

  vec3 outc = vec3(0.0);
  outc += ring * col * (1.0 + uTreble * 0.6);
  outc += core * coreCol;
  outc += aura * col * 0.6;

  // soft vignette to keep edges dark
  outc *= 1.0 - smoothstep(0.6, 1.1, r);

  frag = vec4(outc, 1.0);
}
`;

export class RadialVisualizer extends Visualizer {
  static id = 'radial';
  static name = 'Radial';
  static desc = 'Circular spectrum + pulsing core';

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
    gl.uniform1f(this.prog.u.uLevel, f.level);
    gl.uniform1f(this.prog.u.uBeatPunch, f.beatPunch);
    gl.uniform1fv(this.prog.u.uSpec, f.spectrum);
    if (this.palette) {
      const flat = new Float32Array(15);
      for (let i = 0; i < 5; i++) { flat[i*3]=this.palette[i][0]; flat[i*3+1]=this.palette[i][1]; flat[i*3+2]=this.palette[i][2]; }
      gl.uniform3fv(this.prog.u.uPal, flat);
    }
    this.r.drawQuad();
  }
}
