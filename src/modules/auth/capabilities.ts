export const getCapabilitiesForRoles = (roles: string[]) => {
  const isAdmin = roles.includes("admin");
  const isLeader = roles.includes("leader");

  return {
    roles: roles.length > 0 ? roles : ["worker"],
    canViewAdmin: isAdmin || isLeader,
    canAssignWorkers: isAdmin,
    canReviewExceptions: isAdmin || isLeader,
    canImportOperations: isAdmin || isLeader,
    canViewTeamOperations: isAdmin || isLeader,
    canForceRemoveAssignments: isAdmin,
    canViewAllTeams: isAdmin
  };
};
