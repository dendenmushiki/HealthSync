import React from 'react';
import { Users } from 'lucide-react';
import './PageBanner.css';

const PageBanner = ({ icon: Icon = Users, title, subtitle, eyebrow, total, actions, className = '' }) => (
  <header className={`page-banner ${className}`.trim()}>
    <img className="page-banner-art" src="/images/greetings%20image.jpeg" alt="" aria-hidden="true" />
    <div className="page-banner-copy">
      {eyebrow && <span className="page-banner-eyebrow">{eyebrow}</span>}
      <div className="page-banner-heading">
        <span className="page-banner-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
    </div>
    {actions && <div className="page-banner-actions">{actions}</div>}
    {total !== undefined && (
      <span className="page-banner-total">
        <Users size={17} strokeWidth={1.8} aria-hidden="true" />
        {total === null ? '—' : Number(total).toLocaleString()} Total Residents
      </span>
    )}
  </header>
);

export default PageBanner;
