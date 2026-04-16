import type { SearchTeam } from "@/types/search";

// Minutes of silence after which a deployed team is considered "silent" and
// the controller should request a check-in. 15 min aligns with the field
// auto-checkin interval (5 min) — three missed pings before we alarm.
export const SILENT_THRESHOLD_MIN = 15;

// A team is silent when it's deployed/returning AND either has never checked
// in, or its last position is older than the threshold. Standby or stood_down
// teams don't count — they aren't expected to be transmitting.
export function isTeamSilent(team: Pick<SearchTeam, "status" | "last_position_at">): boolean {
  if (team.status !== "deployed" && team.status !== "returning") return false;
  if (!team.last_position_at) return true;
  const ageMin = (Date.now() - new Date(team.last_position_at).getTime()) / 60000;
  return ageMin > SILENT_THRESHOLD_MIN;
}
