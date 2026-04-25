// WebGL2 renderer + post-processing chain.
//
//   scene FBO (RGBA16F)
//     │
//     ├── bloom (down/up sample + threshold + blur)  ──┐
//     │                                                ▼
//     └─→ trails accumulator (RGBA16F, ping-pong) ──→ composite (chromatic + grain) ──→ canvas

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, alpha: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      console.warn('EXT_color_buffer_float missing; falling back to RGBA8 internal format');
      this.hdrFmt = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    } else {
      this.hdrFmt = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    }

    this.width = 0; this.height = 0; this.dpr = 1;
    this.fbos = {};
    this.programs = {};
    this.quadVAO = this._makeFullscreenQuad();
    this._initPostPrograms();
    this._resize();
  }

  // -------- public --------
  beginFrame() {
    if (this._needResize()) this._resize();
    this.bindFBO('scene');
    this.gl.viewport(0, 0, this.width, this.height);
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  endFrame(opts = {}) {
    const { bloom = true, bloomAmount = 0.8, chroma = false, grain = false,
            trails = false, trailAmount = 0.85, time = 0 } = opts;

    const gl = this.gl;
    let inputTex = this.fbos.scene.tex;

    // Bloom
    if (bloom) {
      this._runBloom(inputTex, bloomAmount);
      inputTex = this._composeWithBloom(inputTex, bloomAmount);
    }

    // Trails (motion accumulator)
    if (trails) {
      // out = mix(prevAccum, current, 1 - trailAmount)
      this._runTrails(inputTex, trailAmount);
      inputTex = this.fbos.trailA.tex;
      // swap so next frame reads from trailA
      [this.fbos.trailA, this.fbos.trailB] = [this.fbos.trailB, this.fbos.trailA];
    }

    // Composite to screen with chromatic + grain
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    const p = this.programs.composite;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(p.u.tex, 0);
    gl.uniform1f(p.u.chroma, chroma ? 1 : 0);
    gl.uniform1f(p.u.grain, grain ? 1 : 0);
    gl.uniform2f(p.u.res, this.width, this.height);
    gl.uniform1f(p.u.time, time);
    this._drawQuad();
  }

  // -------- internals --------
  _needResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    return w !== this.width || h !== this.height || dpr !== this.dpr;
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.canvas.width = w; this.canvas.height = h;
    this.width = w; this.height = h; this.dpr = dpr;

    this._allocFBO('scene', w, h);
    this._allocFBO('trailA', w, h);
    this._allocFBO('trailB', w, h);
    // Bloom mips at progressively halved res, 5 levels.
    for (let i = 0; i < 5; i++) {
      const mw = Math.max(1, Math.floor(w / Math.pow(2, i + 1)));
      const mh = Math.max(1, Math.floor(h / Math.pow(2, i + 1)));
      this._allocFBO('bloomDown' + i, mw, mh);
      this._allocFBO('bloomUp' + i, mw, mh);
    }
    this._allocFBO('composedBloom', w, h);
    this._allocFBO('bloomOut', w, h);
  }

  _allocFBO(name, w, h) {
    const gl = this.gl;
    let entry = this.fbos[name];
    if (!entry) {
      entry = { fbo: gl.createFramebuffer(), tex: gl.createTexture(), w: 0, h: 0 };
      this.fbos[name] = entry;
    }
    if (entry.w === w && entry.h === h) return entry;
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.hdrFmt.internal, w, h, 0, this.hdrFmt.format, this.hdrFmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.tex, 0);
    entry.w = w; entry.h = h;
    return entry;
  }

  bindFBO(name) {
    const gl = this.gl;
    const e = this.fbos[name];
    gl.bindFramebuffer(gl.FRAMEBUFFER, e.fbo);
    gl.viewport(0, 0, e.w, e.h);
  }

  _makeFullscreenQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }
  _drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  // -------- shader helpers (used by visualizers too) --------
  buildProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error('Program link failed: ' + log);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { program: p, u };
  }
  drawQuad() { this._drawQuad(); }

  _initPostPrograms() {
    const gl = this.gl;
    const vsQuad = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 aPos;
      out vec2 vUv;
      void main(){ vUv = aPos*0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
    `;
    const fsThreshold = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D tex;
      uniform float threshold;
      out vec4 frag;
      void main(){
        vec3 c = texture(tex, vUv).rgb;
        float lum = dot(c, vec3(0.299,0.587,0.114));
        float k = max(lum - threshold, 0.0);
        frag = vec4(c * k / max(lum, 1e-4), 1.0);
      }
    `;
    const fsBlur = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D tex;
      uniform vec2 dir;
      uniform vec2 res;
      out vec4 frag;
      // 9-tap separable
      void main(){
        vec2 px = dir / res;
        vec3 c = vec3(0.0);
        c += texture(tex, vUv - 4.0*px).rgb * 0.05;
        c += texture(tex, vUv - 3.0*px).rgb * 0.09;
        c += texture(tex, vUv - 2.0*px).rgb * 0.12;
        c += texture(tex, vUv - 1.0*px).rgb * 0.15;
        c += texture(tex, vUv          ).rgb * 0.18;
        c += texture(tex, vUv + 1.0*px).rgb * 0.15;
        c += texture(tex, vUv + 2.0*px).rgb * 0.12;
        c += texture(tex, vUv + 3.0*px).rgb * 0.09;
        c += texture(tex, vUv + 4.0*px).rgb * 0.05;
        frag = vec4(c, 1.0);
      }
    `;
    const fsComposeBloom = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D scene;
      uniform sampler2D bloom;
      uniform float amount;
      out vec4 frag;
      void main(){
        vec3 s = texture(scene, vUv).rgb;
        vec3 b = texture(bloom, vUv).rgb;
        frag = vec4(s + b * amount, 1.0);
      }
    `;
    // Additive-only pass: outputs bloom * amount, no scene sampler.
    // Used during bloom upsample where the destination FBO equals the previous compose,
    // so we must not also bind it as a sampler (feedback loop).
    const fsAddBloom = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D bloom;
      uniform float amount;
      out vec4 frag;
      void main(){
        frag = vec4(texture(bloom, vUv).rgb * amount, 1.0);
      }
    `;
    const fsTrails = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D current;
      uniform sampler2D prev;
      uniform float trail;
      out vec4 frag;
      void main(){
        vec3 cur = texture(current, vUv).rgb;
        vec3 pr = texture(prev, vUv).rgb;
        vec3 c = max(cur, pr * trail);
        frag = vec4(c, 1.0);
      }
    `;
    const fsComposite = `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D tex;
      uniform float chroma;
      uniform float grain;
      uniform vec2 res;
      uniform float time;
      out vec4 frag;
      float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 uv = vUv;
        vec3 col;
        if (chroma > 0.5) {
          vec2 dir = uv - 0.5;
          float d = length(dir);
          vec2 off = dir * (0.004 + d * 0.01);
          float r = texture(tex, uv + off).r;
          float g = texture(tex, uv).g;
          float b = texture(tex, uv - off).b;
          col = vec3(r, g, b);
        } else {
          col = texture(tex, uv).rgb;
        }
        if (grain > 0.5) {
          float n = rand(uv * res + time) - 0.5;
          col += n * 0.04;
        }
        // simple ACES-ish tonemap
        col = (col * (2.51*col + 0.03)) / (col * (2.43*col + 0.59) + 0.14);
        frag = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `;
    this.programs.threshold = this.buildProgram(vsQuad, fsThreshold);
    this.programs.blur = this.buildProgram(vsQuad, fsBlur);
    this.programs.composeBloom = this.buildProgram(vsQuad, fsComposeBloom);
    this.programs.addBloom = this.buildProgram(vsQuad, fsAddBloom);
    this.programs.trails = this.buildProgram(vsQuad, fsTrails);
    this.programs.composite = this.buildProgram(vsQuad, fsComposite);
  }

  _runBloom(srcTex, amount) {
    const gl = this.gl;
    // Threshold pass into bloomDown0
    let downs = [];
    for (let i = 0; i < 5; i++) downs.push(this.fbos['bloomDown' + i]);
    let ups = [];
    for (let i = 0; i < 5; i++) ups.push(this.fbos['bloomUp' + i]);

    // Threshold src → bloomDown0
    gl.bindFramebuffer(gl.FRAMEBUFFER, downs[0].fbo);
    gl.viewport(0, 0, downs[0].w, downs[0].h);
    let p = this.programs.threshold;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(p.u.tex, 0); gl.uniform1f(p.u.threshold, 0.55);
    this._drawQuad();

    // Blur each level horizontally + vertically (each downsamples implicitly via lower-res FBO)
    p = this.programs.blur;
    gl.useProgram(p.program);
    let prev = downs[0];
    for (let i = 1; i < 5; i++) {
      const dst = downs[i];
      // horizontal from prev
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(p.u.tex, 0);
      gl.uniform2f(p.u.dir, 1, 0);
      gl.uniform2f(p.u.res, dst.w, dst.h);
      this._drawQuad();
      // vertical in place (approx, sampling itself OK because src!=dst frame slot doesn't cycle here — use ups[i] as scratch)
      const scratch = ups[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
      gl.viewport(0, 0, scratch.w, scratch.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.uniform1i(p.u.tex, 0);
      gl.uniform2f(p.u.dir, 0, 1);
      gl.uniform2f(p.u.res, scratch.w, scratch.h);
      this._drawQuad();
      // copy scratch → dst by another horizontal pass with dir=0 (cheap "copy"): just use the scratch as the new prev.
      prev = scratch;
    }
    // Up-sample by additive sampling each level, ascending.
    // Result lands in composedBloom.
    const composed = this.fbos.composedBloom;
    gl.bindFramebuffer(gl.FRAMEBUFFER, composed.fbo);
    gl.viewport(0, 0, composed.w, composed.h);
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    const cp = this.programs.addBloom;
    gl.useProgram(cp.program);
    gl.uniform1f(cp.u.amount, amount * 0.5);
    // ups[0] is never written; iterate populated levels only.
    for (let i = 4; i >= 1; i--) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ups[i].tex);
      gl.uniform1i(cp.u.bloom, 0);
      this._drawQuad();
    }
    gl.disable(gl.BLEND);
  }

  _composeWithBloom(sceneTex, amount) {
    const gl = this.gl;
    // Dedicated FBO so we don't clobber the trail ping-pong buffers.
    const out = this.fbos.bloomOut;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
    gl.disable(gl.BLEND);
    const p = this.programs.composeBloom;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(p.u.scene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.fbos.composedBloom.tex);
    gl.uniform1i(p.u.bloom, 1);
    gl.uniform1f(p.u.amount, amount);
    this._drawQuad();
    return out.tex;
  }

  _runTrails(currentTex, amount) {
    const gl = this.gl;
    const out = this.fbos.trailA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, out.w, out.h);
    gl.disable(gl.BLEND);
    const p = this.programs.trails;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, currentTex);
    gl.uniform1i(p.u.current, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.fbos.trailB.tex);
    gl.uniform1i(p.u.prev, 1);
    gl.uniform1f(p.u.trail, amount);
    this._drawQuad();
  }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => String(i+1).padStart(3,' ') + ': ' + l).join('\n');
    throw new Error('Shader compile failed:\n' + log + '\n' + numbered);
  }
  return sh;
}
