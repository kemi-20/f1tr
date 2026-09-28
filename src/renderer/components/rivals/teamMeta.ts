import mercedesLogo from '../../assets/team-logos/Mercedes_Logo.png'
import ferrariLogo from '../../assets/team-logos/Ferrari_Logo.png'
import redBullLogo from '../../assets/team-logos/Red_Bull_Logo.png'
import williamsLogo from '../../assets/team-logos/Williams_Logo.png'
import astonMartinLogo from '../../assets/team-logos/Aston_Martin_Logo.png'
import alpineLogo from '../../assets/team-logos/Alpine_Logo.png'
import rbLogo from '../../assets/team-logos/RB_Logo.png'
import haasLogo from '../../assets/team-logos/Haas_Logo.png'
import mclarenLogo from '../../assets/team-logos/McLaren_Logo.png'
import kickLogo from '../../assets/team-logos/Kick_Logo.png'
import audiLogo from '../../assets/team-logos/Audi_Logo.png'
import cadillacLogo from '../../assets/team-logos/Cadillac_Logo.png'

/**
 * Single source of truth for team identity: display name, brand colour and logo.
 * One team has several `m_teamId` values across game years (2025 pack, 2026 pack, F1 25
 * re-numbering), so each set maps its raw ids to the colour used that season.
 */
export interface TeamMeta {
  label: string
  color: string
  logo?: string
}

const TEAM_SETS: Array<{ label: string; logo?: string; ids: Record<string, string> }> = [
  { label: 'Mercedes', logo: mercedesLogo, ids: { '0': '#00D2BE', '129': '#00D2BE', '185': '#00D2BE', '476': '#27F4D2' } },
  { label: 'Ferrari', logo: ferrariLogo, ids: { '1': '#DC0000', '186': '#DC0000', '477': '#E8002D' } },
  { label: 'Red Bull', logo: redBullLogo, ids: { '2': '#3671C6', '187': '#3671C6', '478': '#3671C6' } },
  { label: 'Williams', logo: williamsLogo, ids: { '3': '#64C4FF', '188': '#64C4FF', '479': '#1868DB' } },
  { label: 'Aston Martin', logo: astonMartinLogo, ids: { '4': '#229971', '189': '#229971', '480': '#229971' } },
  { label: 'Alpine', logo: alpineLogo, ids: { '5': '#0090FF', '190': '#0090FF', '481': '#00A1E8' } },
  { label: 'Racing Bulls', logo: rbLogo, ids: { '6': '#6692FF', '191': '#6692FF', '482': '#6692FF' } },
  { label: 'Haas', logo: haasLogo, ids: { '7': '#FFFFFF', '192': '#FFFFFF', '483': '#DEE1E2' } },
  { label: 'McLaren', logo: mclarenLogo, ids: { '8': '#FF8000', '193': '#FF8000', '484': '#FF8000' } },
  { label: 'Kick Sauber', logo: kickLogo, ids: { '9': '#B6BABD', '194': '#B6BABD' } },
  { label: 'Audi', logo: audiLogo, ids: { '485': '#FF2D00' } },
  { label: 'Cadillac', logo: cadillacLogo, ids: { '486': '#AAAAAD' } }
]

export const TEAM_META: Record<string, TeamMeta> = Object.fromEntries(
  TEAM_SETS.flatMap((team) =>
    Object.entries(team.ids).map(([id, color]) => [id, { label: team.label, color, ...(team.logo ? { logo: team.logo } : {}) }])
  )
)

export function teamMetaFor(teamId: string | undefined): TeamMeta | undefined {
  return teamId == null ? undefined : TEAM_META[teamId]
}

/** Return a valid team colour when known; null means no usable team telemetry. */
export function teamColorForCarOrNull(teamId: string | undefined, telemetryColor?: string): string | null {
  const known = teamMetaFor(teamId)?.color
  return known ?? (/^#[0-9a-fA-F]{6}$/.test(telemetryColor ?? '') ? telemetryColor! : null)
}

/** Brand colour for a car: known team id wins, else the telemetry-supplied colour. */
export function teamColorForCar(teamId: string | undefined, telemetryColor?: string): string {
  return teamColorForCarOrNull(teamId, telemetryColor) ?? '#E6EDF6'
}
