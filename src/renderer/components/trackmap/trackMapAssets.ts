import melbourne from '../../../track_maps/00-melbourne.json'
import shanghai from '../../../track_maps/02-shanghai.json'
import sakhir from '../../../track_maps/03-sakhir.json'
import catalunya from '../../../track_maps/04-catalunya.json'
import monaco from '../../../track_maps/05-monaco.json'
import montreal from '../../../track_maps/06-montreal.json'
import silverstone from '../../../track_maps/07-silverstone.json'
import hungaroring from '../../../track_maps/09-hungaroring.json'
import spa from '../../../track_maps/10-spa.json'
import monza from '../../../track_maps/11-monza.json'
import singapore from '../../../track_maps/12-singapore.json'
import suzuka from '../../../track_maps/13-suzuka.json'
import yasMarina from '../../../track_maps/14-yas-marina.json'
import austin from '../../../track_maps/15-austin.json'
import interlagos from '../../../track_maps/16-interlagos.json'
import redBullRing from '../../../track_maps/17-red-bull-ring.json'
import mexicoCity from '../../../track_maps/19-mexico-city.json'
import baku from '../../../track_maps/20-baku.json'
import zandvoort from '../../../track_maps/26-zandvoort.json'
import imola from '../../../track_maps/27-imola.json'
import jeddah from '../../../track_maps/29-jeddah.json'
import miami from '../../../track_maps/30-miami.json'
import lasVegas from '../../../track_maps/31-las-vegas.json'
import losail from '../../../track_maps/32-losail.json'
import madrid from '../../../track_maps/42-madrid.json'

export type TrackPoint = readonly [number, number]
export type TrackBounds = readonly [number, number, number, number]

export interface CalibratedTrackMap {
  id: number
  slug: string
  trackId: string
  trackLength: number
  sector2Start: number
  sector3Start: number
  bounds: TrackBounds
  fusedLine: TrackPoint[]
  pitLine?: TrackPoint[]
  sector1Line?: TrackPoint[]
  sector2Line?: TrackPoint[]
  sector3Line?: TrackPoint[]
}

export const CALIBRATED_TRACK_MAPS: Record<number, CalibratedTrackMap> = {
  0: asTrackMap(melbourne),
  2: asTrackMap(shanghai),
  3: asTrackMap(sakhir),
  4: asTrackMap(catalunya),
  5: asTrackMap(monaco),
  6: asTrackMap(montreal),
  7: asTrackMap(silverstone),
  9: asTrackMap(hungaroring),
  10: asTrackMap(spa),
  11: asTrackMap(monza),
  12: asTrackMap(singapore),
  13: asTrackMap(suzuka),
  14: asTrackMap(yasMarina),
  15: asTrackMap(austin),
  16: asTrackMap(interlagos),
  17: asTrackMap(redBullRing),
  19: asTrackMap(mexicoCity),
  20: asTrackMap(baku),
  26: asTrackMap(zandvoort),
  27: asTrackMap(imola),
  29: asTrackMap(jeddah),
  30: asTrackMap(miami),
  31: asTrackMap(lasVegas),
  32: asTrackMap(losail),
  42: asTrackMap(madrid)
}

function asTrackMap(value: unknown): CalibratedTrackMap {
  return value as CalibratedTrackMap
}
