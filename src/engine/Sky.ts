import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShaderMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { Clouds } from "./Clouds";

const ZENITH = Color3.FromHexString("#2f6fdb");
const HORIZON = Color3.FromHexString("#bfe3ff");

/** Builds the sky: gradient dome, sun light, ambient/hemisphere fill, clouds.
 *  The visual sun/moon discs live in CelestialSystem (lighting/). */
export class Sky {
  readonly root: TransformNode;
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  readonly hemi: HemisphericLight;

  private readonly scene: Scene;
  private readonly dome: Mesh;
  private readonly domeMat: ShaderMaterial;
  private readonly clouds: Clouds;
  /** Scratch uniform vectors for the dome shader (avoid per-frame allocation). */
  private readonly _zenVec = new Vector3();
  private readonly _horVec = new Vector3();

  constructor(seed = "voxl", scene: Scene) {
    this.scene = scene;
    this.root = new TransformNode("sky-root", scene);

    // --- Sky dome (gradient shader) ---
    this.dome = MeshBuilder.CreateSphere(
      "sky-dome",
      { diameter: 1000, segments: 32 },
      scene,
    );
    const domeMat = new ShaderMaterial(
      "sky-dome-mat",
      scene,
      {
        vertexSource: /* glsl */ `
          precision highp float;
          attribute vec3 position;
          uniform mat4 world;
          uniform mat4 worldViewProjection;
          varying vec3 vWorldPosition;
          void main() {
            vec4 wp = world * vec4(position, 1.0);
            vWorldPosition = wp.xyz;
            gl_Position = worldViewProjection * vec4(position, 1.0);
          }
        `,
        fragmentSource: /* glsl */ `
          precision highp float;
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          uniform float offset;
          uniform float exponent;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
            float t = max(pow(max(h, 0.0), exponent), 0.0);
            gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
          }
        `,
      },
      {
        attributes: ["position"],
        uniforms: ["world", "worldViewProjection", "topColor", "bottomColor", "offset", "exponent"],
      },
    );
    domeMat.setVector3("topColor", new Vector3(ZENITH.r, ZENITH.g, ZENITH.b));
    domeMat.setVector3("bottomColor", new Vector3(HORIZON.r, HORIZON.g, HORIZON.b));
    domeMat.setFloat("offset", 33);
    domeMat.setFloat("exponent", 0.6);
    this.domeMat = domeMat;
    // Inside-out sphere: don't cull back faces, don't write depth.
    domeMat.backFaceCulling = false;
    domeMat.disableDepthWrite = true;
    this.dome.material = domeMat;
    this.dome.infiniteDistance = true; // follow the camera automatically
    this.dome.applyFog = false;
    this.dome.receiveShadows = false; // sky never receives/casts shadows
    this.dome.parent = this.root;
    // Skybox-ish: render before everything else, ignore fog.
    this.dome.renderingGroupId = 0;

    // --- Lights ---
    // Three had ambient(white,0.55) + hemi(sky,ground,0.45) + dir(sun,0.85).
    // Babylon's HemisphericLight serves as both; we use one per source for fidelity.
    this.ambient = new HemisphericLight("ambient", Vector3.Up(), scene);
    this.ambient.diffuse = Color3.White();
    this.ambient.groundColor = Color3.White();
    this.ambient.intensity = 0.55;

    this.hemi = new HemisphericLight("hemi", Vector3.Up(), scene);
    this.hemi.diffuse = Color3.FromHexString("#bfe3ff");
    this.hemi.groundColor = Color3.FromHexString("#4a6b3a");
    this.hemi.intensity = 0.45;

    this.sun = new DirectionalLight("sun", new Vector3(-80, -140, -60).normalize(), scene);
    this.sun.diffuse = Color3.FromHexString("#fff4e0");
    this.sun.intensity = 0.85;

    // --- Clouds (Minetest/Luanti-style voxel layer) ---
    this.clouds = new Clouds(seed, scene);
    this.clouds.mesh.parent = this.root;
    this.clouds.mesh.receiveShadows = false; // clouds never receive/casts shadows
  }

  /** Update the gradient dome colours from the day/night cycle. */
  setDomeColours(zenith: Color3, horizon: Color3): void {
    this._zenVec.set(zenith.r, zenith.g, zenith.b);
    this._horVec.set(horizon.r, horizon.g, horizon.b);
    this.domeMat.setVector3("topColor", this._zenVec);
    this.domeMat.setVector3("bottomColor", this._horVec);
  }

  /** Push the day/night brightness factor to the cloud layer. */
  setCloudDayFactor(dayFactor: number): void {
    this.clouds.setDayFactor(dayFactor);
  }

  /**
   * Apply the cloud quality tier in one call:
   *   enabled = false → clouds off entirely
   *   enabled = true, simple = true → simple tier (top faces skipped)
   *   enabled = true, simple = false → full fancy clouds
   */
  setClouds(enabled: boolean, simple: boolean): void {
    this.clouds.setEnabled(enabled);
    this.clouds.setSimple(enabled && simple);
  }

  setCloudSeed(seed: string): void {
    this.clouds.setSeed(seed);
  }

  /** Advance cloud drift and keep the sky anchored to the camera. */
  update(dt: number, cameraPosition: Vector3): void {
    this.clouds.step(dt);
    this.clouds.update(cameraPosition.x, cameraPosition.z);

    // The dome uses infiniteDistance (auto-follows camera); clouds still need
    // manual anchoring. The visual sun/moon are anchored by CelestialSystem.
    // The clouds use a custom ShaderMaterial that doesn't get scene fog for
    // free, so we bind the current fog state each frame.
    this.clouds.bindFog(
      this.scene.fogColor ?? Color3.White(),
      this.scene.fogStart,
      this.scene.fogEnd,
      cameraPosition,
    );
  }

  dispose(): void {
    this.clouds.dispose();
    this.dome.dispose();
    this.domeMat.dispose();
    this.ambient.dispose();
    this.hemi.dispose();
    this.sun.dispose();
    this.root.dispose();
  }
}
