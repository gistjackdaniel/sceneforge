import { REFERENCE_LABELS, type ReferenceType } from "../core/references/types";

interface ReferenceBadgeProps {
  referenceType: ReferenceType;
}

export const ReferenceBadge = ({ referenceType }: ReferenceBadgeProps) => (
  <span className={`badge badge-ref badge-ref-${referenceType}`}>
    {REFERENCE_LABELS[referenceType]}
  </span>
);
