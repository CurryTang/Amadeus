function SkeletonCards({ count = 4 }) {
  return (
    <div className="ui-skeleton-list" aria-label="Loading content" aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="ui-skeleton-card" role="presentation">
          <span className="ui-skeleton-line" style={{ width: '34%' }} />
          <span className="ui-skeleton-line" style={{ width: '85%', height: 14 }} />
          <span className="ui-skeleton-line" style={{ width: '62%' }} />
          <span className="ui-skeleton-line" style={{ width: '45%' }} />
        </div>
      ))}
    </div>
  );
}

export default SkeletonCards;
