import {
  Color3,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShaderMaterial,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { Clouds } from "./Clouds";

const ZENITH = Color3.FromHexString("#2f6fdb");
const HORIZON = Color3.FromHexString("#bfe3ff");

/** Builds the sky: gradient dome, sun light, ambient/hemisphere fill, clouds. */
export class Sky {
  readonly root: TransformNode;
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  readonly hemi: HemisphericLight;

  private readonly scene: Scene;
  private readonly dome: Mesh;
  private readonly clouds: Clouds;
  private readonly sunQuad: Mesh;
  private readonly sunOffset = new Vector3(300, 260, 200);

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

    // --- Sun billboard (a camera-facing quad with a radial gradient texture) ---
    const sunTex = makeRadialTexture("sun-tex", scene, "#fff6d8", "#ffd27a");
    this.sunQuad = MeshBuilder.CreatePlane("sun", { size: 46 }, scene);
    const sunMat = new StandardMaterial("sun-mat", scene);
    sunMat.emissiveTexture = sunTex;
    sunMat.opacityTexture = sunTex; // use the gradient's luminance as opacity
    sunMat.disableLighting = true;
    sunMat.backFaceCulling = false;
    sunMat.disableDepthWrite = true;
    // Always render on top of the sky dome but before world geometry.
    sunMat.disableColorWrite = false;
    sunMat.alpha = 1;
    this.sunQuad.material = sunMat;
    this.sunQuad.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.sunQuad.applyFog = false;
    this.sunQuad.receiveShadows = false; // sun billboard never receives/casts shadows
    this.sunQuad.alwaysSelectAsActiveMesh = true;
    this.sunQuad.parent = this.root;

    // --- Clouds (Minetest/Luanti-style voxel layer) ---
    this.clouds = new Clouds(seed, scene);
    this.clouds.mesh.parent = this.root;
    this.clouds.mesh.receiveShadows = false; // clouds never receive/casts shadows
  }

  setCloudsEnabled(enabled: boolean): void {
    this.clouds.setEnabled(enabled);
  }

  setCloudSeed(seed: string): void {
    this.clouds.setSeed(seed);
  }

  /** Advance cloud drift and keep the sky anchored to the camera. */
  update(dt: number, cameraPosition: Vector3): void {
    this.clouds.step(dt);
    this.clouds.update(cameraPosition.x, cameraPosition.z);

    // The dome uses infiniteDistance (auto-follows camera); but the sun quad
    // and clouds still need manual anchoring.
    this.sunQuad.setAbsolutePosition(cameraPosition.add(this.sunOffset));

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
    const domeMat = this.dome.material;
    const sunMat = this.sunQuad.material;
    const sunTex = sunMat instanceof StandardMaterial ? sunMat.opacityTexture : null;
    this.dome.dispose();
    this.sunQuad.dispose();
    domeMat?.dispose();
    sunMat?.dispose();
    if (sunTex) sunTex.dispose();
    this.ambient.dispose();
    this.hemi.dispose();
    this.sun.dispose();
    this.root.dispose();
  }
}

/** A soft radial-gradient texture for the sun disc. */
function makeRadialTexture(
  name: string,
  scene: Scene,
  inner: string,
  outer: string,
): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(
    name,
    { width: size, height: size },
    scene,
    false,
    Texture.LINEAR_LINEAR,
    undefined,
    false,
  );
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.5, outer);
  g.addColorStop(1, "rgba(255,210,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update(false);
  return tex;
}
