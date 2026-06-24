export const OPERATION_POOL_STATUS = {
  available: "available",
  claimed: "claimed",
  closed: "closed"
} as const;

export const ASSIGNMENT_STATUS = {
  assigned: "assigned",
  completed: "completed",
  cancelled: "cancelled"
} as const;

export const CLAIMABLE_OPERATION_STATUSES = [
  OPERATION_POOL_STATUS.available,
  OPERATION_POOL_STATUS.claimed
] as const;

export const INACTIVE_ASSIGNMENT_STATUSES = [
  ASSIGNMENT_STATUS.completed,
  ASSIGNMENT_STATUS.cancelled
] as const;
