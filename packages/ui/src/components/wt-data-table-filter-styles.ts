import { css } from "lit";

export const tableFilterStyles = css`
  .table-filters {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
  }

  .table-filter::part(value) {
    text-wrap: wrap;
  }
`;
