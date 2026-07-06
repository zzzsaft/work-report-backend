export interface AuthServiceUser {
  userId: string;
  wecomUserId?: string | null;
  name: string;
  avatar?: string;
  gender?: string | null;
  qrCode?: string | null;
  mobile?: string | null;
  email?: string | null;
  bizMail?: string | null;
  address?: string | null;
  department?: unknown;
  departmentOrder?: unknown;
  position?: string | null;
  isLeaderInDept?: unknown;
  directLeader?: unknown;
  telephone?: string | null;
  alias?: string | null;
  extattr?: unknown;
  wecomStatus?: number | null;
  externalProfile?: unknown;
  externalPosition?: string | null;
  openUserid?: string | null;
  mainDepartment?: number | null;
  token?: string;
}

export interface AuthenticatedUser {
  id: string;
  wecomUserId?: string | null;
  name: string;
  avatar?: string;
  roles: string[];
}
