import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function getPageItems(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 'ellipsis-end', totalPages - 1, totalPages];
  if (currentPage >= totalPages - 3) return [1, 2, 'ellipsis-start', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, 2, 'ellipsis-start', currentPage, 'ellipsis-end', totalPages - 1, totalPages];
}

const Pagination = ({ currentPage, totalPages, first, last, total, itemLabel = 'items', onPageChange, pageSize, onPageSizeChange, pageSizeOptions = [10, 25, 50, 100], compact = false, compactButtons = false, formatCounts = false }) => {
  if (!total) return null;
  const displayCount = (value) => formatCounts ? Number(value).toLocaleString() : value;
  const pageItems = compact && totalPages > 5
    ? Array.from({ length: 5 }, (_, index) => Math.max(1, Math.min(currentPage - 2, totalPages - 4)) + index)
    : getPageItems(currentPage, totalPages);

  return (
    <div className="app-pagination-row">
      <span className="app-pagination-summary">Showing {displayCount(first)}-{displayCount(last)} of {displayCount(total)} {itemLabel}</span>
      {!compact && pageSize && onPageSizeChange && <label className="app-pagination-size">Rows per page
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} aria-label={`Rows per page for ${itemLabel}`}>
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>}
      {totalPages > 1 && (
        <nav className="app-pagination" aria-label={`${itemLabel} pages`}>
          <ul className="app-pagination-list">
            <li>
              <button type="button" className="app-pagination-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>{compact || compactButtons ? <ChevronLeft size={16} aria-hidden="true" /> : 'Previous'}</button>
            </li>
            {pageItems.map((item) => item === 'ellipsis-start' || item === 'ellipsis-end' ? (
              <li key={item} className="app-pagination-ellipsis" aria-hidden="true">...</li>
            ) : (
              <li key={item}>
                <button type="button" className={`app-pagination-button app-pagination-number ${item === currentPage ? 'active' : ''}`} aria-current={item === currentPage ? 'page' : undefined} onClick={() => onPageChange(item)}>{item}</button>
              </li>
            ))}
            <li>
              <button type="button" className="app-pagination-button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}>{compact || compactButtons ? <ChevronRight size={16} aria-hidden="true" /> : 'Next'}</button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
};

export default Pagination;
