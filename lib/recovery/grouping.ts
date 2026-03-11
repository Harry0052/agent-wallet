export interface RecoveryRecordLike {
  unresolved: boolean;
  recommendedRecoveryAction: string;
  currentState: string;
  needsManualReview: boolean;
}

export interface RecoveryBuckets<T extends RecoveryRecordLike> {
  canBeRestoredInstantly: T[];
  refundInProgress: T[];
  needsReview: T[];
}

export function groupRecoveryRecords<T extends RecoveryRecordLike>(records: T[]): RecoveryBuckets<T> {
  const canBeRestoredInstantly = records.filter((record) => (
    record.unresolved
    && (
      record.recommendedRecoveryAction === 'restore_wallet_balance'
      || record.recommendedRecoveryAction === 'void_external_authorization'
    )
  ));

  const refundInProgress = records.filter((record) => (
    record.unresolved
    && (
      record.currentState === 'refund_requested'
      || record.currentState === 'refund_in_progress'
      || record.currentState === 'refund_available'
      || record.recommendedRecoveryAction === 'request_refund'
    )
  ));

  const needsReview = records.filter((record) => (
    record.unresolved
    && (
      record.currentState === 'manual_review_required'
      || record.needsManualReview
      || record.recommendedRecoveryAction === 'manual_review'
    )
  ));

  return {
    canBeRestoredInstantly,
    refundInProgress,
    needsReview,
  };
}
