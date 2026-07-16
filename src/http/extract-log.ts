export interface ExtractMilestone {
  correlationId?: string;
  stage: string;
  result: string;
  elapsedMs: number;
  providerAttempt?: number;
  responseCategory?: string;
}

export function logExtractMilestone(event: ExtractMilestone): void {
  console.info(event);
}
