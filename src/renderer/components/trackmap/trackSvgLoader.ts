/** Lazy-load track SVG files. Vite ?raw suffix imports the file content as a string.
 *  The SVGs are large (50KB-677KB each), so we only load the one for the current trackId. */

const svgLoaders: Record<number, () => Promise<{ default: string }>> = {
  0: () => import('../../../track_svg/00-melbourne.svg?raw'),
  2: () => import('../../../track_svg/02-shanghai.svg?raw'),
  3: () => import('../../../track_svg/03-sakhir.svg?raw'),
  4: () => import('../../../track_svg/04-catalunya.svg?raw'),
  5: () => import('../../../track_svg/05-monaco.svg?raw'),
  6: () => import('../../../track_svg/06-montreal.svg?raw'),
  7: () => import('../../../track_svg/07-silverstone.svg?raw'),
  9: () => import('../../../track_svg/09-hungaroring.svg?raw'),
  10: () => import('../../../track_svg/10-spa.svg?raw'),
  11: () => import('../../../track_svg/11-monza.svg?raw'),
  12: () => import('../../../track_svg/12-singapore.svg?raw'),
  13: () => import('../../../track_svg/13-suzuka.svg?raw'),
  14: () => import('../../../track_svg/14-yas-marina.svg?raw'),
  15: () => import('../../../track_svg/15-austin.svg?raw'),
  16: () => import('../../../track_svg/16-interlagos.svg?raw'),
  17: () => import('../../../track_svg/17-red-bull-ring.svg?raw'),
  19: () => import('../../../track_svg/19-mexico-city.svg?raw'),
  20: () => import('../../../track_svg/20-baku.svg?raw'),
  26: () => import('../../../track_svg/26-zandvoort.svg?raw'),
  27: () => import('../../../track_svg/27-imola.svg?raw'),
  29: () => import('../../../track_svg/29-jeddah.svg?raw'),
  30: () => import('../../../track_svg/30-miami.svg?raw'),
  31: () => import('../../../track_svg/31-las-vegas.svg?raw'),
  32: () => import('../../../track_svg/32-losail.svg?raw'),
  42: () => import('../../../track_svg/42-madrid.svg?raw')
}

export async function loadTrackSvg(trackId: number): Promise<string | null> {
  const loader = svgLoaders[trackId]
  if (!loader) return null
  try {
    const mod = await loader()
    return mod.default
  } catch {
    return null
  }
}
