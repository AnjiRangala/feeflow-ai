export default function BrandMark({ compact = false }) {
  return (
    <div className="brand-lockup" aria-label="FeeFlow AI">
      <span className="brand-icon" aria-hidden="true">F</span>
      {!compact && (
        <span className="brand-name">
          FeeFlow <span>AI</span>
        </span>
      )}
    </div>
  );
}
