const STORAGE_ID = "echo.dashboard.participantId";
const STORAGE_NAME = "echo.dashboard.participantName";

export type DashboardParticipant = {
  key: string;
  displayName: string;
  kind: "user";
};

export function loadDashboardParticipant(): DashboardParticipant {
  let id = localStorage.getItem(STORAGE_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_ID, id);
  }
  const displayName = localStorage.getItem(STORAGE_NAME)?.trim() || "Operator";
  return {
    key: `dashboard:${id}`,
    displayName,
    kind: "user",
  };
}

export function saveDashboardDisplayName(displayName: string): DashboardParticipant {
  const trimmed = displayName.trim() || "Operator";
  localStorage.setItem(STORAGE_NAME, trimmed);
  return loadDashboardParticipant();
}
