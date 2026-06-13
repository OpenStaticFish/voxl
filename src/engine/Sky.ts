import * as THREE from "three";
import { Clouds } from "./Clouds";

const ZENITH = new THREE.Color("#2f6fdb");
const HORIZON = new THREE.Color("#bfe3ff");

/** Builds the sky: gradient dome, sun light, ambient/hemisphere fill, clouds. */
export class Sky {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.AmbientLight;
  readonly hemi: THREE.HemisphereLight;

  private readonly dome: THREE.Mesh;
  private readonly clouds: Clouds;
  private readonly sunSprite: THREE.Sprite;

  constructor(seed = "voxl") {
    // --- Sky dome (gradient shader) ---
    const domeGeo = new THREE.SphereGeometry(500, 32, 16);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: ZENITH.clone() },
        bottomColor: { value: HORIZON.clone() },
        offset: { value: 33 },
        exponent: { value: 0.6 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
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
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // --- Lights ---
    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.group.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a6b3a, 0.45);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
    this.sun.position.set(80, 140, 60);
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    // --- Sun disc ---
    const sunTex = makeRadialTexture("#fff6d8", "#ffd27a");
    const sunMat = new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, depthTest: false, fog: false });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(46, 46, 1);
    this.sunSprite.position.set(300, 260, 200);
    this.group.add(this.sunSprite);

    // --- Clouds (Minetest/Luanti-style voxel layer) ---
    this.clouds = new Clouds(seed);
    this.group.add(this.clouds.mesh);
  }

  setCloudsEnabled(enabled: boolean): void {
    this.clouds.setEnabled(enabled);
  }

  setCloudSeed(seed: string): void {
    this.clouds.setSeed(seed);
  }

  /** Advance cloud drift and keep the sky anchored to the camera. */
  update(dt: number, cameraPosition: THREE.Vector3): void {
    this.clouds.step(dt);
    this.clouds.update(cameraPosition.x, cameraPosition.z);

    this.dome.position.copy(cameraPosition);
    this.sun.target.position.copy(cameraPosition);
    this.sunSprite.position.copy(cameraPosition).add(new THREE.Vector3(300, 260, 200));
  }

  dispose(): void {
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.clouds.dispose();
    (this.sunSprite.material as THREE.SpriteMaterial).map?.dispose();
    (this.sunSprite.material as THREE.Material).dispose();
  }
}

function makeRadialTexture(inner: string, outer: string): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.5, outer);
  g.addColorStop(1, "rgba(255,210,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
