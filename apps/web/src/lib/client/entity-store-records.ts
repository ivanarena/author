export function isLocalOnlyRecord(record: {
  lastSyncedVersion?: number | null;
}): boolean {
  return Number(record.lastSyncedVersion) === 0;
}
