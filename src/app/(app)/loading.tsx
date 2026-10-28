/**
 * Shown the moment a link is clicked, while the next page loads: the click answers at once,
 * the top bar stays put, and grey blocks hold the page's place. Decorative, so screen readers get one word.
 */
export default function Loading() {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      <span className="sk sk-title" />
      <span className="sk sk-line" />
      <div className="sk-row">
        <span className="sk sk-card" />
        <span className="sk sk-card" />
        <span className="sk sk-card" />
      </div>
      <span className="sk sk-table" />
    </div>
  );
}
