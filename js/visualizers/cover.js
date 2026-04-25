// Album cover warp: takes the current track's cover art, splashes it in the center
// with displacement + chromatic ring + radial bloom.
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
uniform float uHasCover;
uniform sampler2D uCover;
uniform vec3 uPal[5];
out vec4 frag;

${GLSL_HELPERS}

void main(){
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x/uRes.y, 1.0);
  float r = length(p);
  float ang = atan(p.y, p.x);

  // background: blurred cover via multiple sample mip-ish (by widening sample radius)
  vec3 bg = vec3(0.0);
  if (uHasCover > 0.5) {
    // big radial "bokeh"
    float steps = 6.0;
    for (float i = 0.0; i < 6.0; i++) {
      float t = (i+0.5)/steps;
      vec2 dir = vec2(cos(t*6.28), sin(t*6.28));
      bg += texture(uCover, vec2(0.5) + dir * 0.3).rgb;
    }
    bg /= 6.0;
    bg *= 0.45; // dim background
  } else {
    bg = mix(uPal[4]*0.10, uPal[3]*0.18, smoothstep(0.0, 0.7, r));
  }

  vec3 col = bg;

  // Cover disk in center, with sinusoidal displacement on bass/beat.
  if (uHasCover > 0.5) {
    float diskR = 0.30 + uBeatPunch * 0.02;
    if (r < diskR + 0.02) {
      // sample uv, but warped
      vec2 cuv = (uv - 0.5);
      cuv *= 1.0 / (diskR * 2.0);
      // bass distortion
      float warp = sin(cuv.x*8.0 + uTime*1.2) * 0.02 * uBass + cos(cuv.y*7.0 - uTime*0.9) * 0.02 * uMid;
      cuv += vec2(warp);
      cuv = cuv * 0.5 + 0.5;
      vec3 c = texture(uCover, clamp(cuv, vec2(0.005), vec2(0.995))).rgb;
      // chromatic ring on edges
      float edge = smoothstep(diskR, diskR - 0.02, r);
      col = mix(col, c, edge);
      // glow ring on beat
      float ring = exp(-pow((r - diskR) * 30.0, 2.0));
      col += uPal[0] * ring * (uBeatPunch * 0.8 + uTreble * 0.3);
    }
  }

  // Energy ripples emanating from center on each beat
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float speed = 0.6 + 0.1 * fi;
    float t = mod(uTime * speed - fi * 0.25, 2.5);
    float wr = t * 0.35;
    float w = exp(-pow((r - wr) * 25.0, 2.0)) * (0.5 + uMid * 0.5);
    col += uPal[1 + i % 4] * w * 0.4 * (1.0 - smoothstep(2.0, 2.5, t));
  }

  // vignette
  col *= 1.0 - smoothstep(0.65, 1.05, r);
  frag = vec4(col, 1.0);
}
`;

export class CoverVisualizer extends Visualizer {
  static id = 'cover';
  static name = 'Cover Warp';
  static desc = 'Album art splash + ripples';

  constructor(r) {
    super(r);
    this.prog = r.buildProgram(VS_QUAD, FS);
    this.gl = r.gl;
    this.tex = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex);
    // 1x1 placeholder
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.hasCover = 0;
  }

  setCoverImage(img) {
    if (!img) { this.hasCover = 0; return; }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    this.hasCover = 1;
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
    gl.uniform1f(this.prog.u.uHasCover, this.hasCover);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.prog.u.uCover, 0);
    if (this.palette) {
      const fl = new Float32Array(15);
      for (let i = 0; i < 5; i++) { fl[i*3]=this.palette[i][0]; fl[i*3+1]=this.palette[i][1]; fl[i*3+2]=this.palette[i][2]; }
      gl.uniform3fv(this.prog.u.uPal, fl);
    }
    this.r.drawQuad();
  }
}
