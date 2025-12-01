export interface ReleaseInfo {
  id: string;
  type: string;
  repo: string;
  isOrg: boolean;
  title: string;
  sha: string;
  commit: string;
  created_at: number;
  version: string;
  package: string;
}

export interface ReturnData {
  infos: ReleaseInfo[];
  lastUpdated: number;
  lastFetched: number;
}
