import { Color, MathUtils, MeshPhongMaterial } from "three";

const darkSpecular = new Color("#505050");
const lightSpecular = new Color("#080808");

/** Tune a per-instance copy; never mutate the imported package material. */
export function tuneViewportMaterial(material: MeshPhongMaterial): void {
  if (!(material instanceof MeshPhongMaterial)) return;
  // Phong does not identify metalness. Honor finish names and strong authored
  // reflections instead of guessing from diffuse brightness alone.
  if (/gloss|polish|metal|chrome|steel|alumin|brass|copper/i.test(material.name)
    || material.shininess >= 60
    || Math.max(material.specular.r, material.specular.g, material.specular.b) >= 0.05) return;

  // Colors are linear here. Keep near-black paint's established response, then
  // smoothly taper it toward a subdued reflection for light wood and paint.
  const luminance = 0.2126 * material.color.r + 0.7152 * material.color.g + 0.0722 * material.color.b;
  const lightness = MathUtils.smoothstep(luminance, 0.02, 0.3);
  material.specular.copy(darkSpecular).lerp(lightSpecular, lightness);
  material.shininess = 12;
}
