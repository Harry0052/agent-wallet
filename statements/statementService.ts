import "server-only";

export interface StatementFilters {
  date_from: string | null;
  date_to: string | null;
  merchant: string | null;
  category: string | null;
  pending: boolean | null;
}

export interface StatementPagination {
  page: number;
  page_size: number;
}

export interface ParsedStatementQuery {
  filters: StatementFilters;
  pagination: StatementPagination;
}

function parseDateParam(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid date filter: "${value}"`);
  }
  return new Date(parsed).toISOString();
}

function parsePendingParam(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Invalid pending filter: "${value}"`);
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid pagination value: "${value}"`);
  }
  return parsed;
}

export function parseStatementQueryParams(
  searchParams: URLSearchParams,
): ParsedStatementQuery {
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const rawPageSize = parsePositiveInt(searchParams.get("page_size"), 50);
  const pageSize = Math.min(rawPageSize, 200);

  return {
    filters: {
      date_from: parseDateParam(searchParams.get("date_from")),
      date_to: parseDateParam(searchParams.get("date_to")),
      merchant: searchParams.get("merchant")?.trim() || null,
      category: searchParams.get("category")?.trim().toLowerCase() || null,
      pending: parsePendingParam(searchParams.get("pending")),
    },
    pagination: {
      page,
      page_size: pageSize,
    },
  };
}

export function offsetFromPagination(pagination: StatementPagination): number {
  return (pagination.page - 1) * pagination.page_size;
}

export interface StatementPaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
}

export function paginationMeta(input: {
  page: number;
  pageSize: number;
  total: number;
}): StatementPaginationMeta {
  const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
  return {
    page: input.page,
    page_size: input.pageSize,
    total: input.total,
    total_pages: totalPages,
    has_next: input.page < totalPages,
  };
}
