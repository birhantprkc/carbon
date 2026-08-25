import { useControlField } from "@carbon/form";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCircleAlert, LuInfo, LuTriangleAlert } from "react-icons/lu";
import { tableArea } from "../../backups.areas";
import type { CompanyBackupSummary } from "../../backups.service";
import { formatBackupDate, formatBackupName } from "./format";

/** The word a person types to confirm a restore that discards data. */
const CONFIRM_WORD = "restore";

type Finding = CompanyBackupSummary["compatibility"]["findings"][number];
type Excluded = CompanyBackupSummary["excludedRows"][number];

/**
 * What the person is told before their company's data is replaced.
 *
 * The verdict rendered here is the one stored beside the backup, so this screen
 * costs no schema read and can never disagree with the badge on the list. It is
 * DISCLOSURE, not authorization: the restore job runs the real gate itself, so a
 * verdict that has gone stale since it was written can leave this screen
 * under-informed but can never let through a restore the gate would refuse.
 */
export function RestoreDisclosure({
  backups,
  onConfirm
}: {
  backups: CompanyBackupSummary[];
  onConfirm: (values: { source: string; includeStorage: string }) => void;
}) {
  const { t } = useLingui();
  const [source] = useControlField<string>("source");
  const [includeStorage] = useControlField<string>("includeStorage");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const backup = useMemo(
    () => backups.find((b) => `backup:${b.name}` === source),
    [backups, source]
  );

  // An UPLOADED backup is not in the list, so it has no stored verdict. The
  // consequences below still apply and are still shown; only the findings are
  // unknown, which the screen says rather than implying a clean bill of health.
  const findings = backup?.compatibility.findings ?? [];
  const checkedAt = backup?.compatibility.checkedAt ?? null;
  const excluded = backup?.excludedRows ?? [];
  const blocked = findings.some((f) => f.kind === "blocked");
  // Excluded rows count as a discard. They are not in the backup, they DO exist
  // in the company today, and a restore deletes today's data — so confirming
  // this restore loses them for good. That they were unrestorable junk does not
  // make their disappearance something to find out about afterwards.
  const discards =
    findings.some((f) => f.kind === "discarded") || excluded.length > 0;
  const confirmed = !discards || typed.trim().toLowerCase() === CONFIRM_WORD;

  const close = () => {
    setOpen(false);
    setTyped("");
  };

  return (
    <>
      <Button type="button" isDisabled={!source} onClick={() => setOpen(true)}>
        <Trans>Restore…</Trans>
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Restore this company from a backup</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {backup ? (
                <p className="text-sm text-muted-foreground">
                  {backup.label || formatBackupName(backup.name)}
                  {backup.exportedAt
                    ? ` · ${formatBackupDate(backup.exportedAt)}`
                    : ""}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    This backup has not been compared to the current schema yet.
                    Differences will be found when the restore runs.
                  </Trans>
                </p>
              )}

              {/* Always stated, in this order, findings or not — these are the
                  consequences of the operation itself, not of any difference
                  between the backup and today's schema. */}
              <VStack spacing={1}>
                <p className="text-sm">
                  <Trans>
                    Everything in this company today will be deleted and
                    replaced with what is in this backup.
                  </Trans>
                </p>
                <p className="text-sm">
                  <Trans>
                    A snapshot of today's data is taken first, before anything
                    is deleted.
                  </Trans>
                </p>
                <p className="text-sm">
                  <Trans>
                    Revert puts that snapshot back, exactly as it was.
                  </Trans>
                </p>
                <p className="text-sm">
                  <Trans>
                    Keep drops the snapshot. After Keep, this cannot be undone.
                  </Trans>
                </p>
              </VStack>

              {excluded.length > 0 ? (
                <ExcludedRows excluded={excluded} />
              ) : null}

              {findings.length > 0 ? (
                <FindingGroups findings={findings} checkedAt={checkedAt} />
              ) : null}

              {discards ? (
                <VStack spacing={1}>
                  <label className="text-sm" htmlFor="restore-confirm">
                    {/* Covers both losses above: values the schema will drop,
                        and rows the backup never contained. */}
                    <Trans>
                      Some of your data will not survive this restore. Type{" "}
                      <span className="font-medium">{CONFIRM_WORD}</span> to
                      continue.
                    </Trans>
                  </label>
                  <Input
                    id="restore-confirm"
                    value={typed}
                    autoComplete="off"
                    placeholder={CONFIRM_WORD}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </VStack>
              ) : null}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
            {/* A blocked backup gets no confirm button at all. An explanation
                plus a disabled action reads as "try harder"; the only honest
                next step is to pick a different backup. */}
            {blocked ? null : (
              <Button
                isDisabled={!confirmed}
                onClick={() => {
                  onConfirm({
                    source: source ?? "",
                    includeStorage: includeStorage ?? "all"
                  });
                  close();
                }}
              >
                {t`Replace this company's data`}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

/**
 * Rows the export left out, by product area.
 *
 * Distinct from a `discarded` finding and shown separately: a finding is about
 * the SCHEMA drifting since the backup was taken, this is about rows that were
 * never written to the backup in the first place, and the two have different
 * causes and different fixes. Both are losses, so both gate the typed
 * confirmation.
 *
 * Rendered ABOVE the findings because it is unconditional: a schema finding may
 * not apply to the reader's data, but an excluded row is a row that measurably
 * exists today and will not exist after.
 */
function ExcludedRows({ excluded }: { excluded: Excluded[] }) {
  const total = excluded.reduce((sum, x) => sum + x.rows, 0);
  const areas = [...new Set(excluded.map((x) => tableArea(x.table)))];

  return (
    <VStack spacing={1}>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <LuTriangleAlert className="h-4 w-4 shrink-0" />
        <Trans>Never included in this backup</Trans>
      </span>
      <span className="text-sm text-muted-foreground">
        <Trans>
          {total} records referenced another company's data, so they could not
          be backed up. They exist today and will be gone after this restore.
        </Trans>
      </span>
      {/* The area, not the table — same rule as the findings below. */}
      <span className="text-sm text-muted-foreground">{areas.join(", ")}</span>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          <Trans>Details</Trans>
        </summary>
        <ul className="mt-1 flex flex-col gap-0.5 pl-4">
          {excluded.map((x) => (
            <li key={`${x.table}.${x.column}`}>
              <span className="font-mono">
                {x.table}.{x.column}
              </span>
              {" → "}
              <span className="font-mono">{x.refTable}</span>
              {` — ${x.rows}`}
            </li>
          ))}
        </ul>
      </details>
    </VStack>
  );
}

const KIND_ORDER: Finding["kind"][] = ["blocked", "discarded", "defaulted"];

const KIND_ICON = {
  blocked: LuCircleAlert,
  discarded: LuTriangleAlert,
  defaulted: LuInfo
} as const;

/** Findings by kind, then by product area. Table names live in the expander. */
function FindingGroups({
  findings,
  checkedAt
}: {
  findings: Finding[];
  checkedAt: string | null;
}) {
  const { t } = useLingui();
  const kindLabel: Record<Finding["kind"], string> = {
    blocked: t`Cannot be restored`,
    discarded: t`Will be discarded`,
    defaulted: t`Will be filled with a default`
  };

  return (
    <VStack spacing={3}>
      {KIND_ORDER.filter((kind) => findings.some((f) => f.kind === kind)).map(
        (kind) => {
          const forKind = findings.filter((f) => f.kind === kind);
          const Icon = KIND_ICON[kind];
          const areas = [...new Set(forKind.map((f) => tableArea(f.table)))];
          return (
            <VStack key={kind} spacing={1}>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="h-4 w-4 shrink-0" />
                {kindLabel[kind]}
              </span>
              {/* The area, not the table — "Production" means something to the
                  person deciding; `jobOperationDependency` does not. */}
              <span className="text-sm text-muted-foreground">
                {areas.join(", ")}
              </span>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  <Trans>Details</Trans>
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                  {forKind.map((f) => (
                    <li key={`${f.table}.${f.column ?? ""}`}>
                      <span className="font-mono">
                        {f.table}
                        {f.column ? `.${f.column}` : ""}
                      </span>
                      {" — "}
                      {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            </VStack>
          );
        }
      )}
      {checkedAt ? (
        <span className="text-xs text-muted-foreground">
          <Trans>Compared to the current schema on</Trans>{" "}
          {formatBackupDate(checkedAt)}
        </span>
      ) : null}
    </VStack>
  );
}
