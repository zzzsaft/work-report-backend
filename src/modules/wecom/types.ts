export interface RawWechatAppConfig {
  agentId?: number;
  corpSecret?: string;
  contactCorpSecret?: string;
  contactSecret?: string;
  addressBookSecret?: string;
  name?: string;
  clientId?: string;
  allowedOrigins?: string[];
  scopes?: string[];
}

export interface RawWechatCorpConfig {
  corpId?: string;
  name?: string;
  apps?: RawWechatAppConfig[];
}

export interface WecomAuthClient {
  clientId: string;
  corpId: string;
  corpName: string;
  agentId: number;
  appName: string;
  corpSecret: string;
  contactCorpSecret: string;
  allowedOrigins: string[];
  scopes: string[];
}

export interface WecomTokenResponse {
  errcode: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

export interface WecomUserInfoResponse {
  errcode: number;
  errmsg?: string;
  UserId?: string;
  userid?: string;
  user_ticket?: string;
  user_doc_ticket?: string;
}

export interface WecomUserDetailResponse {
  errcode: number;
  errmsg?: string;
  userid?: string;
  gender?: string;
  avatar?: string;
  qr_code?: string;
  mobile?: string;
  email?: string;
  biz_mail?: string;
  address?: string;
}

export interface WecomContactUserResponse {
  errcode: number;
  errmsg?: string;
  userid?: string;
  name?: string;
  gender?: string;
  avatar?: string;
  thumb_avatar?: string;
  mobile?: string;
  email?: string;
  biz_mail?: string;
  qr_code?: string;
  address?: string;
  department?: unknown;
  order?: unknown;
  position?: string;
  is_leader_in_dept?: unknown;
  direct_leader?: unknown;
  telephone?: string;
  alias?: string;
  extattr?: unknown;
  status?: number;
  external_profile?: unknown;
  external_position?: string;
  open_userid?: string;
  main_department?: number;
}

export interface WecomCreateUserResponse {
  errcode: number;
  errmsg?: string;
  created_department_list?: {
    department_info?: Array<{
      name?: string;
      id?: number;
    }>;
  };
}

export interface WecomJoinQrcodeResponse {
  errcode: number;
  errmsg?: string;
  join_qrcode?: string;
}

export interface WecomBasicResponse {
  errcode: number;
  errmsg?: string;
}

export interface WecomCreateDepartmentResponse extends WecomBasicResponse {
  id?: number;
}

export interface WecomDepartmentIdItem {
  id?: number;
  parentid?: number;
  order?: number;
}

export interface WecomDepartmentSimpleListResponse extends WecomBasicResponse {
  department_id?: WecomDepartmentIdItem[];
}

export interface WecomDepartmentDetail {
  id?: number;
  name?: string;
  name_en?: string;
  department_leader?: unknown;
  parentid?: number;
  order?: number;
}

export interface WecomDepartmentDetailResponse extends WecomBasicResponse {
  department?: WecomDepartmentDetail;
}

export interface WecomDepartmentListResponse extends WecomBasicResponse {
  department?: WecomDepartmentDetail[];
}

export interface WecomUserDepartmentItem {
  userid?: string;
  department?: number;
}

export interface WecomUserDepartmentListResponse extends WecomBasicResponse {
  next_cursor?: string;
  dept_user?: WecomUserDepartmentItem[];
}

export interface WecomInviteResponse extends WecomBasicResponse {
  invaliduser?: string[];
  invalidparty?: number[];
  invalidtag?: number[];
}
