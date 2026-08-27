import type { CacheStatus } from "../core/cache/types";

const CACHE_LABELS: Record<CacheStatus, string> = {
  valid: "Valid",
  invalid: "Invalid",
  rendering: "Rendering",
  failed: "Failed",
};

interface CacheStatusBadgeProps {
  status: CacheStatus;
  label?: string;
}

export const CacheStatusBadge = ({ status, label }: CacheStatusBadgeProps) => (
  <span className={`badge badge-cache badge-cache-${status}`} title={label ?? CACHE_LABELS[status]}>
    {label ?? CACHE_LABELS[status]}
  </span>
);

export const needsRerender = (status: CacheStatus) =>
  status === "invalid" || status === "failed";
