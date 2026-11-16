import React from 'react';

const icons = {
  'operation-timbang': '▣',
  'bmi-computation': '⚖',
  'recent-records': '▤',
};

const NutritionLayout = ({ title = 'Nutritional monitoring', description = 'Record measurements and review nutrition assessments.', tabs, activeTab, onTabChange, children }) => (
  <div className="nutrition-layout">
    <header className="nutrition-page-header"><div><h1>{title}</h1><p>{description}</p></div></header>
    <nav className="nutrition-tabs" role="tablist" aria-label="Nutrition sections">
      {tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key}
        className={`nutrition-tab${activeTab === tab.key ? ' active' : ''}`} onClick={() => onTabChange(tab.key)}>
        <span aria-hidden="true">{tab.icon || icons[tab.key]}</span>{tab.label}
      </button>)}
    </nav>
    <div role="tabpanel">{children}</div>
  </div>
);

export default NutritionLayout;
