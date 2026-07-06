export { DEFAULT_WECOM_CLIENT_ID } from "./constants.js";
export type { WecomAuthClient } from "./types.js";
export {
  getWecomAuthClient,
  isOriginAllowed,
  loadWecomAuthClients,
  normalizeWecomClientId
} from "./clients.js";
export { exchangeWecomCode } from "./auth-service.js";
export {
  batchDeleteWecomContactUsers,
  createWecomContactUser,
  getWecomJoinQrcode,
  inviteWecomContacts,
  updateWecomContactUser
} from "./contact-service.js";
export {
  createWecomDepartment,
  deleteWecomDepartment,
  getWecomDepartment,
  listWecomDepartmentIds,
  listWecomDepartments,
  listWecomUserDepartmentIds,
  syncWecomUserDepartmentIds,
  updateWecomDepartment
} from "./department-service.js";
export { clearWecomAuthCache } from "./wecom-cache.js";
