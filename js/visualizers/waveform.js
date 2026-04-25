// Oscilloscope: stacked waveforms with chromatic offset, palette tint.
import { Visualizer, VS_QUAD, GLSL_HELPERS } from './base.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uTreble;
uniform float uBeatPunch;
uniform float uWave[256];
uniform vec3 uPal[5];
out vec4 frag;

${GLSL_HELPERS}

float waveAt(float x){
  float idx = clamp(x, 0.0, 1.0) * 255.0;
  int i = int(idx);
  float fr = fract(idx);
  return mix(uWave[i], uWave[min(i+1, 255)], fr);
}

float lineGlow(float y, float yc, float thick){
  return smoothstep(thick, 0.0, abs(y - yc));
}

void main(){
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  // dark background with subtle grid breath
  vec3 bg = mix(uPal[4]*0.06, uPal[3]*0.10, smoothstep(0.0, 0.6, length(uv-0.5)));

  vec3 outc = bg;
  // Three layered waves, slightly offset in time and color
  for (int k = 0; k < 3; k++) {
    float ko = float(k);
    float xshift = (ko - 1.0) * 0.004 * (1.0 + uBeatPunch);
    float w = waveAt(uv.x + xshift);
    float yc = 0.5 + w * (0.30 + uBass * 0.20);
    float thick = 0.004 + uTreble * 0.004 + uBeatPunch * 0.004;
    float g = lineGlow(uv.y, yc, thick * (1.0 + ko*0.6));
    vec3 col = uPal[k];
    outc += g * col * (1.2 + uTreble * 0.6);
  }
  // soft vertical fade for theatrical look
  float vign = smoothstep(0.0, 0.6, abs(uv.y - 0.5));
  outc *= 1.0 - vign * 0.6;

  frag = vec4(outc, 1.0);
}
`;

export class WaveformVisualizer extends Visualizer {
  static id = 'waveform';
  static name = 'Oscilloscope';
  static desc = 'Triple-traced waveform';

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
    gl.uniform1f(this.prog.u.uTreble, f.treble);
    gl.uniform1f(this.prog.u.uBeatPunch, f.beatPunch);
    gl.uniform1fv(this.prog.u.uWave, f.waveform);
    if (this.palette) {
      const fl = new Float32Array(15);
      for (let i = 0; i < 5; i++) { fl[i*3]=this.palette[i][0]; fl[i*3+1]=this.palette[i][1]; fl[i*3+2]=this.palette[i][2]; }
      gl.uniform3fv(this.prog.u.uPal, fl);
    }
    this.r.drawQuad();
  }
}
