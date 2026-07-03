export const HOUR_ALLOCATION_METHOD = {
  actualDurationRatio: "actual_duration_ratio",
  originalEstimatedHours: "original_estimated_hours"
} as const;

type HourAllocationMethod = (typeof HOUR_ALLOCATION_METHOD)[keyof typeof HOUR_ALLOCATION_METHOD];

export interface HourAllocationInput {
  id: string;
  operationPoolId: string;
  estimatedHours: number | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  operationPool?: {
    estimatedHours: number;
  } | null;
}

export interface HourAllocationResult {
  allocatedHours: number;
  originalEstimatedHours: number;
  allocationApplied: boolean;
  allocationTemporary: boolean;
  allocationMethod: HourAllocationMethod;
  allocationRatio: number;
  allocationBasisSeconds: number;
  allocationParticipantCount: number;
}

const roundHours = (value: number) => Number(value.toFixed(2));
const roundRatio = (value: number) => Number(value.toFixed(6));

const actualDurationSeconds = (assignment: HourAllocationInput) => {
  if (!assignment.actualStartAt || !assignment.actualEndAt) return 0;

  return Math.max(
    0,
    Math.floor((assignment.actualEndAt.getTime() - assignment.actualStartAt.getTime()) / 1000)
  );
};

const getStandardHours = (assignments: HourAllocationInput[]) =>
  assignments.find((item) => item.operationPool?.estimatedHours !== undefined)?.operationPool
    ?.estimatedHours ??
  assignments.find((item) => item.estimatedHours !== null)?.estimatedHours ??
  0;

const fallbackAllocation = (assignment: HourAllocationInput, participantCount: number) => {
  const originalEstimatedHours = assignment.estimatedHours ?? assignment.operationPool?.estimatedHours ?? 0;

  return {
    allocatedHours: roundHours(originalEstimatedHours),
    originalEstimatedHours: roundHours(originalEstimatedHours),
    allocationApplied: false,
    allocationTemporary: true,
    allocationMethod: HOUR_ALLOCATION_METHOD.originalEstimatedHours,
    allocationRatio: 1,
    allocationBasisSeconds: 0,
    allocationParticipantCount: participantCount
  };
};

export const calculateHourAllocations = (assignments: HourAllocationInput[]) => {
  const grouped = new Map<string, HourAllocationInput[]>();
  for (const assignment of assignments) {
    const group = grouped.get(assignment.operationPoolId);
    if (group) {
      group.push(assignment);
      continue;
    }
    grouped.set(assignment.operationPoolId, [assignment]);
  }

  const allocations = new Map<string, HourAllocationResult>();
  for (const group of grouped.values()) {
    const participantCount = group.length;
    const standardHours = getStandardHours(group);
    const durations = new Map(group.map((assignment) => [assignment.id, actualDurationSeconds(assignment)]));
    const totalDurationSeconds = Array.from(durations.values()).reduce((total, seconds) => total + seconds, 0);

    if (standardHours <= 0 || totalDurationSeconds <= 0) {
      for (const assignment of group) {
        allocations.set(assignment.id, fallbackAllocation(assignment, participantCount));
      }
      continue;
    }

    for (const assignment of group) {
      const basisSeconds = durations.get(assignment.id) ?? 0;
      const ratio = basisSeconds / totalDurationSeconds;
      allocations.set(assignment.id, {
        allocatedHours: roundHours(standardHours * ratio),
        originalEstimatedHours: roundHours(assignment.estimatedHours ?? standardHours),
        allocationApplied: true,
        allocationTemporary: true,
        allocationMethod: HOUR_ALLOCATION_METHOD.actualDurationRatio,
        allocationRatio: roundRatio(ratio),
        allocationBasisSeconds: basisSeconds,
        allocationParticipantCount: participantCount
      });
    }
  }

  return allocations;
};

export const defaultHourAllocation = (assignment: HourAllocationInput) =>
  fallbackAllocation(assignment, 1);
