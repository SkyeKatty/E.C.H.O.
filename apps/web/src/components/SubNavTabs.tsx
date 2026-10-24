export function SubNavTabs<T extends string>(props: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`subnav-tabs ${props.className ?? ""}`.trim()} role="tablist">
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={props.active === tab.id}
          className={`subnav-tab ${props.active === tab.id ? "active" : ""}`}
          onClick={() => props.onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
