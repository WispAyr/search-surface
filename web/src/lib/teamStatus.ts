import type { SearchTeam } from "@/types/search";

// Minutes of silence after which a deployed team is considered "silent" and
// the controller should request a check-in. 15 min aligns with the field
// auto-checkin interval (5 min) — three missed pings before we alarm.
export const SILENT_THRESHOLD_MIN = 15;

// Standard SAR rest threshold — 4h on foot tasking before rotation is the
// common guidance (ICAR / UK MRT). We warn at the threshold and escalate
// visually once it's exceeded. Applies to deployed AND returning (a team
// walking back still counts as expended energy).
export const FATIGUE_THRESHOLD_MIN = 240;

// A team is silent when it's deployed/returning AND either has never checked
// in, or its last position is older than the threshold. Standby or stood_down
// teams don't count — they aren't expected to be transmitting.
export function isTeamSilent(team: Pick<SearchTeam, "status" | "last_position_at">): boolean {
  if (team.status !== "deployed" && team.status !== "returning") return false;
  if (!team.last_position_at) return true;
  const ageMin = (Date.now() - new Date(team.last_position_at).getTime()) / 60000;
  return ageMin > SILENT_THRESHOLD_MIN;
}

// Minutes the team has been continuously deployed. Null when not deployed or
// the deployed_at timestamp is missing (older rows, never-transitioned rows).
export function teamDeploymentMinutes(team: Pick<SearchTeam, "status" | "deployed_at">): number | null {
  if (team.status !== "deployed" && team.status !== "returning") return null;
  if (!team.deployed_at) return null;
  return Math.max(0, Math.round((Date.now() - new Date(team.deployed_at).getTime()) / 60000));
}

export function isTeamFatigued(team: Pick<SearchTeam, "status" | "deployed_at">): boolean {
  const mins = teamDeploymentMinutes(team);
  return mins != null && mins >= FATIGUE_THRESHOLD_MIN;
}
