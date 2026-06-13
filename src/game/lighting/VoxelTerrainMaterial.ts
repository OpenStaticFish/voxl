import { Color3, Scene, ShaderMaterial, Texture, Vector3 } from "@babylonjs/core";

// Inline GLSL ES 1.00 sources (Babylon migrates them to GLSL3 for WebGL2). Kept
// minimal: sample the atlas, combine the two baked light channels with the live
// day/night uniforms, and apply linear fog. No lighting/shadow/fog includes →
// simple and artifact-free. Sources are passed inline (vertexSource/fragmentSource,
// same pattern as the working sky-dome material) so there is no ShaderStore
// lookup dependency.
const vertexSource = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform vec3 uCameraPos;
varying vec2 vUV;
varying vec4 vColor;
varying float vFogDist;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vFogDist = length(uCameraPos - wp.xyz);
  vUV = uv;
  vColor = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const fragmentSource = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying vec4 vColor;
varying float vFogDist;
uniform sampler2D uTexture;
uniform float uDayFactor;
uniform float uMoonFloor;
uniform float uAlphaCutOff;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uDebugMode;
uniform vec3 uDebugTint;
void main() {
  vec4 tex = texture2D(uTexture, vUV);
  if (tex.a < uAlphaCutOff) discard;
  float brightness;
  if (uDebugMode > 0.5) {
    float s = vColor.b;
    float b = vColor.a;
    if (uDebugMode > 2.5) {
      brightness = max(s, b);
    } else if (uDebugMode > 1.5) {
      brightness = b;
    } else {
      brightness = s;
    }
    gl_FragColor = vec4(uDebugTint * brightness, 1.0);
    return;
  }
  float sun = vColor.r;
  float block = vColor.g;
  brightness = max(max(sun * uDayFactor, sun * uMoonFloor), block);
  vec3 color = tex.rgb * brightness;
  float fog = clamp((uFogEnd - vFogDist) / (uFogEnd - uFogStart), 0.0, 1.0);
  color = mix(uFogColor, color, fog);
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface VoxelTerrainMaterialOptions {
  /** Atlas texture to sample. */
  texture: Texture;
  /** Alpha-test threshold. Use ~0.5 for cutout pass, 0.0 (disabled) for opaque. */
  alphaCutOff?: number;
}

/**
 * Custom terrain material that bakes TWO light channels into the vertex colour
 * and combines them with live day/night uniforms:
 *
 *   vertex.r = shaded sun-channel brightness (face shade × light curve of sun)
 *   vertex.g = shaded block-channel brightness (face shade × light curve of block)
 *   vertex.b = raw sun level 0..1   (for the debug overlay)
 *   vertex.a = raw block level 0..1 (for the debug overlay)
 *
 *   final = texture × max( max(r·dayFactor, r·moonFloor), g )
 *
 * Because `dayFactor` and `moonFloor` are uniforms, the whole world dims at
 * night and relights at dawn WITHOUT rebuilding a single chunk mesh, and torch
 * / glowstone light (the `g` channel) is unaffected by the time of day. Fog is
 * replicated manually (linear) so no fragile fog/shadow GLSL includes are wired
 * in. The debug overlay toggles via a uniform too (no remesh).
 */
export class VoxelTerrainMaterial {
  readonly material: ShaderMaterial;
  private readonly scene: Scene;

  constructor(scene: Scene, options: VoxelTerrainMaterialOptions) {
    this.scene = scene;
    const mat = new ShaderMaterial(
      "voxel-terrain",
      scene,
      { vertexSource, fragmentSource },
      {
        attributes: ["position", "uv", "color"],
        uniforms: [
          "world",
          "worldViewProjection",
          "uCameraPos",
          "uDayFactor",
          "uMoonFloor",
          "uAlphaCutOff",
          "uFogColor",
          "uFogStart",
          "uFogEnd",
          "uDebugMode",
          "uDebugTint",
        ],
        samplers: ["uTexture"],
      },
    );
    mat.setTexture("uTexture", options.texture);
    mat.setFloat("uDayFactor", 1);
    mat.setFloat("uMoonFloor", 0.05);
    mat.setFloat("uAlphaCutOff", options.alphaCutOff ?? 0.5);
    mat.setFloat("uDebugMode", 0);
    mat.setColor3("uDebugTint", new Color3(1, 1, 1));
    mat.setColor3("uFogColor", new Color3(0.8, 0.9, 1));
    mat.setFloat("uFogStart", 60);
    mat.setFloat("uFogEnd", 220);
    mat.setVector3("uCameraPos", new Vector3(0, 0, 0));
    // Match the prior StandardMaterial flags: double-sided, opaque (alpha-test
    // via `discard`, not blending) so the atlas works for both cube and plant faces.
    mat.backFaceCulling = false;
    mat.options.needAlphaBlending = false;
    // We compute fog manually (uFogColor/uFogStart/uFogEnd + uCameraPos). Disable
    // Babylon's fog pipeline on this material — otherwise it injects its fog
    // includes/uniforms into the raw ShaderMaterial and the unexpanded
    // `#include<fogVertexDeclaration>` leaves a literal `<` (shader compile error).
    mat.fogEnabled = false;
    this.material = mat;
  }

  /** Live day/night state (call every frame). */
  setDayNight(dayFactor: number, moonFloor: number): void {
    this.material.setFloat("uDayFactor", dayFactor);
    this.material.setFloat("uMoonFloor", moonFloor);
  }

  /** Fog + camera (call every frame; scene uses linear fog). */
  setFog(cameraPosition: Vector3, color: Color3, start: number, end: number): void {
    this.material.setVector3("uCameraPos", cameraPosition);
    this.material.setColor3("uFogColor", color);
    this.material.setFloat("uFogStart", start);
    this.material.setFloat("uFogEnd", end);
  }

  /** Debug overlay: 0 normal, 1 sun, 2 block, 3 combined. No remesh required. */
  setDebugMode(mode: number, tint: Color3): void {
    this.material.setFloat("uDebugMode", mode);
    this.material.setColor3("uDebugTint", tint);
  }

  dispose(): void {
    this.material.dispose();
  }
}
