// GPU-instanced particles. We render as additive points; per-particle attributes
// are written each frame from CPU (simple, but fine for ~4000 particles on M1).
//
// Particles are spawned on beats, drift outward, fade with age. Color picked from palette.

import { Visualizer } from './base.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;        // -1..1 unit quad
layout(location=1) in vec2 iPos;        // particle pos in NDC
layout(location=2) in vec3 iColor;
layout(location=3) in float iSize;
layout(location=4) in float iAlpha;
uniform vec2 uRes;
out vec2 vUv;
out vec3 vColor;
out float vAlpha;
void main(){
  vUv = aPos;
  vColor = iColor;
  vAlpha = iAlpha;
  vec2 size = vec2(iSize) / uRes * 2.0;
  // correct aspect for screen
  size.x *= 1.0;
  vec2 pos = iPos + aPos * size * 0.5 * vec2(uRes.y/uRes.x, 1.0) * 2.0;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vAlpha;
out vec4 frag;
void main(){
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 2.0) * vAlpha;
  frag = vec4(vColor * a, a);
}
`;

const VS_BG = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }
`;
const FS_BG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uPal[5];
uniform float uLevel;
uniform float uSection;
out vec4 frag;
void main(){
  vec2 uv = vUv;
  vec3 c = mix(uPal[4]*0.10, uPal[3]*0.18, smoothstep(0.0, 0.7, length(uv-0.5)));
  c += 0.04 * uPal[0] * uSection;
  c += 0.02 * uPal[1] * uLevel;
  frag = vec4(c, 1.0);
}
`;

const MAX_PARTICLES = 4000;

export class ParticlesVisualizer extends Visualizer {
  static id = 'particles';
  static name = 'Particles';
  static desc = 'Beat-spawned glowing dust';

  constructor(r) {
    super(r);
    const gl = this.gl;
    this.prog = r.buildProgram(VS, FS);
    this.bgProg = r.buildProgram(VS_BG, FS_BG);

    // particle CPU buffers
    this.px = new Float32Array(MAX_PARTICLES);
    this.py = new Float32Array(MAX_PARTICLES);
    this.vx = new Float32Array(MAX_PARTICLES);
    this.vy = new Float32Array(MAX_PARTICLES);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.cursor = 0;

    // GPU instance buffer: pos2, col3, size, alpha = 7 floats
    this.instData = new Float32Array(MAX_PARTICLES * 7);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // unit quad (two triangles)
    const quad = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instData, gl.DYNAMIC_DRAW);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 20);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    this.lastT = 0;
    this.spawnAccum = 0;
  }

  spawn(n, palette, beatPunch) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      // start near center with random direction, biased outward
      const a = Math.random() * Math.PI * 2;
      const r0 = 0.05 + Math.random() * 0.05;
      this.px[i] = Math.cos(a) * r0;
      this.py[i] = Math.sin(a) * r0;
      const sp = 0.4 + Math.random() * 0.8 + beatPunch * 1.2;
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp;
      const ml = 1.2 + Math.random() * 1.8;
      this.maxLife[i] = ml;
      this.life[i] = ml;
      const ci = Math.floor(Math.random() * palette.length);
      this.col[i*3] = palette[ci][0];
      this.col[i*3+1] = palette[ci][1];
      this.col[i*3+2] = palette[ci][2];
      this.size[i] = (8 + Math.random() * 18) * (1 + beatPunch * 0.6);
    }
  }

  render(f, t) {
    const gl = this.gl;
    const dt = Math.min(0.05, t - (this.lastT || t));
    this.lastT = t;

    // background
    gl.useProgram(this.bgProg.program);
    if (this.palette) {
      const fl = new Float32Array(15);
      for (let i = 0; i < 5; i++) { fl[i*3]=this.palette[i][0]; fl[i*3+1]=this.palette[i][1]; fl[i*3+2]=this.palette[i][2]; }
      gl.uniform3fv(this.bgProg.u.uPal, fl);
    }
    gl.uniform1f(this.bgProg.u.uLevel, f.level);
    gl.uniform1f(this.bgProg.u.uSection, f.sectionPunch);
    this.r.drawQuad();

    // spawn budget
    const baseRate = 80 + f.level * 600;
    this.spawnAccum += baseRate * dt;
    let n = Math.floor(this.spawnAccum);
    this.spawnAccum -= n;
    if (f.beatPunch > 0.5) n += 80;
    if (this.palette) this.spawn(n, this.palette, f.beatPunch);

    // step
    let writeIdx = 0;
    const dest = this.instData;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      // physics: drift + drag, beat punch boosts
      const drag = Math.exp(-dt * 0.6);
      this.vx[i] *= drag; this.vy[i] *= drag;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      const a = this.life[i] / this.maxLife[i];
      const alpha = a * a * (0.6 + f.treble * 0.4);
      // pack
      dest[writeIdx*7] = this.px[i];
      dest[writeIdx*7+1] = this.py[i];
      dest[writeIdx*7+2] = this.col[i*3];
      dest[writeIdx*7+3] = this.col[i*3+1];
      dest[writeIdx*7+4] = this.col[i*3+2];
      dest[writeIdx*7+5] = this.size[i] * a;
      dest[writeIdx*7+6] = alpha;
      writeIdx++;
    }
    if (writeIdx === 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dest.subarray(0, writeIdx * 7));

    gl.useProgram(this.prog.program);
    gl.uniform2f(this.prog.u.uRes, this.r.width, this.r.height);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, writeIdx);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
