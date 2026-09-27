const TEAM_COLORS: Record<string, string> = {
  '0': '#00D2BE', '1': '#DC0000', '2': '#3671C6', '3': '#64C4FF',
  '4': '#229971', '5': '#0090FF', '6': '#6692FF', '7': '#FFFFFF',
  '8': '#FF8000', '9': '#B6BABD', '129': '#00D2BE',
  '185': '#00D2BE', '186': '#DC0000', '187': '#3671C6',
  '188': '#64C4FF', '189': '#229971', '190': '#0090FF',
  '191': '#6692FF', '192': '#FFFFFF', '193': '#FF8000', '194': '#B6BABD',
  '476': '#27F4D2', '477': '#E8002D', '478': '#3671C6',
  '479': '#1868DB', '480': '#229971', '481': '#00A1E8',
  '482': '#6692FF', '483': '#DEE1E2', '484': '#FF8000',
  '485': '#FF2D00', '486': '#AAAAAD'
}

export function teamColorForCar(teamId: string | undefined, telemetryColor: string | undefined): string {
  const known = teamId == null ? undefined : TEAM_COLORS[teamId]
  return known ?? (/^#[0-9a-fA-F]{6}$/.test(telemetryColor ?? '') ? telemetryColor! : '#E6EDF6')
}
