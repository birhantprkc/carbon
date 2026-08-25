import type { CompanyBackupSummary } from "../../backups.service";

/** The word a person types to confirm a restore that discards data. */
export const CONFIRM_WORD = "restore";

export type DisclosureState = {
  /** No stored verdict — an uploaded backup. Say so rather than imply it is clean. */
  unchecked: boolean;
  /** A finding refuses the restore outright. No confirm button is offered. */
  blocked: boolean;
  /** Something in the company today will not exist after. Gates the typed confirm. */
  discards: boolean;
  /** Whether the confirm button may be pressed. */
  canConfirm: boolean;
};

/**
 * Which of the five disclosure states a backup is in.
 *
 * Pure and separate from the component because the states a person most needs to
 * see — discarded columns, a blocked backup — are the hardest to produce by hand.
 */
export function disclosureState(
  backup: CompanyBackupSummary | undefined,
  typed: string
): DisclosureState {
  const findings = backup?.compatibility.findings ?? [];
  const excluded = backup?.excludedRows ?? [];
  const blocked = findings.some((f) => f.kind === "blocked");
  // Excluded rows count as a discard. They are not in the backup, they DO exist
  // in the company today, and a restore deletes today's data — so confirming
  // this restore loses them for good. That they were unrestorable junk does not
  // make their disappearance something to find out about afterwards.
  const discards =
    findings.some((f) => f.kind === "discarded") || excluded.length > 0;

  return {
    unchecked: !backup,
    blocked,
    discards,
    canConfirm:
      !blocked && (!discards || typed.trim().toLowerCase() === CONFIRM_WORD)
  };
}
