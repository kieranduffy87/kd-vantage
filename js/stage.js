// The 3D stage: renderer, backdrop, floor, lights, camera framing, export.
//
// Rendering has two speeds. While anything moves, a plain frame is drawn. Once
// the view settles, the stage keeps rendering jittered samples — sub-pixel
// camera offsets (anti-aliasing), points across an area light (soft shadows)
// and points across a lens (depth of field) — and averages them into a
// half-float buffer. Export renders the same way at full size.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { Device } from './devices.js';
import { ENVIRONMENTS, buildSet, buildLights, loadHdri, onTextureLoad } from './environments.js';

const D2R = Math.PI / 180;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export const BACKGROUNDS = {
  ink: { label: 'Ink', top: '#0b0c10', horizon: '#1b1d23', glow: '#0339f8', glowK: 0.55, beams: 0 },
  aurora: { label: 'Aurora', top: '#06070b', horizon: '#1a2026', glow: '#21d4b4', glowK: 0.5, beams: 0.7 },
  electric: { label: 'Electric', top: '#020a33', horizon: '#0b1f7a', glow: '#2f5bff', glowK: 0.7, beams: 0.35 },
  paper: { label: 'Paper', top: '#e9e6de', horizon: '#f6f5f1', glow: '#ffffff', glowK: 0.5, beams: 0 },
  dusk: { label: 'Dusk', top: '#140b10', horizon: '#2a1a1c', glow: '#ff7a59', glowK: 0.5, beams: 0.4 },
  studio: { label: 'Studio grey', top: '#3a3c42', horizon: '#5c5f66', glow: '#ffffff', glowK: 0.25, beams: 0 },
};

export const LIGHTS = {
  studio: { label: 'Studio', key: 2.4, fill: 0.9, rim: 0.7, env: 1.0, el: 48, warm: '#ffffff', soft: 3 },
  softbox: { label: 'Softbox', key: 1.5, fill: 1.1, rim: 0.4, env: 1.1, el: 62, warm: '#ffffff', soft: 9 },
  golden: { label: 'Golden', key: 3.0, fill: 0.45, rim: 0.7, env: 0.75, el: 22, warm: '#ffc894', soft: 2 },
  night: { label: 'Night', key: 1.0, fill: 0.2, rim: 2.2, env: 0.7, el: 38, warm: '#b9c8ff', soft: 4 },
};

export const FLOORS = {
  matte: { label: 'Matte', k: 0, lod: 0 },
  satin: { label: 'Satin', k: 0.16, lod: 4.2 },
  gloss: { label: 'Gloss', k: 0.3, lod: 2.2 },
  mirror: { label: 'Mirror', k: 0.55, lod: 0.6 },
};

export const QUALITY = {
  draft: { label: 'Draft', samples: 1 },
  high: { label: 'High', samples: 40 },
  ultra: { label: 'Ultra', samples: 128 },
};

// azimuth / elevation in degrees, framing padding, fov
export const CAMERAS = {
  hero: { label: 'Hero', az: 18, el: 13, fov: 30, pad: 1.08 },
  front: { label: 'Front', az: 0, el: 4, fov: 28, pad: 1.06 },
  three: { label: '¾', az: 38, el: 20, fov: 30, pad: 1.1 },
  top: { label: 'Top', az: 0, el: 72, fov: 30, pad: 1.08 },
  low: { label: 'Low', az: 14, el: 3, fov: 34, pad: 1.05 },
};

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uTop, uHorizon, uGlow;
uniform float uGlowK, uBeams;
uniform vec3 uFwd;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, up));
  // glow: a soft blob behind the subject as seen from the camera, lifted off
  // the horizon so the sky meets the fogged floor in exactly uHorizon
  vec3 f = normalize(vec3(uFwd.x, 0.0, uFwd.z));
  vec3 gd = normalize(f + vec3(0.0, 0.42, 0.0));
  float ang = acos(clamp(dot(d, gd), -1.0, 1.0));
  float lift = smoothstep(0.0, 0.22, d.y);
  float g = exp(-ang * ang * 4.2) * lift;
  vec3 dh = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
  float side = atan(dot(cross(f, dh), vec3(0.0, 1.0, 0.0)), dot(dh, f));
  float beams = pow(0.5 + 0.5 * sin(side * 23.0 + 1.3), 6.0) * lift * exp(-side * side * 7.0) * (1.0 - up * 0.7);
  col += uGlow * (g * uGlowK + beams * uBeams * 0.3);
  // fine noise against banding
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Floor: unlit horizon colour (meets the fogged sky seamlessly) plus an
// optional mirror reflection, blurred through the mip chain, with Fresnel.
const FLOOR_VERT = /* glsl */`
uniform mat4 uTexMat;
varying vec4 vProj;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vProj = uTexMat * wp;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FLOOR_FRAG = /* glsl */`
uniform vec3 uColor;
uniform sampler2D tRefl, tSurf;
uniform float uRefl, uLod, uSurf, uSurfScale;
uniform vec3 uFall; // xz centre, radius
varying vec4 vProj;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec3 col = uColor;
  if (uSurf > 0.5) {
    // desk surface, darkening gently towards the edges of the light
    col = texture2D(tSurf, vWorld.xz / uSurfScale).rgb;
    // a pool of light on the table, falling away into the room
    float dd = length(vWorld.xz - uFall.xy) / uFall.z;
    col *= mix(1.0, 0.28, smoothstep(0.55, 2.6, dd));
  }
  if (uRefl > 0.0) {
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = 0.05 + 0.95 * pow(1.0 - max(v.y, 0.0), 5.0);
    vec2 uv = vProj.xy / vProj.w;
    vec3 r = textureLod(tRefl, uv, uLod).rgb;
    float a = textureLod(tRefl, uv, uLod).a;
    col = mix(col, r, uRefl * (0.45 + 0.55 * fres) * a);
  }
  // fog in linear light and no tone mapping, exactly like the sky shader,
  // so floor and sky meet at the horizon without a visible seam
  #ifdef USE_FOG
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    // three uploads fogColor already sRGB-encoded (its shaders fog after
    // the colour-space conversion), so decode it before mixing in linear
    col = mix(col, sRGBTransferEOTF(vec4(fogColor, 1.0)).rgb, fogF);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const QUAD_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const QUAD_FRAG = 'uniform sampler2D tMap; varying vec2 vUv; void main() { gl_FragColor = texture2D(tMap, vUv); }';
// final look: bloom, vignette, film grain (values are display-encoded already)
const SHOW_FRAG = `
uniform sampler2D tMap, tBloom;
uniform float uBloom, uVignette, uGrain, uAspect, uSeed;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tMap, vUv);
  vec3 col = c.rgb;
  if (uBloom > 0.0) col += texture2D(tBloom, vUv).rgb * uBloom * 1.4;
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float v = smoothstep(0.35, 1.25, length(q) * 1.15);
  col *= 1.0 - v * uVignette * 0.85;
  float n = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += n * uGrain * 0.06;
  gl_FragColor = vec4(col, c.a);
}`;
const BRIGHT_FRAG = `
uniform sampler2D tMap; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(0.62, 1.0, l), 1.0);
}`;
const BLUR_FRAG = `
uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 s = texture2D(tMap, vUv).rgb * 0.227;
  s += (texture2D(tMap, vUv + uDir * 1.385).rgb + texture2D(tMap, vUv - uDir * 1.385).rgb) * 0.316;
  s += (texture2D(tMap, vUv + uDir * 3.231).rgb + texture2D(tMap, vUv - uDir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(s, 1.0);
}`;

// A photo studio for reflections: a dark room with softboxes and strip
// lights. Metal and glass read as "product photography" because they reflect
// these hard-edged panels rather than a blurry room.
const ENV_RIGS = {
  studio: { room: '#24262b', panels: [
    [24, 12, [0, 19, 2], [0, 0, 0], 2.6],
    [20, 10, [0, 9, 20], [0, 6, 0], 0.9],
    [3, 18, [-18, 7, 5], [0, 5, 0], 6.5],
    [3, 18, [18, 7, -5], [0, 5, 0], 4.5],
    [16, 5, [0, 4, 19], [0, 4, 0], 1.0],
    [12, 3, [0, 11, -19], [0, 2, 0], 2.4],
  ] },
  softbox: { room: '#2b2c30', panels: [
    [26, 14, [0, 19, 0], [0, 0, 0], 2.6],
    [10, 18, [-19, 8, 4], [0, 5, 0], 2.4],
    [10, 18, [19, 8, -4], [0, 5, 0], 2.0],
    [22, 8, [0, 5, 19], [0, 4, 0], 1.4],
  ] },
  golden: { room: '#1d1510', panels: [
    [8, 16, [-19, 4, 6], [0, 4, 0], 5.5, '#ffc68a'],
    [14, 6, [0, 19, 0], [0, 0, 0], 1.0, '#ffe2c0'],
    [3, 14, [18, 6, -8], [0, 4, 0], 1.6, '#a9bdff'],
  ] },
  night: { room: '#0b0d16', panels: [
    [2.5, 18, [-17, 7, -8], [0, 4, 0], 5.5, '#8fa7ff'],
    [2.5, 18, [17, 7, -8], [0, 4, 0], 4.0, '#6f8bff'],
    [14, 4, [0, 18, 4], [0, 0, 0], 0.7, '#c9d4ff'],
  ] },
};
function envScene(kind) {
  const R = ENV_RIGS[kind] || ENV_RIGS.studio;
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(42, 26, 42), new THREE.MeshBasicMaterial({ color: R.room, side: THREE.BackSide }));
  room.position.y = 9;
  s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(42, 42), new THREE.MeshBasicMaterial({ color: new THREE.Color(R.room).multiplyScalar(0.6) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.9;
  s.add(floor);
  for (const [w, h, pos, at, k, col = '#ffffff'] of R.panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...at);
    s.add(m);
  }
  return s;
}

export class Stage extends EventTarget {
  constructor(canvas, library) {
    super();
    this.canvas = canvas;
    this.lib = library;
    this.devices = new Map();
    this.dirty = true;
    this.transparent = false;
    this.quality = { samples: QUALITY.high.samples, soft: 0.45, dof: 0, floor: 'matte' };
    this.acc = { n: 0, rt: null, fb: null, w: 0, h: 0 };

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    const s = (this.scene = new THREE.Scene());
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envs = {};
    this._setEnv('studio');

    // backdrop
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
          uGlowK: { value: 0.5 }, uBeams: { value: 0 }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
        },
      }),
    );
    this.sky.scale.setScalar(4000);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    s.add(this.sky);

    // cyclorama floor with optional reflection
    this.mirrorRT = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.mirrorCam = new THREE.PerspectiveCamera();
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uColor: { value: new THREE.Color() }, tRefl: { value: null }, uRefl: { value: 0 }, uLod: { value: 0 }, uTexMat: { value: new THREE.Matrix4() },
        tSurf: { value: null }, uSurf: { value: 0 }, uSurfScale: { value: 100 }, uFall: { value: new THREE.Vector3(0, 0, 60) },
      }]),
    });
    this.floorMat.uniforms.tRefl.value = this.mirrorRT.texture;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    s.add(this.floor);
    const pc = document.createElement('canvas');
    pc.width = pc.height = 256;
    const pg = pc.getContext('2d');
    const grd = pg.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    pg.fillStyle = grd;
    pg.fillRect(0, 0, 256, 256);
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(pc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.1,
    }));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.y = 0.02;
    this.pool.renderOrder = -2;
    s.add(this.pool);
    this.shadowOnly = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.shadowOnly.rotation.x = -Math.PI / 2;
    this.shadowOnly.position.y = 0.04;
    this.shadowOnly.receiveShadow = true;
    s.add(this.shadowOnly);
    s.fog = new THREE.Fog(0x000000, 100, 1000);

    // lights
    this.key = new THREE.DirectionalLight(0xffffff, 2.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.035;
    s.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.6);
    this.rim = new THREE.DirectionalLight(0xffffff, 1.2);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.3);
    s.add(this.fill, this.rim, this.hemi);
    // window light: invisible shapes between the key light and the set that
    // only cast shadows (blinds, a window frame, leaves)
    this.gobo = new THREE.Group();
    this.goboKind = 'none';
    s.add(this.gobo);
    // environments: architectural sets with their own lights
    this.envGroup = new THREE.Group();
    s.add(this.envGroup);
    this.envId = 'studio';
    this.envLight = null;
    onTextureLoad(() => { this.dirty = true; });

    // camera
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 3, 9000);
    this.camera.position.set(30, 20, 90);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.maxPolarAngle = 88 * D2R;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 900;
    this.controls.zoomSpeed = 0.7;
    this.controls.addEventListener('change', () => { this.dirty = true; this.dispatchEvent(new Event('camera')); });
    this.controls.addEventListener('start', () => { this._tween = null; this.dispatchEvent(new Event('orbitstart')); });
    this.controls.addEventListener('end', () => this.dispatchEvent(new Event('orbitend')));

    // accumulation plumbing
    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._blend = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: QUAD_FRAG, uniforms: { tMap: { value: null } },
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ConstantAlphaFactor, blendDst: THREE.OneMinusConstantAlphaFactor,
      blendSrcAlpha: THREE.ConstantAlphaFactor, blendDstAlpha: THREE.OneMinusConstantAlphaFactor,
    });
    this._show = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: SHOW_FRAG,
      uniforms: { tMap: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 }, uAspect: { value: 1.7 }, uSeed: { value: 0 } },
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
    });
    const mk = (frag, extra = {}) => new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: frag, uniforms: { tMap: { value: null }, ...extra },
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
    });
    this._bright = mk(BRIGHT_FRAG);
    this._blur = mk(BLUR_FRAG, { uDir: { value: new THREE.Vector2() } });
    this.bloomRT = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.post = { vignette: 0, bloom: 0, grain: 0, haze: 0 };
    this.contactScale = 1;
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._show);
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);

    this.shift = { x: 0, y: 0 };
    this._fitDist = 100;
    this.contactK = 0.6;
  }

  _setEnv(kind) {
    if (!this.envs[kind]) this.envs[kind] = this.pmrem.fromScene(envScene(kind), 0.02).texture;
    this.scene.environment = this.envs[kind];
  }

  setSize(w, h) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._applyShift();
    this.dirty = true;
  }

  setPost(p) {
    Object.assign(this.post, p);
    const u = this._show.uniforms;
    u.uBloom.value = this.post.bloom;
    u.uVignette.value = this.post.vignette;
    u.uGrain.value = this.post.grain;
    if (p.contact != null) {
      this.contactScale = p.contact;
      for (const d of this.devices.values()) d.setContactStrength(this.contactK * this.contactScale);
    }
    this.dirty = true;
  }

  setQuality(q) {
    Object.assign(this.quality, q);
    const F = FLOORS[this.quality.floor] || FLOORS.matte;
    this.floorMat.uniforms.uRefl.value = F.k;
    this.floorMat.uniforms.uLod.value = F.lod;
    this.dirty = true;
  }

  // ---------- document sync ----------
  syncDevices(list) {
    const seen = new Set();
    let changed = false;
    for (const spec of list) {
      seen.add(spec.id);
      let d = this.devices.get(spec.id);
      if (!d) {
        d = new Device(spec, this.lib);
        this.devices.set(spec.id, d);
        this.scene.add(d.root);
        if (d.contact) d.contact.visible = !ENVIRONMENTS[this.envId]?.noGround;
        changed = true;
      } else {
        d.update(spec);
      }
      d.setContactStrength(this.contactK * this.contactScale);
    }
    for (const [id, d] of this.devices) {
      if (!seen.has(id)) {
        this.scene.remove(d.root);
        d._dispose();
        this.devices.delete(id);
        changed = true;
      }
    }
    this._fitShadow();
    this.dirty = true;
    return changed;
  }

  repaintScreens(force = false) {
    for (const d of this.devices.values()) d.paint(force);
    this.dirty = true;
  }

  hasVideo() {
    for (const d of this.devices.values()) if (d.root.visible && d.isVideo()) return true;
    return false;
  }

  setBackground(bg) {
    const u = this.sky.material.uniforms;
    u.uTop.value.set(bg.top);
    u.uHorizon.value.set(bg.horizon);
    u.uGlow.value.set(bg.glow);
    u.uGlowK.value = bg.glowK;
    u.uBeams.value = bg.beams;
    this.floorMat.uniforms.uColor.value.set(bg.horizon);
    this.pool.material.color.set(bg.glow).lerp(new THREE.Color('#ffffff'), 0.5);
    this.pool.material.opacity = new THREE.Color(bg.horizon).getHSL({}).l > 0.5 ? 0.0 : 0.09 + bg.glowK * 0.06;
    this.scene.fog.color.set(bg.horizon);
    this.hemi.groundColor.set(bg.horizon).multiplyScalar(0.6);
    this.dirty = true;
  }

  setLighting(L, dir = 0, shadows = 0.6) {
    const P = LIGHTS[L] || LIGHTS.studio;
    this.light = { P, dir, shadows, name: L };
    this.key.intensity = P.key;
    this.key.color.set(P.warm);
    this.fill.intensity = P.fill;
    this.rim.intensity = P.rim;
    this.rim.color.set(L === 'golden' ? '#9fb6ff' : L === 'night' ? '#6f8bff' : '#ffffff');
    if (this.studio) {
      this._setEnv(L);
      this.scene.environmentIntensity = P.env;
    } else if (this.envLight) this.envLight.shadow.intensity = shadows;
    this.key.shadow.radius = P.soft;
    this.key.shadow.intensity = shadows;
    this.contactK = shadows;
    for (const d of this.devices.values()) d.setContactStrength(shadows * this.contactScale);
    this.shadowOnly.material.opacity = 0.62 * shadows;
    this._placeLights();
    this.dirty = true;
  }

  get studio() { return this.envId === 'studio'; }
  // the light that casts shadows, gets soft-shadow jitter and window patterns
  get shadowLight() { return this.studio ? this.key : this.envLight; }

  setEnvironment(id, o = {}) {
    const key = JSON.stringify([id, o]);
    if (key === this._envKey) return;
    this._envKey = key;
    this.envId = ENVIRONMENTS[id] ? id : 'studio';
    const setKey = JSON.stringify([this.envId, o.floor, o.floorTint, o.wall, o.wallTint]);
    if (!this.setGroup) {
      this.setGroup = new THREE.Group(); this.lightGroup = new THREE.Group();
      this.envGroup.add(this.setGroup, this.lightGroup);
    }
    if (setKey !== this._setKey) { this._setKey = setKey; buildSet(this.setGroup, this.envId, o); }
    const r = buildLights(this.lightGroup, this.envId, o);
    this.envLights = r.lights;
    this.envLight = r.shadowLight;
    const E = r.E;
    const studio = this.studio;
    for (const l of [this.key, this.fill, this.rim, this.hemi]) l.visible = studio;
    // AgX rolls saturated coloured light off towards white instead of
    // clipping it into flat patches; the studio keeps its neutral look
    this.renderer.toneMapping = studio ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = studio ? 1 : (E?.exposure ?? 1) * 1.15;
    if (!studio) {
      const u = this.sky.material.uniforms;
      u.uTop.value.set(E.bg); u.uHorizon.value.set(E.bg); u.uGlowK.value = 0; u.uBeams.value = 0;
      this.scene.fog.color.set(E.bg);
      const want = E.hdri;
      loadHdri(want, this.pmrem).then((env) => {
        if (env && this.envId === id) { this.scene.environment = env; this.scene.environmentIntensity = E.envK; this.dirty = true; }
      });
      if (this.envLight) this.envLight.shadow.intensity = this.light?.shadows ?? 0.7;
    } else if (this.light) {
      this._setEnv(this.light.name || 'studio');
      this.scene.environmentIntensity = this.light.P.env;
    }
    for (const d of this.devices.values()) if (d.contact) d.contact.visible = !(E && E.noGround);
    const g = o.gobo ?? (E?.gobo || 'none');
    this.goboKind = null;
    this.setGobo(g);
    if (this.envLight) this.envLight.shadow.intensity = this.light?.shadows ?? 0.7;
    this.dirty = true;
  }

  setGobo(kind = 'none') {
    if (kind === this.goboKind) return;
    this.goboKind = kind;
    for (const c of [...this.gobo.children]) { c.geometry.dispose(); this.gobo.remove(c); }
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    const add = (geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.frustumCulled = false; this.gobo.add(m); return m; };
    if (kind === 'blinds') {
      for (let i = -14; i <= 14; i++) {
        const m = add(new THREE.PlaneGeometry(2.4, 0.03));
        m.position.y = i * 0.062;
      }
      this.gobo.children.forEach((m) => { m.rotation.z = 0.22; });
    } else if (kind === 'window') {
      const sh = new THREE.Shape();
      sh.moveTo(-2, -2); sh.lineTo(2, -2); sh.lineTo(2, 2); sh.lineTo(-2, 2); sh.closePath();
      for (const [x, y] of [[-0.13, 0.17], [0.13, 0.17], [-0.13, -0.17], [0.13, -0.17]]) {
        const hp = new THREE.Path();
        hp.moveTo(x - 0.115, y - 0.155); hp.lineTo(x + 0.115, y - 0.155); hp.lineTo(x + 0.115, y + 0.155); hp.lineTo(x - 0.115, y + 0.155); hp.closePath();
        sh.holes.push(hp);
      }
      const m = add(new THREE.ShapeGeometry(sh));
      m.rotation.z = -0.12;
      m.position.set(0.06, 0.08, 0);
    } else if (kind === 'leaves') {
      let seed = 11;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 70; i++) {
        const L = 0.07 + r() * 0.13, W = L * (0.32 + r() * 0.2);
        const sh = new THREE.Shape();
        sh.moveTo(0, -L / 2);
        sh.quadraticCurveTo(W, -L * 0.1, 0, L / 2);
        sh.quadraticCurveTo(-W, -L * 0.1, 0, -L / 2);
        const m = add(new THREE.ShapeGeometry(sh, 8));
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.75;
        m.position.set(Math.cos(a) * d + 0.25, Math.sin(a) * d + 0.2, (r() - 0.5) * 0.05);
        m.rotation.z = r() * Math.PI * 2;
      }
    }
    this._placeLights();
  }

  _placeGobo() {
    const SL = this.shadowLight;
    if (this.goboKind === 'none' || !SL) return;
    const box = this._bounds();
    let c = box.getCenter(new THREE.Vector3());
    c.y = 2; // aim the pattern at the table, where the set stands
    if (!this.studio) c = SL.target.position.clone(); // or wherever the set's key is aimed
    const R = Math.max(20, box.getSize(new THREE.Vector3()).length());
    const dir = SL.position.clone().sub(c).normalize();
    this.gobo.position.copy(c).addScaledVector(dir, R * 0.42);
    this.gobo.lookAt(SL.position);
    this.gobo.scale.setScalar(R * 0.95);
  }

  _bounds() {
    const box = new THREE.Box3();
    for (const d of this.devices.values()) if (d.root.visible) box.expandByObject(d.root);
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 15, 10));
    return box;
  }

  _placeLights() {
    if (!this.light) return;
    const box = this._bounds();
    const c = box.getCenter(new THREE.Vector3());
    const R = Math.max(20, box.getSize(new THREE.Vector3()).length());
    this._lightR = R;
    const az = (110 + this.light.dir * 260) * D2R, el = (this.elOverride ?? this.light.P.el) * D2R;
    const p = (a, e, k = 1) => new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(R * 2 * k).add(c);
    this.key.position.copy(p(az, el));
    this.key.target.position.copy(c);
    this.fill.position.copy(p(az + Math.PI * 0.85, 0.45));
    this.rim.position.copy(p(az - Math.PI * 0.7, 0.5));
    // the softboxes turn with the key light
    this.scene.environmentRotation.set(0, az - 110 * D2R, 0);
    this._placeGobo();
    this._fitShadow();
    this.gobo.visible = true;
  }

  _fitShadow() {
    const box = this._bounds();
    const sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    const span = Math.max(sz.x, sz.z) * 3 + 60;
    this.floorMat.uniforms.uFall.value.set(ctr.x, ctr.z, Math.max(30, Math.max(sz.x, sz.z) * 0.75));
    this.shadowOnly.scale.set(span * 2, span * 2, 1);
    this.shadowOnly.position.x = ctr.x; this.shadowOnly.position.z = ctr.z;
    this.pool.scale.set(span * 0.9, span * 0.6, 1);
    this.pool.position.x = ctr.x; this.pool.position.z = ctr.z - sz.z * 0.2;
    const R = box.getSize(new THREE.Vector3()).length() * 0.9 + 10;
    const cam = this.key.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.near = 1; cam.far = R * 8;
    cam.updateProjectionMatrix();
  }

  // ---------- camera ----------
  presetPose(name, flat = false) {
    const P = CAMERAS[name] || CAMERAS.hero;
    const box = this._bounds();
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = box.getCenter(new THREE.Vector3());
    const fov = flat ? 8 : P.fov;
    const aspect = this.camera.aspect || 16 / 9;
    const vf = fov * D2R;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const size = box.getSize(new THREE.Vector3());
    const az = (flat ? 0 : P.az) * D2R, el = (flat ? 2 : P.el) * D2R;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const up = new THREE.Vector3().crossVectors(right, dir).negate().normalize();
    // centre the silhouette as seen from this direction, not the 3D box:
    // a tall plant at one end should not push everything else to the bottom
    let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const a = p.dot(right), b = p.dot(up);
      r0 = Math.min(r0, a); r1 = Math.max(r1, a); u0 = Math.min(u0, b); u1 = Math.max(u1, b);
    }
    center.addScaledVector(right, (r0 + r1) / 2).addScaledVector(up, (u0 + u1) / 2);
    const w = (r1 - r0) / 2, h = (u1 - u0) / 2;
    const depthPad = Math.max(size.x, size.z) * 0.25;
    let dist = Math.max(w / Math.tan(hf / 2), h / Math.tan(vf / 2)) * P.pad + depthPad;
    // the estimate above is orthographic; near corners project larger, so
    // check with a real camera and back off until everything is in frame
    const probe = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1e5);
    for (let it = 0; it < 4; it++) {
      probe.position.copy(dir).multiplyScalar(dist).add(center);
      probe.lookAt(center);
      probe.updateMatrixWorld();
      let m = 0;
      for (let i = 0; i < 8; i++) {
        const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(probe);
        m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
      }
      const want = 0.9 / P.pad;
      if (m <= want) break;
      dist *= m / want;
    }
    this._fitDist = dist;
    return { pos: dir.clone().multiplyScalar(dist).add(center), target: center, fov, radius: sphere.radius };
  }

  goTo(pose, ms = 700) {
    const cam = this.camera;
    const from = { pos: cam.position.clone(), target: this.controls.target.clone(), fov: cam.fov };
    if (ms <= 0) { this._tween = null; this._setCam(pose.pos, pose.target, pose.fov); return; }
    const t0 = performance.now();
    this._tween = (now) => {
      const k = ease(Math.min(1, (now - t0) / ms));
      const tgt = from.target.clone().lerp(pose.target, k);
      const a = from.pos.clone().sub(from.target), b = pose.pos.clone().sub(pose.target);
      const la = a.length(), lb = b.length();
      const dir = a.normalize().lerp(b.normalize(), k).normalize();
      this._setCam(dir.multiplyScalar(la + (lb - la) * k).add(tgt), tgt, from.fov + (pose.fov - from.fov) * k);
      if (k >= 1) { this._tween = null; this.dispatchEvent(new Event('camera')); }
    };
  }

  _setCam(pos, target, fov) {
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    if (fov && Math.abs(this.camera.fov - fov) > 1e-4) { this.camera.fov = fov; this._applyShift(); }
    this.camera.lookAt(target);
    this.dirty = true;
  }

  getCam() {
    const c = this.camera, t = this.controls.target;
    return { pos: c.position.toArray().map((v) => +v.toFixed(3)), target: t.toArray().map((v) => +v.toFixed(3)), fov: c.fov };
  }

  setCam(cam) {
    if (!cam?.pos) return;
    this._setCam(new THREE.Vector3(...cam.pos), new THREE.Vector3(...cam.target), cam.fov);
    this.controls.update();
  }

  zoomBy(k) {
    const t = this.controls.target, c = this.camera.position;
    const off = c.clone().sub(t).multiplyScalar(k);
    const len = THREE.MathUtils.clamp(off.length(), this.controls.minDistance, this.controls.maxDistance);
    off.setLength(len);
    this.goTo({ pos: t.clone().add(off), target: t.clone(), fov: this.camera.fov }, 260);
  }

  zoomPct() {
    const d = this.camera.position.distanceTo(this.controls.target);
    return Math.round((this._fitDist / d) * 100);
  }

  setShift(x, y) { this.shift = { x, y }; this._applyShift(); this.dirty = true; }

  _applyShift(jx = 0, jy = 0) {
    const c = this.camera;
    const w = this.width || 1600, h = this.height || 900;
    c.aspect = w / h;
    if (this.shift.x || this.shift.y || jx || jy) c.setViewOffset(w, h, -this.shift.x * w + jx, this.shift.y * h + jy, w, h);
    else c.clearViewOffset();
    c.updateProjectionMatrix();
  }

  // ---------- picking ----------
  pick(ndc) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const roots = [...this.devices.values()].filter((d) => d.root.visible).map((d) => d.root);
    const hits = ray.intersectObjects(roots, true).filter((h) => !h.object.userData.contact);
    return hits[0]?.object.userData.device || null;
  }

  floorPoint(ndc, y = 0) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
  }

  rectOf(id) {
    const d = this.devices.get(id);
    if (!d || !d.root.visible) return null;
    const box = new THREE.Box3();
    d.root.updateMatrixWorld(true);
    d.root.traverse((o) => { if (o.isMesh && !o.userData.contact) box.expandByObject(o); });
    if (box.isEmpty()) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.width, y = (-v.y * 0.5 + 0.5) * this.height;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- frame ----------
  tick(now) {
    if (this._tween) this._tween(now);
    if (this.controls.update()) this.dirty = true;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.sky.material.uniforms.uFwd.value.copy(fwd);
    const d = this.camera.position.distanceTo(this.controls.target);
    const hz = this.post.haze || 0;
    this.scene.fog.near = d * (this.studio ? 1.6 - hz * 1.1 : 3.5 - hz * 3.1);
    this.scene.fog.far = d * (this.studio ? 6 - hz * 3 : 12 - hz * 9.5);
    this.sky.position.copy(this.camera.position);
  }

  // Mirror pass for the glossy floor: the scene seen from the camera
  // reflected through y = 0, projected back onto the floor.
  _renderMirror() {
    const r = this.renderer, cam = this.camera, v = this.mirrorCam;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    const mw = Math.max(4, Math.round(buf.x / 2)), mh = Math.max(4, Math.round(buf.y / 2));
    if (this.mirrorRT.width !== mw || this.mirrorRT.height !== mh) this.mirrorRT.setSize(mw, mh);
    const t = this.controls.target;
    v.fov = Math.min(150, cam.fov * 1.35);
    v.aspect = cam.aspect;
    v.near = cam.near; v.far = cam.far;
    v.position.set(cam.position.x, -cam.position.y, cam.position.z);
    v.up.set(0, 1, 0);
    v.lookAt(t.x, -t.y, t.z);
    v.updateProjectionMatrix();
    v.updateMatrixWorld();
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.floorMat.uniforms.uTexMat.value.copy(bias).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    const hide = [this.floor, this.shadowOnly, this.pool, this.sky];
    for (const d of this.devices.values()) if (d.contact) hide.push(d.contact);
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    r.setRenderTarget(this.mirrorRT);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, v);
    r.setRenderTarget(null);
    hide.forEach((o, i) => { o.visible = was[i]; });
  }

  _renderScene() {
    const studio = this.studio;
    this.sky.visible = !this.transparent;
    this.floor.visible = !this.transparent && studio;
    this.pool.visible = !this.transparent && studio;
    this.shadowOnly.visible = studio;
    if (studio && !this.transparent && this.floorMat.uniforms.uRefl.value > 0) this._renderMirror();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, this.camera);
  }

  _ensureAcc() {
    const c = this.renderer.domElement, a = this.acc;
    if (a.w === c.width && a.h === c.height && a.rt) return;
    a.rt?.dispose(); a.fb?.dispose();
    a.rt = new THREE.WebGLRenderTarget(c.width, c.height, { type: THREE.HalfFloatType, depthBuffer: false });
    a.fb = new THREE.FramebufferTexture(c.width, c.height);
    a.w = c.width; a.h = c.height;
  }

  // One jittered sample, blended into the running average.
  _accumulate(i) {
    const cam = this.camera, q = this.quality;
    const SL = this.shadowLight;
    const keep = { pos: cam.position.clone(), key: SL ? SL.position.clone() : null };
    if (i > 0) {
      const pr = this.renderer.domElement.width / (this.width || 1);
      this._applyShift((halton(i, 2) - 0.5) / pr, (halton(i, 3) - 0.5) / pr);
      const t = this.controls.target;
      const fwd = t.clone().sub(cam.position).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd);
      if (q.dof > 0) {
        const a = halton(i, 5) * Math.PI * 2, rr = Math.sqrt(halton(i, 7)) * q.dof * cam.position.distanceTo(t) * 0.035;
        cam.position.addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr);
        cam.lookAt(t);
      }
      if (q.soft > 0 && SL) {
        const L = SL.position.clone().sub(SL.target.position);
        const lr = new THREE.Vector3().crossVectors(L, new THREE.Vector3(0, 1, 0)).normalize();
        const lu = new THREE.Vector3().crossVectors(lr, L).normalize();
        // window light is sunlight: a small, hard source, or the pattern blurs away
        const k = this.goboKind !== 'none' ? 0.035 : 0.22;
        const a = halton(i, 11) * Math.PI * 2, rr = Math.sqrt(halton(i, 13)) * q.soft * L.length() * k;
        SL.position.addScaledVector(lr, Math.cos(a) * rr).addScaledVector(lu, Math.sin(a) * rr);
      }
    }
    this._renderScene();
    cam.position.copy(keep.pos);
    cam.lookAt(this.controls.target);
    if (SL) SL.position.copy(keep.key);
    if (i > 0) this._applyShift();
    this._ensureAcc();
    const r = this.renderer;
    r.copyFramebufferToTexture(this.acc.fb);
    this._quad.material = this._blend;
    this._blend.uniforms.tMap.value = this.acc.fb;
    this._blend.blendAlpha = 1 / (i + 1);
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.acc.rt);
    r.render(this._quadScene, this._quadCam);
    r.setRenderTarget(null);
    r.autoClear = ac;
    this.acc.n = i + 1;
  }

  _bloomPass() {
    const r = this.renderer, src = this.acc.rt;
    const w = Math.max(4, src.width >> 2), h = Math.max(4, src.height >> 2);
    for (const t of this.bloomRT) if (t.width !== w || t.height !== h) t.setSize(w, h);
    const [A, B] = this.bloomRT;
    const pass = (mat, from, to) => { this._quad.material = mat; mat.uniforms.tMap.value = from.texture; r.setRenderTarget(to); r.render(this._quadScene, this._quadCam); };
    pass(this._bright, src, A);
    for (const k of [1, 2.5]) {
      this._blur.uniforms.uDir.value.set(k / w, 0); pass(this._blur, A, B);
      this._blur.uniforms.uDir.value.set(0, k / h); pass(this._blur, B, A);
    }
    r.setRenderTarget(null);
  }

  _present() {
    const u = this._show.uniforms;
    if (this.post.bloom > 0) { this._bloomPass(); u.tBloom.value = this.bloomRT[0].texture; }
    u.uAspect.value = (this.width || 16) / (this.height || 9);
    u.uSeed.value = (this.acc.n % 7) * 13.1;
    this._quad.material = this._show;
    u.tMap.value = this.acc.rt.texture;
    this.renderer.render(this._quadScene, this._quadCam);
  }

  // A plain frame; it also seeds the accumulation buffer.
  render() {
    this._accumulate(0);
    this._present();
    this.dirty = false;
  }

  // Spend up to `budget` ms adding samples. Returns true if it drew.
  refine(budget = 14) {
    const max = this.quality.samples;
    if (!max || this.acc.n === 0 || this.acc.n >= max) return false;
    const t0 = performance.now();
    do { this._accumulate(this.acc.n); } while (this.acc.n < max && performance.now() - t0 < budget);
    this._present();
    return true;
  }

  get refining() { return this.quality.samples > 0 && this.acc.n > 0 && this.acc.n < this.quality.samples; }

  // Render at an exact pixel size, fully accumulated, and return a canvas.
  renderAt(w, h, samples = this.quality.samples) {
    const r = this.renderer;
    const prevPR = r.getPixelRatio();
    const pw = this.width, ph = this.height;
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    this.width = w; this.height = h;
    this._applyShift();
    this.key.shadow.mapSize.set(4096, 4096);
    this.key.shadow.map?.dispose(); this.key.shadow.map = null;
    const n = Math.max(1, samples);
    for (let i = 0; i < n; i++) this._accumulate(i);
    this._present();
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(this.canvas, 0, 0);
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.map?.dispose(); this.key.shadow.map = null;
    r.setPixelRatio(prevPR);
    this.setSize(pw, ph);
    this.render();
    return out;
  }
}
