import {
  Color3,
  DynamicTexture,
  Engine,
  Material,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { DayNightCycle } from "./DayNightCycle";

const SKY_DIST = 480; // how far the discs sit from the camera (inside the dome)
const SUN_SIZE = 42;
const HALO_SIZE = 96;
const MOON_SIZE = 30;

/**
 * The visual sun and moon — camera-facing discs anchored at sky distance, plus
 * a soft additive halo around the sun. Positions, colours and opacity are all
 * derived from {@link DayNightCycle} each frame, so the sun rises in the east,
 * arcs overhead, sets in the west, and the moon mirrors it.
 *
 * These are pure visuals: they never cast or receive shadows, never enter the
 * shadow render list, and ignore fog (so the sun stays a clean disc rather than
 * a murky square at distance).
 */
export class CelestialSystem {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly sunDisc: Mesh;
  private readonly sunHalo: Mesh;
  private readonly moonDisc: Mesh;
  private readonly sunMat: StandardMaterial;
  private readonly haloMat: StandardMaterial;
  private readonly moonMat: StandardMaterial;
  private readonly sunTex: DynamicTexture;
  private readonly haloTex: DynamicTexture;
  private readonly moonTex: DynamicTexture;

  constructor(scene: Scene, parent: TransformNode) {
    this.scene = scene;
    this.root = new TransformNode("celestial-root", scene);
    this.root.parent = parent;

    this.sunTex = makeRadialTexture("celestial-sun-tex", this.scene, ["#fff8e6", "#ffd98a", "rgba(255,200,120,0)"]);
    this.haloTex = makeRadialTexture("celestial-halo-tex", this.scene, ["rgba(255,220,150,0.55)", "rgba(255,180,90,0.18)", "rgba(255,160,80,0)"]);
    this.moonTex = makeMoonTexture("celestial-moon-tex", this.scene);

    this.sunMat = this.discMaterial("celestial-sun-mat", this.sunTex, Color3.White(), false);
    this.haloMat = this.discMaterial("celestial-halo-mat", this.haloTex, Color3.White(), true);
    this.moonMat = this.discMaterial("celestial-moon-mat", this.moonTex, Color3.FromHexString("#dce8ff"), false);

    this.sunDisc = this.makeDisc("sun", SUN_SIZE, this.sunMat);
    this.sunHalo = this.makeDisc("sun-halo", HALO_SIZE, this.haloMat);
    this.moonDisc = this.makeDisc("moon", MOON_SIZE, this.moonMat);
    // Paint order within the transparent pass doesn't need forcing: the halo is
    // additive (blending commutes) and all discs have depth-write off (no
    // z-fighting). renderingGroupId is set once in makeDisc (group 0, same as
    // terrain, so blocks occlude the discs).
  }

  private makeDisc(name: string, size: number, material: Material): Mesh {
    const m = MeshBuilder.CreatePlane(`celestial-${name}`, { size }, this.scene);
    m.material = material;
    m.parent = this.root;
    // Always face the camera (disc) but stay positioned out at sky distance.
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.isPickable = false;
    m.applyFog = false; // sun/moon ignore fog so they stay crisp discs
    m.receiveShadows = false; // never receive or cast shadows
    m.alwaysSelectAsActiveMesh = true; // visible even though "far" away
    // Same group as terrain (0): Babylon clears depth between groups, so a
    // higher group would lose the terrain depth buffer and let the discs show
    // through blocks. Within group 0 they render in the transparent pass after
    // opaque terrain (depth-write off, depth-test on) → blocks occlude them.
    m.renderingGroupId = 0;
    return m;
  }

  private discMaterial(name: string, tex: DynamicTexture, tint: Color3, additive: boolean): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex; // radial alpha shapes the disc
    mat.emissiveColor = tint;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true; // don't occlude each other / sky
    if (additive) {
      mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      mat.alphaMode = Engine.ALPHA_ADD; // glow adds light
    } else {
      mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    }
    return mat;
  }

  /** Reposition the sun/moon and update their colour/opacity for this frame. */
  update(cameraPosition: Vector3, dn: DayNightCycle): void {
    const cam = cameraPosition;
    // Sun (disc + halo) sits where the sun actually is in the sky.
    const sunPos = cam.add(dn.sunSkyDirection.scale(SKY_DIST));
    this.sunDisc.setAbsolutePosition(sunPos);
    this.sunHalo.setAbsolutePosition(sunPos);
    // Moon sits opposite the sun.
    this.moonDisc.setAbsolutePosition(cam.add(dn.moonSkyDirection.scale(SKY_DIST)));

    const sunVis = dn.sunVisibility;
    const moonVis = dn.moonVisibility;
    this.sunDisc.visibility = sunVis;
    this.sunHalo.visibility = sunVis;
    this.moonDisc.visibility = moonVis;

    // Warm up the sun disc near the horizon; keep the halo matched to it.
    const warm = Color3.Lerp(Color3.White(), dn.sunColor, 0.7);
    this.sunMat.emissiveColor = warm;
    this.haloMat.emissiveColor = Color3.Lerp(Color3.White(), dn.sunColor, 0.5);
    this.moonMat.emissiveColor = dn.moonColor;
  }

  dispose(): void {
    this.sunDisc.dispose();
    this.sunHalo.dispose();
    this.moonDisc.dispose();
    this.sunMat.dispose();
    this.haloMat.dispose();
    this.moonMat.dispose();
    this.sunTex.dispose();
    this.haloTex.dispose();
    this.moonTex.dispose();
    this.root.dispose();
  }
}

/** A soft radial-gradient texture (inner → outer → transparent edge). */
function makeRadialTexture(
  name: string,
  scene: Scene,
  stops: [string, string, string],
): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false, Texture.LINEAR_LINEAR, undefined, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update(false);
  return tex;
}

/** A pale moon disc with a few darker crater speckles and a soft limb. */
function makeMoonTexture(name: string, scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false, Texture.LINEAR_LINEAR, undefined, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  const r = size / 2 - 2;
  // Soft circular alpha mask (slightly fuzzy limb).
  const alpha = ctx.createRadialGradient(c, c, r * 0.7, c, c, r);
  alpha.addColorStop(0, "rgba(0,0,0,1)");
  alpha.addColorStop(1, "rgba(0,0,0,0)");
  ctx.clearRect(0, 0, size, size);
  // Disc body (pale blue-white), shaded toward the limb for a round look.
  const body = ctx.createRadialGradient(c - r * 0.25, c - r * 0.25, r * 0.2, c, c, r);
  body.addColorStop(0, "#f4f8ff");
  body.addColorStop(0.7, "#d4e0f4");
  body.addColorStop(1, "#9fb4d8");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // Crater speckles.
  let seed = 9173;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const rr = rng() * r * 0.7;
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    const rad = 2 + rng() * 5;
    ctx.fillStyle = `rgba(150,165,195,${0.25 + rng() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // Apply the soft limb mask to the alpha channel.
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = alpha;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  tex.update(false);
  return tex;
}
