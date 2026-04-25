// Base visualizer interface.
//
// Each visualizer renders into the renderer's "scene" FBO. Post-FX is applied
// by the renderer afterwards. The renderer's helpers buildProgram/drawQuad are
// available; visualizers can also use raw gl for custom geometry.

export class Visualizer {
  static id = 'base';
  static name = 'Base';
  static desc = '';

  constructor(renderer) {
    this.r = renderer;
    this.gl = renderer.gl;
  }

  // Called when the user switches to this visualizer.
  enter() {}
  // Called when switching away.
  leave() {}
  // Called when palette updates.
  setPalette(p) { this.palette = p; }

  // Per-frame. Must draw into the currently bound FBO (scene).
  render(features, t) {} // eslint-disable-line no-unused-vars
}

export const VS_QUAD = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Common GLSL helpers visualizers can paste into their fragment shaders.
export const GLSL_HELPERS = `
vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f);
  return mix( mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
              mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
`;
