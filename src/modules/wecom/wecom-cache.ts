import { clearDefaultWecomAuthClientsCache } from "./clients.js";
import { clearWecomTokenCache } from "./http.js";

export const clearWecomAuthCache = () => {
  clearWecomTokenCache();
  clearDefaultWecomAuthClientsCache();
};
